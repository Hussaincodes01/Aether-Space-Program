"""Process operators: fluvial, hillslope and aeolian erosion.

``erosion.stream_power`` is the research-grade path — it integrates the detachment-
limited stream power law

    dz/dt = U - K * R * A^m * S^n + D * laplacian(z)

with D8 flow routing and topologically ordered drainage accumulation, on the
sphere, using the uplift/erodibility/runoff driver channels. That equation is why
the driver channels exist as separate outputs of the base-surface stage: a
generative model can propose U, K, R fields and this operator decodes them into a
landscape whose valley spacing, concavity and relief are emergent rather than
painted on.
"""

from __future__ import annotations

import numpy as np

from ..fields import normalise, perlin3
from ..registry import Ctx, ParamSpec, operator

_D8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def _neighbour_tables(fs):
    """Flat neighbour indices and metric distances for the 8 D8 directions."""
    key = "_d8_tables"
    cached = getattr(fs, key, None)
    if cached is not None:
        return cached
    nlat, nlon = fs.shape
    I, J = np.meshgrid(np.arange(nlat), np.arange(nlon), indexing="ij")
    idx, dist = [], []
    for di, dj in _D8:
        ii = np.clip(I + di, 0, nlat - 1)
        jj = np.mod(J + dj, nlon)
        idx.append((ii * nlon + jj).ravel())
        d = np.sqrt((di * fs.dlat_m) ** 2 + (dj * fs.dlon_m) ** 2)
        dist.append(np.maximum(d, 1.0).ravel())
    tables = (np.stack(idx), np.stack(dist), (I * nlon + J).ravel())
    setattr(fs, key, tables)
    return tables


def _receivers(fs, z_flat):
    """Steepest-descent receiver per cell; self-receiver marks a sink.

    Routing uses the *physical* metric so meridian convergence is respected, but the
    returned slope is dimensionless (drop per meridional cell width) because the
    incision law is non-dimensionalised — see ``stream_power``.
    """
    nidx, ndist, self_idx = _neighbour_tables(fs)
    zn = z_flat[nidx]                                   # (8, N)
    slopes = (z_flat[None, :] - zn) / ndist
    k = np.argmax(slopes, axis=0)
    best = np.take_along_axis(slopes, k[None, :], axis=0)[0]
    rec = np.take_along_axis(nidx, k[None, :], axis=0)[0]
    dist_cells = np.take_along_axis(ndist, k[None, :], axis=0)[0] / fs.dlat_m
    sink = best <= 0.0
    rec = np.where(sink, self_idx, rec)
    slope_cells = np.where(sink, 0.0, (z_flat - zn[k, np.arange(z_flat.size)])
                           / np.maximum(dist_cells, 1e-9))
    return rec, np.maximum(slope_cells, 0.0)


def _accumulate(z_flat, rec, weight):
    """Drainage accumulation in topological (descending-elevation) order.

    Donors are always strictly higher than their receiver, so a single descending
    pass is exact. Kept as an explicit loop for portability; swap in numba/C++ for
    production resolutions.
    """
    order = np.argsort(-z_flat, kind="stable")
    acc = weight.astype(np.float64).copy()
    a, r = acc, rec
    for i in order:
        j = r[i]
        if j != i:
            a[j] += a[i]
    return acc


def _fill_pits(fs, z, passes: int) -> np.ndarray:
    """Cheap epsilon-fill: raise local minima just above their lowest neighbour."""
    nidx, _, _ = _neighbour_tables(fs)
    zf = z.ravel().copy()
    eps = max(float(np.ptp(zf)) * 1e-6, 1e-9)
    for _ in range(max(0, int(passes))):
        lowest = np.min(zf[nidx], axis=0)
        pit = zf <= lowest
        if not pit.any():
            break
        zf = np.where(pit, lowest + eps, zf)
    return zf.reshape(z.shape)


