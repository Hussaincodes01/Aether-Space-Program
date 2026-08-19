"""Physics layer — the guardrail.

The LLM is a *good* prior over "what does a plausible landscape look like" and a
*bad* prior over "what is numerically consistent with 0.4 g and 3 W/m2 of
insolation". So everything closed-form is computed here, before the model is
called, and the result is turned into a hard admissible action space.

Design rule: the LLM may only choose among things physics already permits. It can
never author a number that physics can compute.

References for the relations used (kept intentionally simple and citable):
  * cosmic shoreline, I ~ v_esc^4 ....... Zahnle & Catling 2017
  * stream power incision, E = K A^m S^n  Whipple & Tucker 1999
  * crater size-frequency, N ~ D^-b ..... Neukum et al. 2001
  * strength-limited relief, h ~ Y/(rho g) Melosh, Planetary Surface Processes
  * tidal locking timescale ............. Peale 1977 (order-of-magnitude form)
"""

from __future__ import annotations

import math

from .hashing import content_hash
from .models import DerivedEnvironment, FeasibilityEnvelope, PlanetDataCard, Provenance

G_EARTH = 9.80665
V_ESC_EARTH = 11.186          # km/s
RHO_EARTH = 5514.0            # kg/m3
R_EARTH_M = 6.371e6
M_EARTH_KG = 5.9722e24
T_EQ_EARTH_A03 = 278.5        # K at S=1, A=0.3
SHORELINE_C = 15.0            # cosmic-shoreline calibration, see derive()

ARCHETYPES = (
    "airless_rock",
    "cratered_relict",
    "temperate_terrestrial",
    "ocean_world",
    "ice_world",
    "lava_world",
    "venusian_greenhouse",
    "high_gravity_terrestrial",
    "volatile_envelope",
)

# Used by classify() to recover a radius from surface gravity and bulk density.
_G = 6.674e-11
_PI = 3.141592653589793
_EARTH_RADIUS_M = 6.371e6

# Relief may not exceed this fraction of a body's radius. See the note in derive().
_RELIEF_RADIUS_FRACTION = 0.05

# Tidal dissipation. Q is the specific dissipation function; 36 is the value usually quoted
# for Io and is used as the default because nothing better is known for most bodies. The two
# rigidities bracket cold silicate rock and partially molten silicate.
_TIDAL_Q = 36.0
_MU_ROCK = 5.0e10          # Pa, cold silicate
_MU_MELT = 1.0e9           # Pa, partially molten
# Comparable to a rocky body's radiogenic surface flux: above this, tidal heating is no longer
# something the interior can quietly conduct away.
_MELT_TRIGGER_WM2 = 0.05


