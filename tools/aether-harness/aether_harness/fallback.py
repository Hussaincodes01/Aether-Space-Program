"""Deterministic archetype templates.

Two jobs:

1. **Fallback.** If every LLM attempt fails validation (or there is no provider at
   all), the harness still has to produce a valid, physically admissible universe.
   A harness that can fail closed but not fail *useful* is not production-ready.
2. **Few-shot exemplar.** The template for the current archetype is injected into
   the prompt as a worked example, which is by far the biggest single lever on
   first-attempt validity — the model sees the exact shape it must return, already
   consistent with the envelope it was given.

Templates are intentionally conservative: they use middle-of-range parameters and
never rely on optional channels. The LLM's job is to beat them, not match them.
"""

from __future__ import annotations

from .models import FeasibilityEnvelope

_TEMPLATES: dict[str, dict] = {
    "temperate_terrestrial": {
        "elevation_range_m": 8000.0,
        "sea_level_quantile": 0.68,
        "notes": ("Plate mosaic sets the structural grain; orogeny converts convergence "
                  "into ranges; stream power carves the drainage network under an "
                  "orographically modulated rainfall field; sea level floods the "
                  "abyssal two thirds."),
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.1, "octaves": 8, "frequency": 2.0},
             "Earth-like spectral slope gives a realistic hypsometric baseline."),
            ("plates", "tectonic.plates", {"plate_count": 13, "continental_fraction": 0.32},
             "Silicate crust with active tectonics; 13 plates matches the Earth analogue."),
            ("drivers", "noise.driver_fields", {"runoff_banding": 0.55, "orographic_gain": 0.45},
             "Fluid cycle present, so precipitation banding and orographic forcing apply."),
            ("belts", "tectonic.orogeny", {"peak_height": 0.75, "belt_width": 0.3},
             "Convergent margins become mountain belts with foreland basins."),
            ("rivers", "erosion.stream_power", {"iterations": 45, "erodibility": 0.45,
                                                "uplift_rate": 0.6, "diffusivity": 0.09},
             "Detachment-limited incision produces dendritic networks and concave profiles."),
            ("talus", "erosion.thermal_talus", {"critical_slope": 0.6, "iterations": 18},
             "Mass wasting caps slopes at the angle of repose for 1 g."),
            ("hypso", "field.hypsometry_match", {"target": "bimodal",
                                                 "continental_fraction": 0.3},
             "Impose the continent/abyssal-plain bimodality that plate recycling creates."),
            ("ocean", "hydro.sea_level", {"quantile": 0.68, "abyssal_flattening": 0.45},
             "Hydrosphere fills to the observed land fraction."),
        ],
    },
    "ocean_world": {
        "elevation_range_m": 4200.0,
        "sea_level_quantile": 0.93,
        "notes": "Deep global ocean over a thin, sediment-mantled crust; islands only.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.6, "octaves": 7, "frequency": 1.6},
             "Thick water column and sediment blanket relax short-wavelength relief."),
            ("drivers", "noise.driver_fields", {"runoff_mean": 2.2, "runoff_banding": 0.3},
             "Water-rich atmosphere gives high, weakly banded precipitation."),
            ("islands", "volc.shield_volcano", {"count": 14, "height": 0.6,
                                                "radius_frac": 0.03},
             "Hotspot volcanism is the only way to break the sea surface."),
            ("hypso", "field.hypsometry_match", {"target": "unimodal", "strength": 0.7},
             "Single-mode hypsometry: almost no continental crust."),
            ("ocean", "hydro.sea_level", {"quantile": 0.93, "coastal_smoothing": 0.5},
             "93% inundation leaves an archipelago."),
        ],
    },
    "ice_world": {
        "elevation_range_m": 3000.0,
        "sea_level_quantile": None,
        "notes": "Cold rigid shell: fracture networks, a thick ice mantle, glacial relaxation.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.4, "octaves": 7, "frequency": 2.2},
             "Viscous relaxation of a cold ice shell suppresses high frequencies."),
            ("cracks", "tectonic.fracture_network", {"frequency": 10.0, "depth": 0.1,
                                                     "anisotropy": 0.4},
             "Tidal/thermal stress on a one-plate body makes lineae, not plate margins."),
            ("craters", "impact.crater_field", {"density": 0.55, "depth_scale": 0.1},
             "Old surface, but viscous relaxation shallows craters."),
            ("shell", "cryo.ice_shell", {"polar_thickness_frac": 0.7,
                                         "equator_thickness_frac": 0.35},
             "Below 200 K the whole surface is ice-covered."),
            ("glaciers", "cryo.glacial_carve", {"intensity": 0.45, "iterations": 12},
             "Ice flow rounds and overdeepens the fracture troughs."),
        ],
    },
    "airless_rock": {
        "elevation_range_m": 9000.0,
        "sea_level_quantile": None,
        "notes": "Saturation-cratered regolith surface; impacts are the only active process.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 1.7, "octaves": 8, "frequency": 3.0},
             "No erosion to smooth the surface, so a shallow spectral slope is right."),
            ("basins", "impact.crater_field", {"density": 0.85, "max_diameter_frac": 0.3,
                                               "size_exponent": 2.0},
             "Airless: full impactor flux reaches the ground, up to basin scale."),
            ("talus", "erosion.thermal_talus", {"critical_slope": 0.9, "iterations": 10},
             "Regolith still fails at the angle of repose; low g permits steep walls."),
            ("micro", "field.blend_noise", {"frequency": 40.0, "amplitude": 0.03},
             "Micrometeorite gardening as high-frequency micro-relief."),
        ],
    },
    "cratered_relict": {
        "elevation_range_m": 7000.0,
        "sea_level_quantile": None,
        "notes": "Ancient surface with partial volcanic resurfacing.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 1.9, "octaves": 8, "frequency": 2.6},
             "Little erosional smoothing on a geologically dead body."),
            ("craters", "impact.crater_field", {"density": 0.7, "size_exponent": 2.1},
             "Long exposure age accumulates a dense crater population."),
            ("maria", "volc.flood_basalt", {"coverage": 0.28, "flatness": 0.9},
             "Early flood volcanism resurfaces the impact lowlands."),
            ("talus", "erosion.thermal_talus", {"critical_slope": 0.8, "iterations": 12},
             "Slope relaxation on old crater walls."),
        ],
    },
    "lava_world": {
        "elevation_range_m": 2500.0,
        "sea_level_quantile": None,
        "notes": "Partially molten dayside; volcanic construction against constant melting.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.2, "octaves": 6, "frequency": 2.4},
             "Baseline crust before melting collapses it."),
            ("melt", "volc.magma_ocean", {"melt_fraction": 0.75, "cell_frequency": 11.0},
             "Melt surface state derived from T_eq/tidal heating: relief collapses."),
            ("shields", "volc.shield_volcano", {"count": 22, "height": 0.5,
                                                "radius_frac": 0.05},
             "Vigorous volcanism builds edifices faster than they relax."),
            ("plains", "volc.flood_basalt", {"coverage": 0.6, "flatness": 0.95},
             "Continuous resurfacing keeps most of the surface as fresh plains."),
        ],
    },
    "venusian_greenhouse": {
        "elevation_range_m": 6000.0,
        "sea_level_quantile": None,
        "notes": "Hot dense atmosphere: no water, vigorous volcanism, aeolian reworking.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.2, "octaves": 8, "frequency": 2.2},
             "Thick lithosphere with long-wavelength tesserae."),
            ("plates", "tectonic.plates", {"plate_count": 8, "continental_fraction": 0.25,
                                           "uplift_gain": 0.8},
             "Stagnant-lid-ish deformation: fewer, larger provinces than Earth."),
            ("belts", "tectonic.orogeny", {"peak_height": 0.6, "rift_depth": 0.35},
             "Crustal plateaus and chasmata from vertical tectonics."),
            ("plains", "volc.flood_basalt", {"coverage": 0.65, "flatness": 0.85},
             "Global resurfacing explains the young mean surface age."),
            ("dunes", "erosion.aeolian_dunes", {"dune_amplitude": 0.05, "abrasion": 0.3},
             "Dense atmosphere transports sediment despite low wind speeds."),
        ],
    },
    "high_gravity_terrestrial": {
        "elevation_range_m": 3500.0,
        "sea_level_quantile": 0.6,
        "notes": "High gravity crushes relief; erosion is efficient and slopes are gentle.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.5, "octaves": 8, "frequency": 2.0},
             "High g suppresses short-wavelength relief."),
            ("plates", "tectonic.plates", {"plate_count": 18, "uplift_gain": 0.7},
             "Thicker, hotter interior drives more, smaller plates."),
            ("drivers", "noise.driver_fields", {"erodibility_mean": 1.3, "runoff_mean": 1.2},
             "Higher g steepens stream power, raising effective erodibility."),
            ("rivers", "erosion.stream_power", {"iterations": 55, "erodibility": 0.7,
                                                "diffusivity": 0.15},
             "Efficient incision keeps relief far below the Earth analogue."),
            ("talus", "erosion.thermal_talus", {"critical_slope": 0.3, "iterations": 25},
             "Angle of repose falls as sqrt(1/g); slopes are gentle."),
            ("ocean", "hydro.sea_level", {"quantile": 0.6},
             "Hydrosphere over a low-relief surface floods broadly."),
        ],
    },
    "volatile_envelope": {
        "elevation_range_m": 600.0,
        "sea_level_quantile": None,
        "notes": "No solid surface to speak of; render a cloud-deck pseudo-topography.",
        "pipeline": [
            ("base", "noise.spectral_fbm", {"beta": 2.9, "octaves": 6, "frequency": 3.0},
             "Banded fluid envelope, not a solid surface: smooth and long-wavelength."),
            ("bands", "field.remap_curve", {"exponent": 1.6, "terrace_steps": 8,
                                            "terrace_strength": 0.4},
             "Terracing approximates zonal banding."),
        ],
    },
}


