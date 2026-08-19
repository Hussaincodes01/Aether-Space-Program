"""Reference executor.

Important framing: the *product* of this harness is the frozen JSON spec, not this
renderer. The spec is engine-agnostic — the same parameters drive an icosphere mesh
in Three.js, a chunked voxelizer, or a GPU compute pass. This numpy executor exists
so the harness can (a) prove a spec is executable before freezing it and (b) score
the result, which is what closes the loop on quality.

Masking and stage weighting are applied here, uniformly, by snapshotting the
channels an operator declares it produces and blending the delta. Operators
therefore never need to know about masks, which keeps them small and testable.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import numpy as np

from .fields import FieldSet, normalise
from .models import TerrainSpec
from .registry import Ctx, Registry


@dataclass
class RunReport:
    planet_id: str
    content_hash: str
    resolution: tuple[int, int]
    seconds: float = 0.0
    stage_times: dict[str, float] = field(default_factory=dict)
    diagnostics: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"planet_id": self.planet_id, "content_hash": self.content_hash,
                "resolution": list(self.resolution), "seconds": round(self.seconds, 3),
                "stage_times": {k: round(v, 4) for k, v in self.stage_times.items()},
                "diagnostics": {k: round(v, 6) for k, v in self.diagnostics.items()},
                "warnings": self.warnings}


def execute(spec: TerrainSpec, registry: Registry, *, resolution: int | None = None
            ) -> tuple[FieldSet, RunReport]:
    res = int(resolution or spec.grid.base_resolution_lat)
    fs = FieldSet(nlat=res, radius_m=spec.grid.body_radius_m)
    rep = RunReport(spec.planet_id, spec.content_hash, fs.shape)
    t0 = time.perf_counter()

    for i, stage in enumerate(spec.pipeline):
        if not stage.enabled:
            continue
        op = registry.get(stage.op)
        if op is None:
            rep.warnings.append(f"{stage.id}: unknown operator {stage.op}, skipped")
            continue

        seed = spec.stage_seed(i)
        mask = None
        if stage.mask:
            if not fs.has(stage.mask):
                # A declared-but-unwritten mask channel would gate the stage to zero
                # and silently disable it, which is far worse than ignoring the mask.
                rep.warnings.append(
                    f"{stage.id}: mask channel '{stage.mask}' was never written; "
                    "stage applied unmasked")
            else:
                mask = np.clip(fs.get(stage.mask), 0.0, 1.0)
        ctx = Ctx(seed=seed, rng=np.random.default_rng(seed & 0xFFFFFFFF),
                  stage_id=stage.id, derived=spec.derived, grid=spec.grid, mask=mask)

        touched = tuple(c for c in op.produces if fs.has(c)) or ("elevation",)
        # Always snapshot: needed for mask/weight blending and for the sanity revert.
        before = {c: fs.get(c).copy() for c in touched}

        ts = time.perf_counter()
        try:
            op.apply(fs, dict(stage.params), ctx)
        except Exception as exc:                    # never let one stage kill a universe
            rep.warnings.append(f"{stage.id} ({stage.op}) raised {type(exc).__name__}: {exc}")
            if before:
                for c, arr in before.items():
                    fs.set(c, arr)
            continue
        rep.stage_times[stage.id] = time.perf_counter() - ts

        bad = _sanity_problem(fs, before)
        if bad:
            rep.warnings.append(f"{stage.id} ({stage.op}) produced {bad}; stage reverted")
            snapshot = before if before is not None else {}
            for c, arr in snapshot.items():
                fs.set(c, arr)
            if before is None:
                fs.set("elevation", np.nan_to_num(fs.get("elevation"), nan=0.0,
                                                  posinf=0.0, neginf=0.0))
            continue

        if stage.weight < 1.0 or ctx.mask is not None:
            gate = stage.weight * (ctx.mask if ctx.mask is not None else 1.0)
            for c, prev in before.items():
                fs.set(c, prev + gate * (fs.get(c) - prev))

    # Final normalisation to physical metres about the datum.
    z = fs.get("elevation")
    span = max(float(np.ptp(z)), 1e-12)
    centre = fs.wquantile(z, spec.grid.sea_level_quantile
                          if spec.grid.sea_level_quantile is not None else 0.5)
    z_m = (z - centre) / span * spec.grid.elevation_range_m + spec.grid.reference_datum_m
    fs.set("elevation_m", z_m)
    if spec.grid.sea_level_quantile is not None:
        fs.set("mask_ocean", (z_m < spec.grid.reference_datum_m).astype(np.float64))

    rep.seconds = time.perf_counter() - t0
    rep.diagnostics = diagnostics(fs, spec)
    return fs, rep


def _sanity_problem(fs: FieldSet, before: dict | None) -> str | None:
    """Reject a stage whose output is non-finite or has exploded.

    An LLM can propose a parameter tuple that is inside every declared bound and
    still numerically unstable — bounds are per-parameter, instability is joint.
    Checking the field itself is the only complete defence, and reverting one stage
    degrades a planet instead of losing it."""
    z = fs.get("elevation")
    if not np.all(np.isfinite(z)):
        return "non-finite elevation"
    span = float(np.ptp(z))
    if span > 1e6:
        return f"runaway relief (span {span:.3g} in normalised units)"
    if before is not None and "elevation" in before:
        prev = float(np.ptp(before["elevation"]))
        if prev > 1e-9 and span > 100.0 * prev:
            return f"relief grew {span / prev:.0f}x in one stage"
    return None


def diagnostics(fs: FieldSet, spec: TerrainSpec) -> dict[str, float]:
    """Cheap, deterministic scalars used for scoring and regression tests."""
    z = fs.get("elevation_m")
    slope = fs.slope(z)
    hyps = np.array([fs.wquantile(z, q) for q in (0.05, 0.25, 0.5, 0.75, 0.95)])
    d = {
        "relief_m": float(np.ptp(z)),
        "mean_elevation_m": fs.wmean(z),
        "median_elevation_m": float(hyps[2]),
        "hypsometric_integral": float((hyps[2] - hyps[0]) / max(hyps[4] - hyps[0], 1e-9)),
        "mean_slope": fs.wmean(slope),
        "p95_slope": float(np.quantile(slope, 0.95)),
        "roughness": float(np.std(z - fs.smooth(z, iters=4, alpha=0.7)) / max(np.ptp(z), 1e-9)),
    }
    if fs.has("mask_ocean"):
        d["ocean_fraction"] = fs.wmean(fs.get("mask_ocean"))
    if fs.has("flow_accumulation"):
        acc = fs.get("flow_accumulation")
        d["drainage_density"] = fs.wmean((acc > np.quantile(acc, 0.9)).astype(float))
    if fs.has("mask_crater"):
        d["crater_coverage"] = fs.wmean((fs.get("mask_crater") > 0.5).astype(float))
    if fs.has("ice"):
        d["ice_coverage"] = fs.wmean((fs.get("ice") > 0.15).astype(float))
    return d


def export(fs: FieldSet, spec: TerrainSpec, rep: RunReport, outdir: str) -> list[str]:
    """Write heightmap PNG16, channel NPZ, spec JSON and run manifest."""
    import os
    os.makedirs(outdir, exist_ok=True)
    stem = f"{spec.planet_id.replace(' ', '_')}_{spec.content_hash[:10]}"
    written: list[str] = []

    z = fs.get("elevation_m")
    u16 = (normalise(z, 0.0, 1.0) * 65535.0).astype(np.uint16)
    png = os.path.join(outdir, f"{stem}_height.png")
    try:
        from PIL import Image
        Image.fromarray(u16, mode="I;16").save(png)
        written.append(png)
    except Exception:
        pgm = os.path.join(outdir, f"{stem}_height.pgm")
        with open(pgm, "wb") as fh:
            fh.write(f"P5\n{fs.nlon} {fs.nlat}\n65535\n".encode())
            fh.write(u16.astype(">u2").tobytes())
        written.append(pgm)

    npz = os.path.join(outdir, f"{stem}_channels.npz")
    np.savez_compressed(npz, **{k: v.astype(np.float32) for k, v in fs.channels.items()})
    written.append(npz)

    sp = os.path.join(outdir, f"{stem}_spec.json")
    with open(sp, "w") as fh:
        json.dump(spec.to_dict(), fh, indent=2)
    written.append(sp)

    mf = os.path.join(outdir, f"{stem}_run.json")
    with open(mf, "w") as fh:
        json.dump(rep.to_dict(), fh, indent=2)
    written.append(mf)
    return written


def preview_png(fs: FieldSet, path: str) -> str | None:
    """Shaded relief + ocean/ice tint. Purely for eyeballing a spec."""
    try:
        from PIL import Image
    except Exception:
        return None
    z = fs.get("elevation_m")
    zn = normalise(z, 0.0, 1.0)
    # Hillshade from the dimensionless per-cell gradient: true m/m gradients are ~1e-5
    # at planetary grid spacing and would render as a flat grey card.
    dy = np.gradient(zn, axis=0)
    dx = (np.roll(zn, -1, axis=1) - np.roll(zn, 1, axis=1)) / 2.0
    shade = np.clip(0.62 - 12.0 * (dx * 0.75 + dy * 0.66), 0.08, 1.35)
    n = zn

    rgb = np.stack([0.42 + 0.5 * n, 0.40 + 0.45 * n, 0.34 + 0.35 * n], axis=-1)
    if fs.has("mask_ocean"):
        m = fs.get("mask_ocean")[..., None]
        depth = normalise(np.clip(-z, 0.0, None), 0.0, 1.0)[..., None]
        rgb = rgb * (1 - m) + m * np.concatenate(
            [0.02 + 0.10 * (1 - depth), 0.12 + 0.30 * (1 - depth), 0.30 + 0.45 * (1 - depth)],
            axis=-1)
    if fs.has("ice"):
        ice = np.clip(fs.get("ice"), 0, 1)[..., None]
        rgb = rgb * (1 - 0.85 * ice) + 0.85 * ice * 0.92
    if fs.has("lava"):
        lv = np.clip(fs.get("lava"), 0, 1)[..., None]
        rgb = rgb * (1 - lv) + lv * np.concatenate(
            [0.85 + 0 * lv, 0.25 + 0 * lv, 0.05 + 0 * lv], axis=-1)

    img = np.clip(rgb * shade[..., None] * 1.7, 0, 1)
    Image.fromarray((img * 255).astype(np.uint8)).save(path)
    return path