# --------------------------------------------------------------------------- #
# stage 1: derive
# --------------------------------------------------------------------------- #
def derive(card: PlanetDataCard) -> DerivedEnvironment:
    prov: dict[str, str] = {}
    notes: list[str] = []

    def assumed(key: str, val: float, why: str) -> float:
        prov[key] = Provenance.ASSUMED.value
        notes.append(f"{key}={val:g} assumed ({why})")
        return val

    # --- mass / radius, with a population fallback ------------------------- #
    r = card.get("radius_earth")
    m = card.get("mass_earth")
    if r is None and m is None:
        r = assumed("radius_earth", 1.0, "no size constraint in sources")
    if r is None:
        r = m ** 0.27 if m < 4 else m ** 0.59       # Chen & Kipping-style break
        prov["radius_earth"] = Provenance.DERIVED.value
    if m is None:
        m = r ** 3.7 if r < 1.5 else r ** 1.7       # rocky vs volatile-rich branch
        prov["mass_earth"] = Provenance.DERIVED.value

    g = G_EARTH * m / (r * r)
    v_esc = V_ESC_EARTH * math.sqrt(m / r)
    rho = RHO_EARTH * m / (r ** 3)
    for k in ("surface_gravity_ms2", "escape_velocity_kms", "bulk_density_kgm3"):
        prov[k] = Provenance.DERIVED.value

    # --- radiation --------------------------------------------------------- #
    s = card.get("insolation_earth")
    a = card.get("semi_major_axis_au")
    if s is None and a and card.get("stellar_radius_sun") and card.get("stellar_teff_k"):
        rs, teff = card.get("stellar_radius_sun"), card.get("stellar_teff_k")
        lum = (rs ** 2) * (teff / 5772.0) ** 4
        s = lum / (a * a)
        prov["insolation_earth"] = Provenance.DERIVED.value
    if s is None:
        s = assumed("insolation_earth", 1.0, "no orbital/stellar constraint")

    albedo = card.get("bond_albedo")
    if albedo is None:
        # crude but monotone: hot -> dark rock, cold -> bright ice
        t_guess = T_EQ_EARTH_A03 * s ** 0.25
        albedo = assumed("bond_albedo", 0.6 if t_guess < 200 else (0.1 if t_guess > 1000 else 0.3),
                         "thermal-state prior")

    t_eq = card.get("equilibrium_temp_k")
    if t_eq is None:
        t_eq = T_EQ_EARTH_A03 * ((1.0 - albedo) / 0.7) ** 0.25 * s ** 0.25
        prov["equilibrium_temp_k"] = Provenance.DERIVED.value

    # --- atmosphere retention: cosmic shoreline ---------------------------- #
    # Bodies fall on the airless side when insolation outruns escape velocity^4.
    # SHORELINE_C places the boundary empirically: with C=15 the Solar System sorts
    # correctly (Venus 0.17, Earth 0.07, Mars 0.70, Titan 0.21 retain; Moon 32,
    # Mercury 20 do not), and LHS 3844 b lands at 1.6, matching its observed bare
    # rock surface. Anchoring at Earth=1 instead would wrongly strip Venus and Mars.
    shoreline = s / max(SHORELINE_C * (v_esc / V_ESC_EARTH) ** 4, 1e-9)
    prov["shoreline_ratio"] = Provenance.DERIVED.value

    # --- rotation / tides -------------------------------------------------- #
    p_orb = card.get("orbital_period_days")
    m_star = card.get("stellar_mass_sun") or 1.0
    age = card.get("stellar_age_gyr") or 4.6
    if a is None and p_orb:
        a = ((p_orb / 365.25) ** 2 * m_star) ** (1.0 / 3.0)
        prov["semi_major_axis_au"] = Provenance.DERIVED.value
    a_eff = a or 1.0
    # tau_lock ~ a^6 in Gyr, normalised so Earth-like at 1 AU is ~1e4 Gyr.
    tau_lock_gyr = 1.0e4 * (a_eff ** 6) / max(m_star ** 2, 1e-3)
    p_lock = 1.0 / (1.0 + (tau_lock_gyr / max(age, 0.05)))
    prov["tidal_lock_probability"] = Provenance.DERIVED.value

    ecc = card.get("eccentricity") or 0.0
    period_days = card.get("orbital_period_days")

    # --- tidal heating ------------------------------------------------------ #
    # The previous expression was a one-point fit, 4.1e-10 * m^2.5 * e^2 / a^7.5, calibrated
    # so Io reproduced its observed 2.5 W/m2. It does reproduce Io. It also gives the Moon
    # 552 W/m2 against an observed ~1e-5 -- seven orders of magnitude out -- because the Moon
    # sits at almost the same semi-major axis as Io with thirteen times the eccentricity, and
    # nothing in a fit on a single body constrains that.
    #
    # Replaced with the standard relation, which is dimensionally right rather than fitted:
    #
    #     E = (21/2) * (k2/Q) * n^5 * R^5 * e^2 / G
    #
    # n comes from the orbital period directly, so no primary mass is needed. k2 follows from
    # rigidity, k2 = (3/2) / (1 + 19*mu / (2*rho*g*R)), which reproduces the Moon's measured
    # 0.024 from rock rigidity alone.
    tidal = 0.0
    if ecc > 1e-3 and period_days and period_days > 0.0:
        radius_m = r * R_EARTH_M
        n_rad_s = 2.0 * _PI / (period_days * 86400.0)
        area = 4.0 * _PI * radius_m * radius_m

        def _flux(mu: float) -> float:
            k2 = 1.5 / (1.0 + 19.0 * mu / max(2.0 * rho * g * radius_m, 1.0))
            power = 10.5 * (k2 / _TIDAL_Q) * n_rad_s ** 5 * radius_m ** 5 * ecc ** 2 / _G
            return power / area

        tidal = _flux(_MU_ROCK)

        # Melt feedback. Rigid-body dissipation alone does not predict Io: it gives 0.15 W/m2
        # against an observed 2.5. That gap is real physics rather than a missing constant --
        # once tidal heating outruns what the interior can conduct away, silicate partially
        # melts, rigidity collapses, k2 rises by more than an order of magnitude and the
        # heating runs away until it saturates. That is why Io is molten and the Moon, at
        # comparable distance and higher eccentricity, is not.
        #
        # Applied as a single iteration, triggered against a radiogenic-scale flux rather than
        # a threshold picked to make Io pass. Io trips it and lands near 3 W/m2; the Moon,
        # Europa, Titan and Enceladus do not trip it at all.
        if tidal > _MELT_TRIGGER_WM2:
            tidal = _flux(_MU_MELT)

        tidal = min(tidal, 5.0e3)
    prov["tidal_heating_wm2"] = Provenance.DERIVED.value

    # --- strength-limited relief ------------------------------------------- #
    # Earth caps near ~9 km; scale inversely with rho*g, and let low-gravity,
    # cold, thick-lithosphere bodies keep more relief (Olympus Mons is 22 km).
    strength_limit = 8850.0 * (G_EARTH / max(g, 0.05)) * (RHO_EARTH / max(rho, 1000.0)) ** 0.5

    # The strength limit alone goes as 1/g, so it diverges on small bodies and every one of
    # them piles up on the flat ceiling below. A Solar System calibration run made that
    # concrete: Mimas, Enceladus, Phobos, Pluto and Eris all came out at exactly 45,000 m,
    # which for Mimas is 23% of its 198 km radius. Identical values across bodies that differ
    # by a factor of six in size is the same failure as a saturated clamp -- not merely wrong,
    # but stripped of ordering.
    #
    # A body's own size is the second bound: topography cannot approach the radius and leave
    # something still recognisable as that body. Radius is recoverable from what is already
    # here, since g = (4/3)*pi*G*rho*R. Five percent is generous next to the real Solar System
    # -- Earth spans 0.31% of its radius, Mars 0.87%, the Moon 1.1% -- and it is meant as a
    # ceiling rather than a prediction, so it binds only where the strength limit has stopped
    # saying anything.
    size_limit = float("inf")
    if rho > 0.0 and g > 0.0:
        radius_m = 3.0 * g / (4.0 * _PI * _G * rho)
        size_limit = _RELIEF_RADIUS_FRACTION * radius_m

    max_relief = float(min(max(min(strength_limit, size_limit), 400.0), 45000.0))
    prov["max_relief_m"] = Provenance.DERIVED.value

    env = DerivedEnvironment(
        surface_gravity_ms2=g,
        escape_velocity_kms=v_esc,
        bulk_density_kgm3=rho,
        equilibrium_temp_k=t_eq,
        insolation_earth=s,
        shoreline_ratio=shoreline,
        tidal_lock_probability=p_lock,
        tidal_heating_wm2=tidal,
        max_relief_m=max_relief,
        provenance=prov,
        notes=notes,
    )
    env.capabilities = _capabilities(env, rho, ecc)
    env.archetype, env.archetype_confidence = classify(env, rho)
    return env


