"""Base-surface synthesis operators.

These establish the initial surface and the *drivers* (uplift, erodibility,
runoff) that the process operators later consume. Keeping drivers as first-class
channels — rather than baking everything into elevation — is what lets a
landscape-evolution stage do real work instead of just blurring noise.
"""

from __future__ import annotations

import numpy as np

from ..fields import fbm3, normalise, perlin3, spectral_fbm, worley3
from ..registry import Ctx, ParamSpec, operator


@operator(
    id="noise.spectral_fbm",
    category="base_surface",
    summary=("1/f^beta spectral synthesis on the sphere. beta is the hypsometric "
             "control: ~1.2 rough/young/self-similar, ~2.0 Earth-like, ~2.8 relaxed "
             "and long-wavelength. Use this as the initial surface for almost any body."),
    params=(
        ParamSpec("beta", "float", 2.0, 0.6, 3.4, unit="-",
                  doc="spectral slope; higher = smoother, longer wavelengths"),
        ParamSpec("octaves", "int", 8, 3, 12, doc="detail levels"),
        ParamSpec("frequency", "float", 2.0, 0.5, 12.0,
                  doc="base spatial frequency in cycles per planet radius"),
        ParamSpec("amplitude", "float", 1.0, 0.0, 1.0, doc="contribution to normalised relief"),
    ),
    produces=("elevation",),
    cost=6,
)
def spectral(fs, p, ctx: Ctx) -> None:
    h = spectral_fbm(fs, ctx.seed, beta=p["beta"], octaves=p["octaves"],
                     frequency=p["frequency"])
    fs.channels["elevation"] = fs.get("elevation") + p["amplitude"] * normalise(h, -1.0, 1.0)


@operator(
    id="noise.ridged_multifractal",
    category="base_surface",
    summary=("Ridged multifractal with optional domain warping. Produces linear "
             "sharp-crested ranges; warp>0 curves them into orogenic arcs rather "
             "than isotropic spikes."),
    params=(
        ParamSpec("octaves", "int", 6, 2, 10,
                  doc="detail levels"),
        ParamSpec("frequency", "float", 3.0, 0.5, 16.0, doc="cycles per planet radius"),
        ParamSpec("lacunarity", "float", 2.0, 1.4, 3.2,
                  doc="frequency step between octaves"),
        ParamSpec("gain", "float", 0.5, 0.25, 0.75,
                  doc="amplitude decay per octave; higher = rougher"),
        ParamSpec("warp", "float", 0.35, 0.0, 1.5, doc="domain-warp strength; curves ridges"),
        ParamSpec("amplitude", "float", 0.6, 0.0, 1.0,
                  doc="contribution to normalised relief"),
    ),
    produces=("elevation",),
    cost=8,
)
def ridged(fs, p, ctx: Ctx) -> None:
    h = fbm3(fs.xyz, ctx.seed, octaves=p["octaves"], frequency=p["frequency"],
             lacunarity=p["lacunarity"], gain=p["gain"], mode="ridged", warp=p["warp"])
    fs.channels["elevation"] = fs.get("elevation") + p["amplitude"] * normalise(h, -0.4, 1.0)


@operator(
    id="noise.billow_basins",
    category="base_surface",
    summary=("Billow noise, biased negative. Cheap way to punch broad soft basins "
             "and lowland provinces into an existing surface."),
    params=(
        ParamSpec("octaves", "int", 5, 2, 9,
                  doc="detail levels"),
        ParamSpec("frequency", "float", 1.8, 0.4, 8.0,
                  doc="basin count scale in cycles per planet radius"),
        ParamSpec("depth", "float", 0.4, 0.0, 1.0, doc="basin depth in normalised relief"),
    ),
    produces=("elevation",),
    cost=5,
)
def billow(fs, p, ctx: Ctx) -> None:
    h = fbm3(fs.xyz, ctx.seed, octaves=p["octaves"], frequency=p["frequency"], mode="billow")
    fs.channels["elevation"] = fs.get("elevation") - p["depth"] * normalise(h, 0.0, 1.0)


