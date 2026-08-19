"""Tectonic operators.

``tectonic.plates`` is the structural backbone: it produces a plate mosaic plus
convergence/divergence fields, which downstream operators turn into uplift.
Uplift is written to its own channel rather than straight to elevation, because
the landscape-evolution operator needs U(x) as a forcing term — that separation is
the difference between a heightmap that *looks* eroded and one that solves an
actual erosion equation.
"""

from __future__ import annotations

import numpy as np

from ..fields import normalise, perlin3
from ..registry import Ctx, ParamSpec, operator


def _plate_mosaic(fs, n_plates: int, seed: int):
    """Nearest-seed partition on the sphere, plus boundary proximity and convergence."""
    rng = np.random.default_rng(seed & 0xFFFFFFFF)
    seeds = rng.normal(size=(n_plates, 3))
    seeds /= np.linalg.norm(seeds, axis=1, keepdims=True)

    # Random rigid-body rotation vector per plate -> surface velocity field.
    omega = rng.normal(size=(n_plates, 3)) * 0.5

    dots = np.tensordot(fs.xyz, seeds.T, axes=([2], [0]))       # (nlat, nlon, n)
    order = np.argsort(-dots, axis=-1)
    first = order[..., 0]
    second = order[..., 1]
    d1 = np.take_along_axis(dots, first[..., None], axis=-1)[..., 0]
    d2 = np.take_along_axis(dots, second[..., None], axis=-1)[..., 0]
    boundary = np.clip(1.0 - (d1 - d2) * 22.0, 0.0, 1.0)        # 1 at the suture

    vel = np.cross(omega[first], fs.xyz)                        # this plate's velocity
    vel_o = np.cross(omega[second], fs.xyz)                     # neighbour's
    # Outward normal across the boundary, in the tangent plane.
    to_n = seeds[second] - seeds[first]
    to_n = to_n - fs.xyz * np.sum(to_n * fs.xyz, axis=-1, keepdims=True)
    nrm = np.linalg.norm(to_n, axis=-1, keepdims=True)
    to_n = to_n / np.maximum(nrm, 1e-9)
    convergence = np.sum((vel - vel_o) * to_n, axis=-1)         # + closing, - opening
    return first, boundary, convergence


@operator(
    id="tectonic.plates",
    category="tectonics",
    summary=("Spherical plate mosaic. Writes mask_plate_boundary (1 at sutures), "
             "signed uplift from convergence/divergence, and a per-plate elevation "
             "offset separating thick continental crust from thin oceanic crust. "
             "Run this before any erosion stage."),
    params=(
        ParamSpec("plate_count", "int", 12, 3, 40, doc="number of rigid plates"),
        ParamSpec("boundary_sharpness", "float", 1.0, 0.2, 4.0,
                  doc="higher = narrower deformation belts"),
        ParamSpec("uplift_gain", "float", 1.0, 0.0, 3.0,
                  doc="scales the uplift channel written from convergence"),
        ParamSpec("continental_fraction", "float", 0.35, 0.0, 1.0,
                  doc="fraction of plates that are thick/buoyant crust"),
        ParamSpec("craton_relief", "float", 0.35, 0.0, 1.0,
                  doc="elevation offset between continental and oceanic plates"),
    ),
    produces=("elevation", "uplift", "mask_plate_boundary", "plate_id"),
    requires=("tectonics",),
    cost=14,
    maskable=False,
)
def plates(fs, p, ctx: Ctx) -> None:
    pid, boundary, conv = _plate_mosaic(fs, p["plate_count"], ctx.seed)
    boundary = np.clip(boundary ** max(p["boundary_sharpness"], 0.05), 0.0, 1.0)

    conv_n = conv / max(float(np.max(np.abs(conv))), 1e-9)
    uplift = np.clip(conv_n, -1.0, 1.0) * boundary * p["uplift_gain"]
    fs.set("uplift", fs.get("uplift") + uplift)
    fs.set("mask_plate_boundary", boundary)
    fs.set("plate_id", pid.astype(np.float64))

    rng = np.random.default_rng((ctx.seed ^ 0xC0FFEE) & 0xFFFFFFFF)
    is_cont = rng.random(p["plate_count"]) < p["continental_fraction"]
    offset = np.where(is_cont[pid], 0.5, -0.5) * p["craton_relief"]
    fs.channels["elevation"] = fs.get("elevation") + offset