def _capabilities(env: DerivedEnvironment, rho: float, ecc: float) -> list[str]:
    """Boolean process gates. Operators declare which of these they need."""
    caps: list[str] = ["solid_surface", "impacts"]
    has_atmo = env.shoreline_ratio < 1.0 and env.escape_velocity_kms > 3.0
    if has_atmo:
        caps.append("atmosphere")
    if has_atmo and 250.0 < env.equilibrium_temp_k < 400.0:
        caps.append("fluid_cycle")            # liquid water rain/rivers
    if env.equilibrium_temp_k < 273.0:
        caps.append("volatile_ice")
    if env.equilibrium_temp_k < 200.0:
        caps.append("cryosphere")
    if env.equilibrium_temp_k > 1200.0 or env.tidal_heating_wm2 > 2.0:
        caps.append("melt_surface")
    if rho > 3000.0:
        caps.append("silicate_crust")
        if env.tidal_heating_wm2 > 0.05 or env.surface_gravity_ms2 > 3.0:
            caps.append("tectonics")
            caps.append("volcanism")
    if has_atmo and env.equilibrium_temp_k > 180.0:
        caps.append("aeolian")
    if env.tidal_lock_probability > 0.5:
        caps.append("tidally_locked")
    return sorted(set(caps))


def classify(env: DerivedEnvironment, rho: float) -> tuple[str, float]:
    """Deterministic archetype prior. Score-based so ties are reproducible."""
    t, s, g = env.equilibrium_temp_k, env.insolation_earth, env.surface_gravity_ms2
    scores: dict[str, float] = {a: 0.0 for a in ARCHETYPES}

    if env.shoreline_ratio >= 1.0:
        scores["airless_rock"] += 3.0
        scores["cratered_relict"] += 2.0
    if rho < 3000.0:
        scores["volatile_envelope"] += 2.5
        scores["ice_world"] += 1.0

    # Density alone cannot separate a gas giant from an ice moon, and a calibration run
    # over the Solar System proved it: Jupiter (rho 1326) scored volatile_envelope +2.5,
    # then the cold-body rule below added ice_world +3.0 for its 112 K equilibrium
    # temperature and won. All four giants classified as ice worlds and were handed a
    # surface to generate. Titan sits at rho 1882 and Europa at 3013, so no density
    # threshold can split them from Jupiter either.
    #
    # Radius is the missing half: retaining a hydrogen/helium envelope takes mass. It is
    # recoverable from what this function already has, since g = (4/3)*pi*G*rho*R, and the
    # recovery is good to a few percent against the real bodies. The separation is wide --
    # the giants land at 3.8-10.5 R_earth and every moon at or below 0.41 -- so the cut at
    # 2 R_earth is nowhere near either population. It is also roughly where the observed
    # exoplanet radius valley falls, so the same rule keeps working off the Solar System.
    radius_earth = 0.0
    if rho > 0.0:
        radius_earth = (3.0 * g / (4.0 * _PI * _G * rho)) / _EARTH_RADIUS_M

    if radius_earth > 2.0 and rho < 2500.0:
        # There is no surface here. This must outrank the cold-body ice score rather than
        # tie with it, or the giants classify by temperature alone.
        scores["volatile_envelope"] += 6.0
        scores["ice_world"] -= 3.0
    if t > 1200.0 or env.tidal_heating_wm2 > 2.0:
        # A molten surface overrides every other regime: relief is set by melt
        # viscosity and resurfacing rate, not by crustal strength or gravity.
        scores["lava_world"] += 3.5
        scores["high_gravity_terrestrial"] -= 2.5
        scores["venusian_greenhouse"] -= 2.0
    if t < 200.0:
        scores["ice_world"] += 3.0
    if 250.0 <= t <= 320.0 and 0.35 <= s <= 1.1 and rho > 3500.0:
        scores["temperate_terrestrial"] += 3.0
        scores["ocean_world"] += 1.5
    if 3000.0 < rho < 4200.0 and 250.0 <= t <= 330.0:
        scores["ocean_world"] += 2.0
    if 1.1 < s < 8.0 and env.shoreline_ratio < 1.0 and rho > 4000.0:
        scores["venusian_greenhouse"] += 3.0
    if g > 15.0 and rho > 4000.0:
        # Above ~1.5 g the relief ceiling, the angle of repose and erosional
        # efficiency all shift enough that the body needs its own operator budget,
        # so this outranks the temperate classification rather than tying with it.
        scores["high_gravity_terrestrial"] += 4.0
        scores["temperate_terrestrial"] -= 1.5
    if env.tidal_heating_wm2 > 0.05 and t < 1200.0:
        scores["cratered_relict"] -= 1.0

    best = max(scores.items(), key=lambda kv: (kv[1], kv[0]))
    total = sum(max(v, 0.0) for v in scores.values()) or 1.0
    if best[1] <= 0.0:
        return "cratered_relict", 0.2
    return best[0], round(min(best[1] / total, 0.99), 3)


