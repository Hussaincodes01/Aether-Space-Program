"""Impact, volcanic, cryospheric and hydrospheric operators."""

from __future__ import annotations

import numpy as np

from ..fields import normalise, perlin3
from ..registry import Ctx, ParamSpec, operator


@operator(
    id="impact.crater_field",
    category="impacts",
    summary=("Stochastic crater population with a power-law size-frequency "
             "distribution N(>D) ~ D^-b (b~2 for the lunar production function). "
             "Each crater gets a depth/diameter ratio, an uplifted rim, a flat or "
             "central-peaked floor and an ejecta blanket. Density is envelope-gated: "
             "airless bodies saturate, bodies with atmospheres are capped because "
             "small impactors ablate and resurfacing erases old basins."),
    params=(
        ParamSpec("density", "float", 0.5, 0.0, 1.0, unit="saturation",
                  doc=("cumulative crater area in units of saturation equilibrium; "
                       "1.0 means new craters land on old ones as fast as they form, "
                       "which is the lunar highlands state")),
        ParamSpec("size_exponent", "float", 2.0, 1.2, 3.5,
                  doc="b in N(>D) ~ D^-b; higher = relatively more small craters"),
        ParamSpec("min_diameter_frac", "float", 0.015, 0.004, 0.08, unit="R_body",
                  doc=("smallest crater diameter as a fraction of body radius; below "
                       "roughly 2 grid cells craters are sub-pixel and only add noise")),
        ParamSpec("max_diameter_frac", "float", 0.12, 0.01, 0.6, unit="R_body",
                  doc="largest crater; >0.3 produces basin-scale features"),
        ParamSpec("depth_scale", "float", 0.15, 0.02, 0.35, unit="relief fraction",
                  doc=("depth of the LARGEST crater as a fraction of total relief; "
                       "smaller craters scale as (D/Dmax)^0.7, reproducing the observed "
                       "sublinear depth-diameter relation from simple craters to basins")),
        ParamSpec("rim_height", "float", 0.35, 0.0, 1.0,
                  doc="rim height as a fraction of crater depth"),
        ParamSpec("central_peak_threshold", "float", 0.04, 0.0, 0.5, unit="R_body",
                  doc="diameter above which complex craters get a central peak"),
        ParamSpec("ejecta_extent", "float", 1.6, 1.0, 3.0, unit="crater radii",
                  doc="how far the ejecta blanket reaches beyond the rim"),
    ),
    produces=("elevation", "mask_crater"),
    requires=("impacts",),
    cost=26,
)
def crater_field(fs, p, ctx: Ctx) -> None:
    rng = ctx.rng
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    mask = np.zeros_like(z)

    # Resolution floor: a crater narrower than ~3 cells renders as noise, not a
    # crater. The SPEC stays resolution-independent (it states the intent); the
    # executor raises the floor to whatever the current grid can actually resolve.
    floor = 3.0 * np.pi / fs.nlat
    dmin = max(p["min_diameter_frac"], floor)
    if dmin > p["min_diameter_frac"]:
        fs.log.append(f"crater_field: min diameter raised {p['min_diameter_frac']:.4f} -> "
                      f"{dmin:.4f} R_body by the {fs.nlat}-row grid resolution")
    dmax = max(p["max_diameter_frac"], dmin * 1.5)
    if p["density"] <= 0:
        return

    # Draw from the power law until the cumulative cap area reaches the requested
    # multiple of saturation. Sizing the population by AREA rather than by count is
    # what makes `density` mean the same thing at any resolution or body size.
    b = p["size_exponent"]
    a1, a2 = dmin ** (1.0 - b), dmax ** (1.0 - b)
    target = float(p["density"]) * 1.6           # >1 permits overprinting
    diam_list, covered, cap = [], 0.0, 4000
    while covered < target and len(diam_list) < cap:
        batch = (a1 + rng.random(256) * (a2 - a1)) ** (1.0 / (1.0 - b))
        for d in batch:
            diam_list.append(d)
            covered += (1.0 - np.cos(d * 0.5)) * 0.5 * 2.0
            if covered >= target or len(diam_list) >= cap:
                break
    diam = np.sort(np.array(diam_list))          # small first: big craters overprint
    n = diam.size

    centres = rng.normal(size=(n, 3))
    centres /= np.linalg.norm(centres, axis=1, keepdims=True)

    dz = np.zeros_like(z)
    for i in range(n):
        R = float(diam[i]) * 0.5                   # angular radius in radians
        reach = R * p["ejecta_extent"]
        cosr = np.cos(reach)
        dot = fs.xyz @ centres[i]
        sel = dot > cosr
        if not sel.any():
            continue
        ang = np.arccos(np.clip(dot[sel], -1.0, 1.0))
        r = ang / max(R, 1e-9)                     # normalised radial distance

        depth = p["depth_scale"] * span * (float(diam[i]) / dmax) ** 0.7
        prof = np.zeros_like(r)
        inside = r <= 1.0
        # Parabolic bowl + raised rim, ejecta decaying as r^-3 outside.
        prof[inside] = -depth * (1.0 - r[inside] ** 2)
        rim = p["rim_height"] * depth
        prof[inside] += rim * np.exp(-((r[inside] - 1.0) / 0.22) ** 2)
        out = ~inside
        prof[out] = rim * np.power(np.maximum(r[out], 1.0), -3.0)

        if float(diam[i]) > p["central_peak_threshold"]:
            peak = r < 0.28
            prof[peak] += depth * 0.55 * (1.0 - r[peak] / 0.28)

        dz[sel] = dz[sel] + prof
        m = mask[sel]
        mask[sel] = np.maximum(m, np.where(inside, 1.0, 0.35))

    fs.channels["elevation"] = z + dz
    fs.set("mask_crater", np.clip(mask, 0.0, 1.0))


