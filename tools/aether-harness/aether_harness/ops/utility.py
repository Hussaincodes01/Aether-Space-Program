"""Field utilities: shaping, remapping and mask construction.

These carry no physics of their own but give the LLM fine control over the
*statistics* of the result — in particular ``field.hypsometry_match``, which lets a
spec target a measured elevation-frequency distribution instead of hoping fBm
happens to land there. That is the cheapest available lever on realism.
"""

from __future__ import annotations

import numpy as np

from ..fields import normalise
from ..registry import Ctx, ParamSpec, operator


@operator(
    id="field.hypsometry_match",
    category="field_utility",
    summary=("Monotonically remaps elevation so its area-weighted distribution "
             "matches a target hypsometric curve. 'bimodal' reproduces Earth's "
             "continent/abyssal-plain two-peak signature, 'unimodal' a single-mode "
             "cratered highland, 'exponential' a young volcanic surface. Rank-"
             "preserving, so it never changes drainage topology."),
    params=(
        ParamSpec("target", "enum", "bimodal",
                  choices=("bimodal", "unimodal", "exponential", "uniform"),
                  doc="target elevation-frequency shape"),
        ParamSpec("continental_fraction", "float", 0.3, 0.05, 0.95,
                  doc="bimodal only: area fraction in the high mode"),
        ParamSpec("separation", "float", 0.55, 0.1, 1.0,
                  doc="bimodal only: gap between the two modes"),
        ParamSpec("strength", "float", 0.8, 0.0, 1.0,
                  doc="0 = leave alone, 1 = fully impose the target"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    cost=6,
    maskable=False,
)
def hypsometry(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    flat = z.ravel()
    order = np.argsort(flat, kind="stable")
    ranks = np.empty_like(flat)
    ranks[order] = np.linspace(0.0, 1.0, flat.size)

    t = p["target"]
    if t == "uniform":
        target = ranks
    elif t == "exponential":
        target = 1.0 - np.exp(-3.0 * ranks)
    elif t == "unimodal":
        target = 0.5 * (1.0 + np.tanh((ranks - 0.5) * 4.0))
    else:  # bimodal
        f = 1.0 - p["continental_fraction"]
        lo = np.clip(ranks / max(f, 1e-6), 0.0, 1.0)
        hi = np.clip((ranks - f) / max(1.0 - f, 1e-6), 0.0, 1.0)
        target = np.where(ranks < f,
                          lo * (1.0 - p["separation"]) * 0.5,
                          (1.0 - p["separation"]) * 0.5 + p["separation"]
                          + hi * (1.0 - p["separation"]) * 0.5)
        target = normalise(target, 0.0, 1.0)

    shaped = normalise(target.reshape(z.shape), float(np.min(z)), float(np.max(z)))
    fs.channels["elevation"] = z * (1.0 - p["strength"]) + shaped * p["strength"]


@operator(
    id="field.remap_curve",
    category="field_utility",
    summary=("Applies a signed power curve to elevation about the mean. exponent>1 "
             "flattens lowlands and sharpens peaks (young, unrelaxed); exponent<1 "
             "does the opposite. Cheap way to tune relief character without "
             "re-running an expensive process stage."),
    params=(
        ParamSpec("exponent", "float", 1.0, 0.3, 4.0,
                  doc=">1 sharpens peaks and flattens lowlands, <1 does the reverse"),
        ParamSpec("pivot", "float", 0.5, 0.0, 1.0, doc="normalised pivot elevation"),
        ParamSpec("terrace_steps", "int", 0, 0, 64,
                  doc="0 = smooth; >0 quantises into terraces (mesa/plateau country)"),
        ParamSpec("terrace_strength", "float", 0.5, 0.0, 1.0,
                  doc="blend between the smooth and terraced result"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    cost=3,
)
def remap_curve(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    lo, hi = float(np.min(z)), float(np.max(z))
    n = normalise(z, 0.0, 1.0)
    d = n - p["pivot"]
    shaped = p["pivot"] + np.sign(d) * np.power(np.abs(d), p["exponent"])
    if p["terrace_steps"] > 0:
        q = np.round(shaped * p["terrace_steps"]) / p["terrace_steps"]
        shaped = shaped * (1 - p["terrace_strength"]) + q * p["terrace_strength"]
    fs.channels["elevation"] = normalise(shaped, lo, hi)


@operator(
    id="field.blend_noise",
    category="field_utility",
    summary=("Adds a band-limited detail layer at a chosen frequency, optionally "
             "gated by slope so detail lands on steep ground only. Use as a final "
             "micro-relief pass; keep the amplitude small."),
    params=(
        ParamSpec("frequency", "float", 24.0, 4.0, 96.0,
                  doc="detail wavelength in cycles per planet radius"),
        ParamSpec("amplitude", "float", 0.04, 0.0, 0.3, unit="-",
                  doc="detail height as a fraction of total relief; keep small"),
        ParamSpec("octaves", "int", 3, 1, 6,
                  doc="detail levels stacked above the base frequency"),
        ParamSpec("slope_gated", "bool", True, doc="concentrate detail on steep slopes"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    cost=6,
)
def blend_noise(fs, p, ctx: Ctx) -> None:
    from ..fields import fbm3
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    d = fbm3(fs.xyz, ctx.seed ^ 0x5AD, octaves=p["octaves"], frequency=p["frequency"])
    gate = 1.0
    if p["slope_gated"]:
        gate = normalise(fs.slope(z), 0.15, 1.0)
    fs.channels["elevation"] = z + p["amplitude"] * span * d * gate


@operator(
    id="field.mask_from_elevation",
    category="field_utility",
    summary=("Builds a reusable 0..1 mask from an elevation band, so later stages can "
             "be restricted to (say) highlands only. Reference it from a stage's "
             "'mask' field."),
    params=(
        ParamSpec("low", "float", 0.5, 0.0, 1.0, doc="normalised lower edge"),
        ParamSpec("high", "float", 1.0, 0.0, 1.0, doc="normalised upper edge"),
        ParamSpec("softness", "float", 0.1, 0.001, 0.5,
                  doc="width of the mask's fade at both edges"),
        ParamSpec("name", "enum", "mask_a", choices=("mask_a", "mask_b", "mask_c"),
                  doc="which mask channel to write, so several masks can coexist"),
    ),
    consumes=("elevation",),
    produces=("mask_a", "mask_b", "mask_c"),
    cost=2,
    maskable=False,
)
def mask_from_elevation(fs, p, ctx: Ctx) -> None:
    n = normalise(fs.get("elevation"), 0.0, 1.0)
    s = max(p["softness"], 1e-3)
    m = np.clip((n - p["low"]) / s, 0.0, 1.0) * np.clip((p["high"] - n) / s, 0.0, 1.0)
    fs.set(p["name"], np.clip(m, 0.0, 1.0))


@operator(
    id="field.normalise_relief",
    category="field_utility",
    summary=("Rescales elevation to the spec's elevation_range_m and re-centres it on "
             "the reference datum. The runner appends this implicitly at the end of "
             "every pipeline; include it mid-pipeline only to re-baseline before a "
             "gravity-sensitive stage."),
    params=(
        ParamSpec("target_range", "float", 1.0, 0.05, 1.0,
                  doc="fraction of the spec's elevation_range_m to occupy"),
        ParamSpec("centre_quantile", "float", 0.5, 0.0, 1.0,
                  doc="which quantile maps to the datum"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    cost=1,
    maskable=False,
)
def normalise_relief(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    c = fs.wquantile(z, p["centre_quantile"])
    span = max(float(np.ptp(z)), 1e-12)
    fs.channels["elevation"] = (z - c) / span * p["target_range"]