# --------------------------------------------------------------------------- #
# stage 2: envelope
# --------------------------------------------------------------------------- #
_ARCHETYPE_RULES: dict[str, dict] = {
    # required: must appear; forbidden: never admissible; bias: encouraged in prompt
    "airless_rock": {
        "required": ["impact.crater_field"],
        "forbidden": ["erosion.stream_power", "erosion.hydraulic_droplet",
                      "erosion.aeolian_dunes", "cryo.glacial_carve", "hydro.sea_level",
                      "volc.flood_basalt"],
        "max_cost": 55,
    },
    "cratered_relict": {
        "required": ["impact.crater_field"],
        "forbidden": ["erosion.stream_power", "hydro.sea_level", "cryo.glacial_carve"],
        "max_cost": 60,
    },
    "temperate_terrestrial": {
        "required": ["tectonic.plates", "erosion.stream_power", "hydro.sea_level"],
        "forbidden": ["volc.magma_ocean"],
        "max_cost": 130,
    },
    "ocean_world": {
        "required": ["hydro.sea_level"],
        "forbidden": ["volc.magma_ocean", "erosion.aeolian_dunes"],
        "max_cost": 110,
    },
    "ice_world": {
        "required": ["cryo.ice_shell"],
        "forbidden": ["erosion.stream_power", "erosion.aeolian_dunes", "volc.magma_ocean"],
        "max_cost": 100,
    },
    "lava_world": {
        "required": ["volc.magma_ocean", "volc.shield_volcano"],
        "forbidden": ["cryo.ice_shell", "cryo.glacial_carve", "erosion.stream_power",
                      "hydro.sea_level", "impact.crater_field"],
        "max_cost": 90,
    },
    "venusian_greenhouse": {
        "required": ["volc.flood_basalt", "erosion.aeolian_dunes"],
        "forbidden": ["cryo.ice_shell", "cryo.glacial_carve", "erosion.stream_power",
                      "hydro.sea_level"],
        "max_cost": 100,
    },
    "high_gravity_terrestrial": {
        "required": ["tectonic.plates"],
        "forbidden": ["volc.magma_ocean"],
        "max_cost": 120,
    },
    "volatile_envelope": {
        "required": ["noise.spectral_fbm"],
        "forbidden": ["impact.crater_field", "tectonic.plates", "erosion.stream_power"],
        "max_cost": 50,
    },
}