@operator(
    id="volc.shield_volcano",
    category="volcanism",
    summary=("Hotspot shield volcanoes: exponential-profile edifices with summit "
             "calderas. Low-gravity bodies support far taller shields (the Olympus "
             "Mons regime), which the envelope's relief ceiling already accounts for."),
    params=(
        ParamSpec("count", "int", 6, 1, 80,
                  doc="number of edifices"),
        ParamSpec("height", "float", 0.5, 0.0, 1.0, unit="-",
                  doc="summit height in normalised relief"),
        ParamSpec("radius_frac", "float", 0.06, 0.005, 0.3, unit="R_body",
                  doc="basal radius as a fraction of body radius"),
        ParamSpec("flank_slope", "float", 2.0, 0.8, 6.0,
                  doc="profile exponent; higher = steeper stratovolcano-like flanks"),
        ParamSpec("caldera_frac", "float", 0.18, 0.0, 0.5,
                  doc="caldera radius as a fraction of edifice radius"),
        ParamSpec("chain_alignment", "float", 0.6, 0.0, 1.0,
                  doc="1.0 = hotspot track (collinear chain), 0 = scattered"),
    ),
    produces=("elevation", "lava"),
    requires=("volcanism",),
    cost=14,
)
def shield(fs, p, ctx: Ctx) -> None:
    rng = ctx.rng
    z = fs.get("elevation")
    n = int(p["count"])

    axis = rng.normal(size=3)
    axis /= np.linalg.norm(axis)
    root = rng.normal(size=3)
    root /= np.linalg.norm(root)
    tangent = np.cross(axis, root)
    tangent /= max(np.linalg.norm(tangent), 1e-9)

    dz = np.zeros_like(z)
    lava = fs.get("lava")
    for i in range(n):
        scatter = rng.normal(size=3)
        t = (i / max(n - 1, 1) - 0.5) * 1.6
        c = root + p["chain_alignment"] * t * tangent + (1.0 - p["chain_alignment"]) * scatter
        c /= max(np.linalg.norm(c), 1e-9)

        R = p["radius_frac"] * (0.5 + rng.random())
        dot = fs.xyz @ c
        sel = dot > np.cos(R * 3.0)
        if not sel.any():
            continue
        r = np.arccos(np.clip(dot[sel], -1.0, 1.0)) / max(R, 1e-9)
        h = p["height"] * np.exp(-np.power(r, p["flank_slope"]))
        if p["caldera_frac"] > 0:
            cal = r < p["caldera_frac"]
            h[cal] -= p["height"] * 0.35 * (1.0 - r[cal] / max(p["caldera_frac"], 1e-9))
        dz[sel] += h
        lava[sel] = np.maximum(lava[sel], np.exp(-r))

    fs.channels["elevation"] = z + dz
    fs.set("lava", np.clip(lava, 0.0, 1.0))