@operator(
    id="tectonic.orogeny",
    category="tectonics",
    summary=("Turns the uplift channel into topography with a distance-decaying "
             "mountain belt profile, plus a foreland flexural basin on the "
             "downgoing side. Requires tectonic.plates upstream."),
    params=(
        ParamSpec("peak_height", "float", 0.8, 0.0, 1.0, unit="-",
                  doc="belt crest height in normalised relief"),
        ParamSpec("belt_width", "float", 0.35, 0.05, 1.0,
                  doc="cross-strike width of the deformation belt"),
        ParamSpec("foreland_depth", "float", 0.15, 0.0, 0.6,
                  doc="flexural basin depth adjacent to the belt"),
        ParamSpec("rift_depth", "float", 0.3, 0.0, 1.0,
                  doc="depth of divergent-boundary rift valleys"),
        ParamSpec("roughness", "float", 0.3, 0.0, 1.0,
                  doc="fractal detail superimposed on the belt"),
    ),
    consumes=("uplift",),
    produces=("elevation",),
    requires=("tectonics",),
    cost=8,
)
def orogeny(fs, p, ctx: Ctx) -> None:
    u = fs.get("uplift")
    if np.ptp(u) < 1e-12:
        return
    conv = np.clip(u, 0.0, None)
    div = np.clip(-u, 0.0, None)

    belt = conv ** max(1.0 / max(p["belt_width"], 0.05) * 0.35, 0.2)
    belt = normalise(belt, 0.0, 1.0)
    detail = 1.0 + p["roughness"] * perlin3(fs.xyz * 14.0, ctx.seed ^ 0x9F1)

    dz = p["peak_height"] * belt * detail
    dz -= p["foreland_depth"] * np.clip(fs.smooth(belt, iters=6, alpha=0.8) - belt, 0.0, None) * 3.0
    dz -= p["rift_depth"] * normalise(div, 0.0, 1.0)
    fs.channels["elevation"] = fs.get("elevation") + dz


@operator(
    id="tectonic.fracture_network",
    category="tectonics",
    summary=("Brittle fracture / graben network from thresholded cellular-boundary "
             "noise. Appropriate for cold one-plate bodies and ice shells where "
             "there is stress but no plate recycling (Europa-style lineae)."),
    params=(
        ParamSpec("frequency", "float", 8.0, 1.0, 32.0,
                  doc="fracture spacing in cycles per planet radius"),
        ParamSpec("depth", "float", 0.08, 0.0, 0.5, doc="incision depth of fractures"),
        ParamSpec("width", "float", 0.12, 0.02, 0.6, doc="fracture width threshold"),
        ParamSpec("anisotropy", "float", 0.0, 0.0, 1.0,
                  doc="stretches the pattern along one axis (global stress direction)"),
    ),
    produces=("elevation", "mask_fracture"),
    cost=13,
)
def fractures(fs, p, ctx: Ctx) -> None:
    xyz = fs.xyz.copy()
    if p["anisotropy"] > 0:
        xyz[..., 0] *= 1.0 - 0.8 * p["anisotropy"]
    n = np.abs(perlin3(xyz * p["frequency"], ctx.seed ^ 0x3C3)) \
        + 0.5 * np.abs(perlin3(xyz * p["frequency"] * 2.1, ctx.seed ^ 0x5D5))
    m = np.clip(1.0 - n / max(p["width"], 1e-3), 0.0, 1.0)
    fs.set("mask_fracture", m)
    fs.channels["elevation"] = fs.get("elevation") - p["depth"] * m


@operator(
    id="tectonic.tidal_bulge",
    category="tectonics",
    summary=("Permanent prolate deformation for a tidally locked body: a two-lobed "
             "figure aligned with the sub- and anti-stellar points. Only admissible "
             "when the derived tidal-lock probability is high."),
    params=(
        ParamSpec("amplitude", "float", 0.2, 0.0, 1.0, unit="-",
                  doc="bulge height in normalised relief"),
        ParamSpec("substellar_lon_deg", "float", 0.0, -180.0, 180.0, unit="deg",
                  doc="longitude of the point facing the star"),
    ),
    produces=("elevation",),
    requires=("tidally_locked",),
    cost=2,
)
def tidal_bulge(fs, p, ctx: Ctx) -> None:
    lam = np.radians(p["substellar_lon_deg"])
    ct = np.cos(fs.LAT) * np.cos(fs.LON - lam)
    fs.channels["elevation"] = fs.get("elevation") + p["amplitude"] * (ct * ct - 1.0 / 3.0) * 1.5