def envelope(env: DerivedEnvironment, registry) -> FeasibilityEnvelope:
    """Intersect archetype rules with capability gates declared by each operator."""
    rules = _ARCHETYPE_RULES.get(env.archetype, _ARCHETYPE_RULES["cratered_relict"])
    caps = set(env.capabilities)
    reasons: list[str] = [
        f"archetype={env.archetype} (confidence {env.archetype_confidence})",
        f"capabilities={','.join(sorted(caps))}",
    ]

    forbidden = set(rules["forbidden"])
    allowed: list[str] = []
    for op in registry.all():
        if op.id in forbidden:
            continue
        missing = [c for c in op.requires if c not in caps]
        if missing:
            forbidden.add(op.id)
            reasons.append(f"{op.id} excluded: missing capability {','.join(missing)}")
            continue
        allowed.append(op.id)

    required = [r for r in rules["required"] if r in allowed]
    dropped = [r for r in rules["required"] if r not in allowed]
    if dropped:
        reasons.append(f"archetype-required ops dropped by capability gate: {','.join(dropped)}")

    # Physics-driven parameter narrowing --------------------------------- #
    clamps: dict[str, tuple[float, float]] = {}
    g = env.surface_gravity_ms2

    # Erosion is more efficient at high g (steeper stream power), so admissible
    # erodibility scales with gravity; relief ceiling scales inversely.
    k_hi = min(2.5, 0.4 * (g / G_EARTH) ** 0.5)
    clamps["erosion.stream_power.erodibility"] = (0.02, max(k_hi, 0.05))
    clamps["erosion.thermal_talus.critical_slope"] = (
        0.15, min(1.4, 0.9 * (G_EARTH / max(g, 0.1)) ** 0.5))

    # Crater density scales with exposure age and inversely with resurfacing.
    if "atmosphere" in caps:
        clamps["impact.crater_field.density"] = (0.02, 0.45)   # small impactors burn up
        reasons.append("crater density capped: atmospheric shielding + resurfacing")
    else:
        clamps["impact.crater_field.density"] = (0.35, 1.0)
        reasons.append("crater density floored: no atmosphere, saturation-limited surface")

    if "melt_surface" in caps:
        clamps["volc.flood_basalt.coverage"] = (0.35, 0.95)
    if "cryosphere" in caps:
        clamps["cryo.ice_shell.equator_thickness_frac"] = (0.25, 1.0)

    global_bounds = {
        "elevation_range_m": (max(150.0, 0.02 * env.max_relief_m), env.max_relief_m),
        "sea_level_quantile": (0.05, 0.95),
    }
    reasons.append(f"relief ceiling {env.max_relief_m:.0f} m from strength/(rho*g) limit")

    return FeasibilityEnvelope(
        allowed_ops=sorted(allowed),
        required_ops=sorted(required),
        forbidden_ops=sorted(forbidden),
        param_clamps=clamps,
        global_bounds=global_bounds,
        capabilities=sorted(caps),
        max_cost=int(rules["max_cost"]),
        max_stages=14,
        reasons=reasons,
    )


def envelope_hash(env: DerivedEnvironment, fe: FeasibilityEnvelope) -> str:
    """Binds a spec to the physics that authorised it, so drift is detectable."""
    return content_hash({"derived": env.to_dict(), "envelope": fe.to_dict()}, length=16)