def template_for(archetype: str) -> dict:
    return _TEMPLATES.get(archetype, _TEMPLATES["cratered_relict"])


def as_proposal(archetype: str, envelope: FeasibilityEnvelope) -> dict:
    """Template rendered as a model-shaped proposal, filtered to admissible ops."""
    t = template_for(archetype)
    allowed = set(envelope.allowed_ops)
    lo, hi = envelope.global_bounds.get("elevation_range_m", (100.0, 20000.0))
    pipeline = [
        {"id": sid, "op": op, "params": dict(params), "rationale": why}
        for sid, op, params, why in t["pipeline"] if op in allowed
    ]
    if not pipeline:
        pipeline = [{"id": "base", "op": "noise.spectral_fbm",
                     "params": {"beta": 2.2, "octaves": 7},
                     "rationale": "Envelope admitted no template operator; minimal base surface."}]
    return {
        "elevation_range_m": min(max(t["elevation_range_m"], lo), hi),
        "sea_level_quantile": (t["sea_level_quantile"]
                               if "hydro.sea_level" in {p["op"] for p in pipeline} else None),
        "notes": t["notes"],
        "pipeline": pipeline,
    }


def render_exemplar(archetype: str, envelope: FeasibilityEnvelope) -> str:
    """Compact few-shot rendering for the prompt."""
    import json
    return json.dumps(as_proposal(archetype, envelope), indent=1)