@operator(
    id="volc.flood_basalt",
    category="volcanism",
    summary=("Large igneous province resurfacing: floods everything below a "
             "coverage-quantile threshold to a near-flat lava plain, erasing prior "
             "relief and craters there. This is the mechanism behind lunar maria and "
             "Venus's young mean surface age. Run it AFTER cratering to model "
             "resurfacing, or before to model pre-existing plains."),
    params=(
        ParamSpec("coverage", "float", 0.35, 0.0, 0.95, unit="area fraction",
                  doc="fraction of the surface flooded"),
        ParamSpec("flatness", "float", 0.85, 0.0, 1.0,
                  doc="1.0 = perfectly level plains, 0 = lava merely mantles relief"),
        ParamSpec("wrinkle_ridges", "float", 0.05, 0.0, 0.4,
                  doc="compressional ridge amplitude on the cooled plains"),
        ParamSpec("margin_softness", "float", 0.05, 0.005, 0.4,
                  doc="width of the flow-margin transition"),
    ),
    produces=("elevation", "lava", "mask_plains"),
    requires=("volcanism",),
    cost=8,
)
def flood_basalt(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    if p["coverage"] <= 0:
        return
    level = fs.wquantile(z, p["coverage"])
    span = max(float(np.ptp(z)), 1e-9)
    soft = p["margin_softness"] * span
    fill = np.clip((level - z) / max(soft, 1e-9), 0.0, 1.0)

    plains = np.where(z < level, level, z)
    out = z + p["flatness"] * fill * (plains - z)
    if p["wrinkle_ridges"] > 0:
        ridge = np.abs(perlin3(fs.xyz * 9.0, ctx.seed ^ 0x1B1))
        out = out + p["wrinkle_ridges"] * span * 0.3 * fill * (1.0 - ridge)
    fs.channels["elevation"] = out
    fs.set("lava", np.maximum(fs.get("lava"), fill))
    fs.set("mask_plains", fill)


@operator(
    id="volc.magma_ocean",
    category="volcanism",
    summary=("Molten or partially molten surface: near-total relief suppression plus "
             "convective cell patterning. Only admissible when the derived state has "
             "melt_surface (T_eq above ~1200 K or strong tidal heating)."),
    params=(
        ParamSpec("melt_fraction", "float", 0.8, 0.0, 1.0,
                  doc="1.0 = fully molten, relief collapses to convection cells"),
        ParamSpec("cell_frequency", "float", 9.0, 2.0, 30.0,
                  doc="convective cell count scale"),
        ParamSpec("cell_amplitude", "float", 0.08, 0.0, 0.4,
                  doc="height of the convective cell pattern"),
    ),
    consumes=("elevation",),
    produces=("elevation", "lava"),
    requires=("melt_surface",),
    cost=6,
)
def magma_ocean(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    cells = perlin3(fs.xyz * p["cell_frequency"], ctx.seed ^ 0x77)
    cells = normalise(np.abs(cells), -1.0, 1.0)
    flat = z * (1.0 - p["melt_fraction"])
    fs.channels["elevation"] = flat + p["cell_amplitude"] * span * cells * p["melt_fraction"]
    fs.set("lava", np.full_like(z, p["melt_fraction"]))


@operator(
    id="cryo.ice_shell",
    category="cryosphere",
    summary=("Latitude- and elevation-dependent ice accumulation. Writes the ice "
             "channel and mantles topography. On tidally locked bodies, ice migrates "
             "to the night side and cold traps rather than to the poles, which "
             "substellar_bias models."),
    params=(
        ParamSpec("polar_thickness_frac", "float", 0.5, 0.0, 1.0, unit="-",
                  doc="ice thickness at the poles in normalised relief"),
        ParamSpec("equator_thickness_frac", "float", 0.05, 0.0, 1.0,
                  doc="ice thickness at the equator in normalised relief"),
        ParamSpec("snowline_elevation", "float", 0.4, 0.0, 1.0, unit="normalised",
                  doc="elevation above which ice accumulates at all latitudes"),
        ParamSpec("substellar_bias", "float", 0.0, 0.0, 1.0,
                  doc="tidally locked: shift the ice budget to the anti-stellar side"),
        ParamSpec("smoothing", "float", 0.5, 0.0, 1.0,
                  doc="how much the ice sheet flattens underlying relief"),
    ),
    produces=("elevation", "ice"),
    requires=("volatile_ice",),
    cost=6,
)
def ice_shell(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    lat_term = np.abs(np.sin(fs.LAT)) ** 1.5
    thick = (p["equator_thickness_frac"]
             + (p["polar_thickness_frac"] - p["equator_thickness_frac"]) * lat_term)

    elev_n = normalise(z, 0.0, 1.0)
    thick = thick + np.clip(elev_n - p["snowline_elevation"], 0.0, None) * 1.2

    if p["substellar_bias"] > 0:
        night = np.clip(-np.cos(fs.LON) * np.cos(fs.LAT), 0.0, 1.0)
        thick = thick * (1.0 - p["substellar_bias"]) + thick * p["substellar_bias"] * (0.2 + 2.0 * night)

    thick = np.clip(thick, 0.0, 2.0) * (0.85 + 0.3 * normalise(
        perlin3(fs.xyz * 6.0, ctx.seed ^ 0x1CE), 0.0, 1.0))
    fs.set("ice", np.clip(thick, 0.0, 2.0))

    surface = z + thick * span * 0.25
    if p["smoothing"] > 0:
        smoothed = fs.smooth(surface, iters=4, alpha=0.6)
        gate = np.clip(thick, 0.0, 1.0) * p["smoothing"]
        surface = surface * (1 - gate) + smoothed * gate
    fs.channels["elevation"] = surface


@operator(
    id="cryo.glacial_carve",
    category="cryosphere",
    summary=("Glacial erosion under the ice channel: converts V-shaped fluvial "
             "valleys into U-shaped troughs, overdeepens them, and truncates spurs. "
             "Uses anisotropic smoothing weighted by ice thickness and slope."),
    params=(
        ParamSpec("intensity", "float", 0.5, 0.0, 1.0,
                  doc="how thoroughly ice reworks the underlying fluvial relief"),
        ParamSpec("iterations", "int", 12, 1, 60,
                  doc="glacial advance steps; more = deeper, wider troughs"),
        ParamSpec("overdeepening", "float", 0.15, 0.0, 0.6,
                  doc="extra incision at valley floors, produces fjord basins"),
        ParamSpec("cirque_headwall", "float", 0.2, 0.0, 0.8,
                  doc="steepening at the upstream head of glaciated valleys"),
    ),
    consumes=("elevation", "ice"),
    produces=("elevation",),
    requires=("cryosphere",),
    cost=16,
)
def glacial_carve(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation").copy()
    span = max(float(np.ptp(z)), 1e-9)
    ice = np.clip(fs.get("ice", 0.0), 0.0, 1.0)
    if ice.max() < 1e-6:
        return
    for _ in range(int(p["iterations"])):
        smooth = fs.smooth(z, iters=1, alpha=0.7)
        gate = ice * p["intensity"] * 0.5
        z = z * (1 - gate) + smooth * gate
        curv = smooth - z
        z = z - p["overdeepening"] * span * 0.05 * ice * np.clip(curv / span, 0.0, None) * 20.0
    head = np.clip(fs.slope(z) * fs.dlat_m / span, 0.0, 1.0)
    fs.channels["elevation"] = z + p["cirque_headwall"] * span * 0.1 * ice * head


@operator(
    id="hydro.sea_level",
    category="hydrosphere",
    summary=("Places a global datum at a chosen area quantile and writes mask_ocean "
             "plus bathymetry. Optionally flattens the seafloor to model sediment "
             "infill and applies coastal wave smoothing. This operator defines the "
             "land/ocean split that biome assignment later keys off."),
    params=(
        ParamSpec("quantile", "float", 0.65, 0.02, 0.98, unit="area fraction",
                  doc="fraction of the surface covered by ocean"),
        ParamSpec("abyssal_flattening", "float", 0.4, 0.0, 1.0,
                  doc="sediment infill smoothing of the seafloor"),
        ParamSpec("coastal_smoothing", "float", 0.3, 0.0, 1.0,
                  doc="wave-base erosion of the shoreline"),
        ParamSpec("shelf_width", "float", 0.08, 0.0, 0.4,
                  doc="continental shelf breadth as a fraction of relief"),
    ),
    consumes=("elevation",),
    produces=("elevation", "mask_ocean", "bathymetry"),
    requires=("fluid_cycle",),
    cost=7,
    maskable=False,
)
def sea_level(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    level = fs.wquantile(z, p["quantile"])
    ocean = (z < level).astype(np.float64)

    out = z
    if p["abyssal_flattening"] > 0:
        sm = fs.smooth(z, iters=6, alpha=0.7)
        out = out * (1 - ocean * p["abyssal_flattening"]) + sm * (ocean * p["abyssal_flattening"])
    if p["shelf_width"] > 0:
        band = np.exp(-((out - level) / (p["shelf_width"] * span)) ** 2)
        out = out + band * (level - out) * 0.35
    if p["coastal_smoothing"] > 0:
        coast = np.exp(-((out - level) / (0.03 * span)) ** 2)
        out = out * (1 - coast * p["coastal_smoothing"]) \
            + fs.smooth(out, iters=2, alpha=0.6) * (coast * p["coastal_smoothing"])

    fs.channels["elevation"] = out
    fs.set("mask_ocean", (out < level).astype(np.float64))
    fs.set("bathymetry", np.clip(level - out, 0.0, None))
    fs.log.append(f"sea_level datum={level:.4f} ocean_fraction={fs.wmean(fs.get('mask_ocean')):.3f}")