@operator(
    id="noise.driver_fields",
    category="base_surface",
    summary=("Synthesises the geomorphic driver channels consumed by the erosion "
             "operators: erodibility (rock strength contrast) and runoff (spatially "
             "variable precipitation). Latitudinal banding models a Hadley-like "
             "circulation; correlation ties lithology to the existing relief."),
    params=(
        ParamSpec("erodibility_mean", "float", 1.0, 0.2, 3.0, unit="-",
                  doc="mean multiplier on stream-power K"),
        ParamSpec("erodibility_contrast", "float", 0.5, 0.0, 1.5,
                  doc="lithological heterogeneity; 0 = uniform bedrock"),
        ParamSpec("erodibility_frequency", "float", 4.0, 0.5, 16.0,
                  doc="size of lithological provinces"),
        ParamSpec("runoff_mean", "float", 1.0, 0.0, 4.0, unit="-",
                  doc="mean precipitation multiplier"),
        ParamSpec("runoff_banding", "float", 0.5, 0.0, 1.0,
                  doc="strength of latitudinal wet/dry banding"),
        ParamSpec("orographic_gain", "float", 0.3, 0.0, 1.5,
                  doc="rainfall increase with elevation (orographic forcing)"),
        ParamSpec("substellar_bias", "float", 0.0, 0.0, 1.0,
                  doc="for tidally locked bodies: concentrate runoff on the day side"),
    ),
    produces=("erodibility", "runoff"),
    cost=4,
    maskable=False,
)
def drivers(fs, p, ctx: Ctx) -> None:
    n = perlin3(fs.xyz * p["erodibility_frequency"], ctx.seed ^ 0x4D2)
    k = p["erodibility_mean"] * (1.0 + p["erodibility_contrast"] * n)
    fs.set("erodibility", np.clip(k, 0.05, 6.0))

    bands = np.cos(3.0 * fs.LAT) * 0.5 + 0.5
    r = 1.0 - p["runoff_banding"] + p["runoff_banding"] * bands
    elev = fs.get("elevation")
    if p["orographic_gain"] > 0 and np.ptp(elev) > 1e-9:
        r = r * (1.0 + p["orographic_gain"] * normalise(elev, 0.0, 1.0))
    if p["substellar_bias"] > 0:
        day = np.clip(np.cos(fs.LON) * np.cos(fs.LAT), 0.0, 1.0)
        r = r * (1.0 - p["substellar_bias"] + p["substellar_bias"] * (0.15 + 1.7 * day))
    r = r * (0.75 + 0.5 * normalise(perlin3(fs.xyz * 2.5, ctx.seed ^ 0x7E1), 0.0, 1.0))
    fs.set("runoff", np.clip(p["runoff_mean"] * r, 0.0, 12.0))


@operator(
    id="noise.cellular_provinces",
    category="base_surface",
    summary=("Worley cellular field. f2f1 mode gives crisp province boundaries "
             "(useful as fracture/graben networks or as a mask channel); f1 gives "
             "bowl-shaped cells."),
    params=(
        ParamSpec("frequency", "float", 6.0, 1.0, 24.0,
                  doc="cell count scale in cycles per planet radius"),
        ParamSpec("jitter", "float", 0.9, 0.0, 1.0,
                  doc="0 = a regular lattice, 1 = fully irregular cells"),
        ParamSpec("kind", "enum", "f2f1", choices=("f1", "f2f1", "cell_id"),
                  doc="f2f1 = boundary ridges, f1 = cell bowls, cell_id = flat labels"),
        ParamSpec("amplitude", "float", 0.25, -1.0, 1.0,
                  doc="signed; negative incises the pattern instead of raising it"),
        ParamSpec("as_mask", "bool", False,
                  doc="write to channel mask_provinces instead of elevation"),
    ),
    produces=("elevation", "mask_provinces"),
    cost=12,
)
def cellular(fs, p, ctx: Ctx) -> None:
    w = worley3(fs.xyz, ctx.seed, frequency=p["frequency"], jitter=p["jitter"], kind=p["kind"])
    if p["as_mask"]:
        fs.set("mask_provinces", normalise(w, 0.0, 1.0))
        return
    fs.channels["elevation"] = fs.get("elevation") + p["amplitude"] * normalise(w, 0.0, 1.0)


@operator(
    id="noise.domain_warp",
    category="base_surface",
    summary=("Warps the existing elevation field through a noise displacement. "
             "Cheap post-process that destroys the tell-tale isotropy of raw fBm "
             "and makes structures look advected by flow."),
    params=(
        ParamSpec("strength", "float", 0.3, 0.0, 1.5, doc="displacement in cells x frequency"),
        ParamSpec("frequency", "float", 2.0, 0.3, 8.0,
                  doc="wavelength of the displacement field"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    cost=7,
)
def warp(fs, p, ctx: Ctx) -> None:
    elev = fs.get("elevation")
    dx = perlin3(fs.xyz * p["frequency"], ctx.seed ^ 0xA11)
    dy = perlin3(fs.xyz * p["frequency"] + 19.7, ctx.seed ^ 0xB22)
    s = p["strength"] * 0.06
    ii = np.clip(np.round(np.arange(fs.nlat)[:, None] + dy * s * fs.nlat), 0, fs.nlat - 1).astype(int)
    jj = np.mod(np.round(np.arange(fs.nlon)[None, :] + dx * s * fs.nlon), fs.nlon).astype(int)
    fs.channels["elevation"] = elev[ii, jj]