@operator(
    id="erosion.stream_power",
    category="erosion",
    summary=("Detachment-limited landscape evolution: dz/dt = U - K*R*A^m*S^n + "
             "D*lap(z), with D8 routing and exact drainage accumulation. Consumes "
             "the uplift/erodibility/runoff driver channels. This is the operator "
             "that produces real dendritic drainage networks and concave valley "
             "profiles; everything else only approximates them."),
    params=(
        ParamSpec("iterations", "int", 40, 5, 200, doc="explicit timesteps"),
        ParamSpec("dt", "float", 0.02, 0.001, 0.2, unit="dimensionless",
                  doc="timestep; raise iterations rather than dt for stability"),
        ParamSpec("erodibility", "float", 0.4, 0.01, 3.0, unit="-",
                  doc="base K; multiplied by the erodibility channel"),
        ParamSpec("m_exponent", "float", 0.5, 0.3, 0.7,
                  doc="drainage-area exponent; 0.5 is the canonical value"),
        ParamSpec("n_exponent", "float", 1.0, 0.7, 2.0, doc="slope exponent"),
        ParamSpec("uplift_rate", "float", 0.5, 0.0, 3.0,
                  doc="scales the uplift channel as the tectonic forcing term"),
        ParamSpec("diffusivity", "float", 0.08, 0.0, 1.0,
                  doc="hillslope soil creep; smooths ridges and removes pits"),
        ParamSpec("fill_passes", "int", 6, 0, 40,
                  doc="epsilon depression filling before each routing pass"),
        ParamSpec("deposition", "float", 0.2, 0.0, 1.0,
                  doc="fraction of eroded material redeposited in low-slope cells"),
    ),
    consumes=("elevation", "uplift", "erodibility", "runoff"),
    produces=("elevation", "sediment", "flow_accumulation"),
    requires=("fluid_cycle",),
    cost=40,
)
def stream_power(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation").copy()
    span = max(float(np.ptp(z)), 1e-6)
    z /= span                                            # work in normalised relief

    U = fs.get("uplift", 0.0) * p["uplift_rate"]
    K = fs.get("erodibility", 1.0) * p["erodibility"]
    R = np.clip(fs.get("runoff", 1.0), 0.0, None)
    # Discharge weight per cell: precipitation x true cell area (cos-lat weighted).
    w = (R * fs.dlon_m / fs.dlat_m).ravel()
    m, n, dt = p["m_exponent"], p["n_exponent"], p["dt"]

    # Non-dimensionalisation. A^m*S^n spans many decades across a planet and its
    # absolute magnitude depends on grid resolution, which would make dt
    # resolution-dependent and the spec non-portable. Dividing by the 99th-percentile
    # value measured on the FIRST iteration (and then held fixed, so the scaling is
    # part of the deterministic trajectory) gives dt a stable meaning: the fraction
    # of total relief removed per step at the most actively incising cells. Total
    # erosional work is then dt * iterations * erodibility.
    scale = None
    total_eroded = np.zeros_like(z)
    acc2d = np.ones_like(z)
    for _ in range(int(p["iterations"])):
        zf = _fill_pits(fs, z, p["fill_passes"]).ravel() if p["fill_passes"] else z.ravel()
        rec, slope = _receivers(fs, zf)
        acc = _accumulate(zf, rec, w)
        acc2d = acc.reshape(z.shape)
        s2d = slope.reshape(z.shape)

        raw = np.power(acc2d, m) * np.power(s2d, n)
        if scale is None:
            scale = max(float(np.quantile(raw, 0.99)), 1e-12)
        incision = K * raw / scale
        # Courant guard: never cut deeper than half the drop to the receiver.
        incision = np.minimum(incision, 0.5 * s2d / max(dt, 1e-9))
        dz = dt * (U - incision)

        if p["deposition"] > 0:
            # Local transport: a fraction of what a cell loses is deposited on its
            # receiver. Globally redistributing the eroded volume by a normalised
            # weight field is mass-conserving but numerically explosive, because a
            # single high-accumulation basin cell can receive the whole planet's
            # sediment budget in one step. Routing to the receiver bounds each
            # cell's gain to its (at most eight) donors.
            eroded = np.clip(-dz, 0.0, None)
            dep = np.zeros(z.size)
            np.add.at(dep, rec, p["deposition"] * eroded.ravel())
            dz = dz + dep.reshape(z.shape)
            total_eroded += eroded

        # Hard stability guard: no single step may move more than a quarter of the
        # working relief. Protects against parameter combinations the validator
        # cannot rule out analytically.
        dz = np.clip(dz, -0.25, 0.25)
        z = z + dz
        if p["diffusivity"] > 0:
            z = fs.smooth(z, iters=1, alpha=min(p["diffusivity"], 0.9))

    fs.channels["elevation"] = z * span
    fs.set("sediment", normalise(total_eroded, 0.0, 1.0))
    fs.set("flow_accumulation", np.log1p(acc2d))


@operator(
    id="erosion.thermal_talus",
    category="erosion",
    summary=("Slope-limited mass wasting. Any slope steeper than the critical angle "
             "sheds material to its downslope neighbours until the angle of repose "
             "is satisfied. Gravity-dependent: the envelope narrows critical_slope "
             "by sqrt(g_earth/g), so low-gravity bodies keep steeper walls."),
    params=(
        ParamSpec("critical_slope", "float", 0.6, 0.05, 2.0, unit="relief/cell",
                  doc=("critical drop between adjacent cells, as a fraction of total "
                       "relief; stands in for the angle of repose, which at planetary "
                       "grid resolution is never reached in true m/m")),
        ParamSpec("iterations", "int", 20, 1, 120,
                  doc="relaxation steps; more = closer to the repose angle everywhere"),
        ParamSpec("rate", "float", 0.4, 0.05, 1.0, doc="fraction of excess moved per step"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    cost=14,
)
def thermal_talus(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation").copy()
    span = max(float(np.ptp(z)), 1e-9)
    # Work in relief-normalised units so the threshold is resolution-independent.
    sc = p["critical_slope"] * 0.02
    zn = z / span
    for _ in range(int(p["iterations"])):
        excess = np.zeros_like(zn)
        for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(zn, -dj, axis=1) if di == 0 else np.roll(zn, -di, axis=0)
            drop = zn - sh
            over = np.clip(drop - sc, 0.0, None)
            excess += over
        move = p["rate"] * 0.25 * excess
        zn = zn - move + fs.smooth(move, iters=1, alpha=0.9)
    fs.channels["elevation"] = zn * span


@operator(
    id="erosion.hydraulic_droplet",
    category="erosion",
    summary=("Particle-based hydraulic erosion: thousands of droplets advected down "
             "the gradient, each carrying a sediment capacity proportional to speed "
             "and slope. Cheaper than stream_power and produces plausible gullies, "
             "but drainage networks are statistical rather than solved. Use for "
             "detail passes or when the compute budget is tight."),
    params=(
        ParamSpec("droplets", "int", 20000, 500, 200000, log_scale=True,
                  doc="number of simulated droplets; the main cost knob"),
        ParamSpec("steps", "int", 48, 8, 200, doc="lifetime of each droplet"),
        ParamSpec("capacity", "float", 0.02, 0.001, 0.2, doc="sediment capacity scale"),
        ParamSpec("erosion_rate", "float", 0.3, 0.01, 1.0,
                  doc="how fast an undersaturated droplet picks up material"),
        ParamSpec("deposition_rate", "float", 0.3, 0.01, 1.0,
                  doc="how fast an oversaturated droplet drops its load"),
        ParamSpec("inertia", "float", 0.3, 0.0, 0.95, doc="momentum retained per step"),
        ParamSpec("evaporation", "float", 0.02, 0.0, 0.2,
                  doc="per-step water loss; shortens effective droplet range"),
    ),
    consumes=("elevation",),
    produces=("elevation", "sediment"),
    requires=("fluid_cycle",),
    cost=22,
)
def droplet(fs, p, ctx: Ctx) -> None:
    nlat, nlon = fs.shape
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    zn = (z / span).copy()
    deposited = np.zeros_like(zn)

    rng = ctx.rng
    npart = int(p["droplets"])
    runoff = fs.get("runoff", 1.0)
    pr = (runoff / max(runoff.sum(), 1e-9)).ravel()
    start = rng.choice(nlat * nlon, size=npart, p=pr)
    yi = (start // nlon).astype(np.float64)
    xi = (start % nlon).astype(np.float64)
    vy = np.zeros(npart)
    vx = np.zeros(npart)
    water = np.ones(npart)
    sed = np.zeros(npart)

    for _ in range(int(p["steps"])):
        iy = np.clip(yi.astype(np.int64), 0, nlat - 1)
        ix = np.mod(xi.astype(np.int64), nlon)
        gy = zn[np.clip(iy + 1, 0, nlat - 1), ix] - zn[np.clip(iy - 1, 0, nlat - 1), ix]
        gx = zn[iy, np.mod(ix + 1, nlon)] - zn[iy, np.mod(ix - 1, nlon)]
        vy = p["inertia"] * vy - (1.0 - p["inertia"]) * gy
        vx = p["inertia"] * vx - (1.0 - p["inertia"]) * gx
        norm = np.maximum(np.sqrt(vy * vy + vx * vx), 1e-9)
        vy, vx = vy / norm, vx / norm

        y2 = np.clip(yi + vy, 0, nlat - 1)
        x2 = np.mod(xi + vx, nlon)
        iy2 = y2.astype(np.int64)
        ix2 = x2.astype(np.int64)
        drop = zn[iy, ix] - zn[iy2, ix2]

        cap = np.maximum(drop, 0.0) * water * p["capacity"]
        take = np.where(sed > cap,
                        -(sed - cap) * p["deposition_rate"],
                        (cap - sed) * p["erosion_rate"])
        sed += take
        np.add.at(zn, (iy, ix), -take)
        np.add.at(deposited, (iy, ix), np.clip(-take, 0.0, None))

        water *= (1.0 - p["evaporation"])
        yi, xi = y2, x2

    fs.channels["elevation"] = fs.smooth(zn, iters=1, alpha=0.2) * span
    fs.set("sediment", fs.get("sediment") + normalise(deposited, 0.0, 1.0))


@operator(
    id="erosion.aeolian_dunes",
    category="erosion",
    summary=("Wind-driven transport: anisotropic smoothing along the prevailing wind "
             "plus transverse dune ripples, gated to low-slope sediment-rich areas. "
             "Requires an atmosphere; on tidally locked bodies set wind_from_deg to "
             "the terminator-driven circulation direction."),
    params=(
        ParamSpec("wind_from_deg", "float", 270.0, 0.0, 360.0, unit="deg",
                  doc="meteorological convention: direction the wind blows from"),
        ParamSpec("dune_wavelength", "float", 24.0, 4.0, 120.0, unit="cells",
                  doc="transverse dune spacing"),
        ParamSpec("dune_amplitude", "float", 0.03, 0.0, 0.25, unit="-",
                  doc="dune crest height as a fraction of total relief"),
        ParamSpec("abrasion", "float", 0.15, 0.0, 1.0,
                  doc="downwind smoothing of obstacles"),
        ParamSpec("slope_cutoff", "float", 0.25, 0.02, 1.0, unit="relief/cell",
                  doc="dunes only form where the per-cell drop is below this"),
    ),
    consumes=("elevation",),
    produces=("elevation",),
    requires=("aeolian",),
    cost=10,
)
def aeolian(fs, p, ctx: Ctx) -> None:
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-9)
    theta = np.radians(p["wind_from_deg"])
    ux, uy = np.sin(theta), np.cos(theta)

    slope = fs.slope_cells(z / span)
    sand = np.clip(1.0 - slope / max(p["slope_cutoff"] * 0.05, 1e-9), 0.0, 1.0)
    sand = sand * (0.4 + 0.6 * normalise(fs.get("sediment", 0.5), 0.0, 1.0))

    if p["abrasion"] > 0:
        sh = np.roll(z, int(np.sign(ux) or 1), axis=1)
        z = z + p["abrasion"] * sand * (sh - z) * 0.5

    phase = (fs.LON * uy - fs.LAT * ux) * fs.nlon / max(p["dune_wavelength"], 1.0)
    ripple = np.sin(phase) * 0.6 + 0.4 * np.sin(2.13 * phase + 1.7)
    jitter = 0.35 * perlin3(fs.xyz * 5.0, ctx.seed ^ 0xDEE)
    fs.channels["elevation"] = z + p["dune_amplitude"] * span * sand * (ripple + jitter)
