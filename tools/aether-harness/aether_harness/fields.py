"""Field container and noise primitives.

The domain is an equirectangular lat/lon lattice, but every noise sample is taken
in *3D on the unit sphere*. That buys two things for free:

  * seamlessness at the antimeridian (no wrap hacks),
  * no polar pinching (the classic failure of 2D-noise-on-a-sphere),

and it means the spec's parameters are projection-independent: the same numbers
drive an icosphere mesh, a voxel chunker, or a GPU shader.
"""

from __future__ import annotations

import numpy as np

CHANNELS_BASE = ("elevation", "uplift", "erodibility", "runoff", "sediment",
                 "temperature", "ice", "lava", "roughness")


class FieldSet:
    """Named 2D channels over a shared spherical lattice."""

    def __init__(self, nlat: int = 192, radius_m: float = 6.371e6):
        nlat = int(max(32, nlat))
        self.nlat = nlat
        self.nlon = nlat * 2
        self.radius_m = float(radius_m)

        # Cell centres avoid the poles exactly (no degenerate rows).
        self.lat = np.linspace(np.pi / 2, -np.pi / 2, nlat + 2)[1:-1]
        self.lon = np.linspace(-np.pi, np.pi, self.nlon, endpoint=False)
        LAT, LON = np.meshgrid(self.lat, self.lon, indexing="ij")
        self.LAT, self.LON = LAT, LON

        cl = np.cos(LAT)
        self.xyz = np.stack([cl * np.cos(LON), np.sin(LAT), cl * np.sin(LON)], axis=-1)
        self.area = np.cos(LAT)                                  # area weight per cell
        self.area /= self.area.sum()

        # Metric: cell size in metres, for slope computation.
        self.dlat_m = (np.pi / nlat) * self.radius_m
        self.dlon_m = np.maximum(cl, 1e-3) * (2 * np.pi / self.nlon) * self.radius_m

        self.channels: dict[str, np.ndarray] = {
            "elevation": np.zeros((nlat, self.nlon), dtype=np.float64)
        }
        self.log: list[str] = []

    # --- channel access ---------------------------------------------------- #
    def get(self, name: str, default: float = 0.0) -> np.ndarray:
        if name not in self.channels:
            self.channels[name] = np.full((self.nlat, self.nlon), default, dtype=np.float64)
        return self.channels[name]

    def has(self, name: str) -> bool:
        return name in self.channels

    def set(self, name: str, arr: np.ndarray) -> None:
        self.channels[name] = np.asarray(arr, dtype=np.float64)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.nlat, self.nlon)

    # --- differential operators (longitude wraps, latitude clamps) --------- #
    def gradient(self, arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        dz_dlat = np.gradient(arr, axis=0) / self.dlat_m
        dz_dlon = (np.roll(arr, -1, axis=1) - np.roll(arr, 1, axis=1)) / (2 * self.dlon_m)
        return dz_dlat, dz_dlon

    def slope(self, arr: np.ndarray) -> np.ndarray:
        """True gradient in m/m. Only meaningful when ``arr`` is in metres."""
        a, b = self.gradient(arr)
        return np.sqrt(a * a + b * b)

    def slope_cells(self, arr: np.ndarray) -> np.ndarray:
        """Dimensionless slope: change per meridional cell width.

        At planetary grid resolution a cell spans 50-200 km, so true m/m gradients
        are ~1e-5 and physical thresholds like the angle of repose can never be
        exceeded. Sub-grid processes therefore work in this per-cell measure, which
        is resolution-aware and comparable across bodies."""
        dz_dlat = np.gradient(arr, axis=0)
        dz_dlon = ((np.roll(arr, -1, axis=1) - np.roll(arr, 1, axis=1)) / 2.0
                   * (self.dlat_m / self.dlon_m))
        return np.sqrt(dz_dlat ** 2 + dz_dlon ** 2)

    def smooth(self, arr: np.ndarray, iters: int = 1, alpha: float = 0.25) -> np.ndarray:
        out = arr
        for _ in range(max(0, int(iters))):
            lap = (np.roll(out, 1, axis=1) + np.roll(out, -1, axis=1)
                   + np.vstack([out[:1], out[:-1]]) + np.vstack([out[1:], out[-1:]])
                   - 4.0 * out)
            out = out + alpha * 0.25 * lap
        return out

    def wmean(self, arr: np.ndarray) -> float:
        return float((arr * self.area).sum())

    def wquantile(self, arr: np.ndarray, q: float) -> float:
        """Area-weighted quantile — matters a lot near the poles."""
        flat = arr.ravel()
        w = self.area.ravel()
        order = np.argsort(flat, kind="stable")
        cw = np.cumsum(w[order])
        idx = int(np.searchsorted(cw, q * cw[-1]))
        return float(flat[order[min(idx, flat.size - 1)]])


# --------------------------------------------------------------------------- #
# 3D gradient noise (Perlin-style, hash-seeded, no global RNG)
# --------------------------------------------------------------------------- #
_GRAD3 = np.array([
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
], dtype=np.float64)

_M1 = np.uint64(0x9E3779B97F4A7C15)
_M2 = np.uint64(0xBF58476D1CE4E5B9)
_M3 = np.uint64(0x94D049BB133111EB)


def _hash3(ix, iy, iz, seed: int):
    h = (ix.astype(np.uint64) * np.uint64(0x27220A95)
         ^ iy.astype(np.uint64) * np.uint64(0x85EBCA6B)
         ^ iz.astype(np.uint64) * np.uint64(0xC2B2AE35)
         ^ np.uint64(seed & 0xFFFFFFFFFFFFFFFF))
    h = (h ^ (h >> np.uint64(30))) * _M2
    h = (h ^ (h >> np.uint64(27))) * _M3
    h = h ^ (h >> np.uint64(31))
    return (h % np.uint64(16)).astype(np.int64)


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def perlin3(p: np.ndarray, seed: int) -> np.ndarray:
    """Value in roughly [-1, 1]. ``p`` is (..., 3)."""
    pi = np.floor(p)
    pf = p - pi
    ix, iy, iz = pi[..., 0], pi[..., 1], pi[..., 2]
    u, v, w = _fade(pf[..., 0]), _fade(pf[..., 1]), _fade(pf[..., 2])

    def dot(dx, dy, dz):
        g = _GRAD3[_hash3(ix + dx, iy + dy, iz + dz, seed)]
        return (g[..., 0] * (pf[..., 0] - dx)
                + g[..., 1] * (pf[..., 1] - dy)
                + g[..., 2] * (pf[..., 2] - dz))

    c000, c100 = dot(0, 0, 0), dot(1, 0, 0)
    c010, c110 = dot(0, 1, 0), dot(1, 1, 0)
    c001, c101 = dot(0, 0, 1), dot(1, 0, 1)
    c011, c111 = dot(0, 1, 1), dot(1, 1, 1)

    x00 = c000 + u * (c100 - c000)
    x10 = c010 + u * (c110 - c010)
    x01 = c001 + u * (c101 - c001)
    x11 = c011 + u * (c111 - c011)
    y0 = x00 + v * (x10 - x00)
    y1 = x01 + v * (x11 - x01)
    return (y0 + w * (y1 - y0)) * 1.15


def fbm3(p: np.ndarray, seed: int, *, octaves: int = 6, frequency: float = 2.0,
         lacunarity: float = 2.0, gain: float = 0.5, mode: str = "fbm",
         warp: float = 0.0) -> np.ndarray:
    """Fractal sum of perlin3. ``mode`` in {fbm, ridged, billow}.

    ``warp`` applies one level of domain warping using an independent noise field,
    which is what turns bland fBm into something that reads as geologically
    organised (curved ranges instead of isotropic mush).
    """
    q = p * frequency
    if warp > 0.0:
        wx = perlin3(q + 11.3, seed ^ 0x51ED)
        wy = perlin3(q + 47.7, seed ^ 0x2C9A)
        wz = perlin3(q + 91.1, seed ^ 0x7B3F)
        q = q + warp * np.stack([wx, wy, wz], axis=-1)

    total = np.zeros(p.shape[:-1], dtype=np.float64)
    amp, norm = 1.0, 0.0
    for o in range(max(1, int(octaves))):
        n = perlin3(q, seed + o * 7919)
        if mode == "ridged":
            n = 1.0 - np.abs(n)
            n = n * n * 2.0 - 1.0
        elif mode == "billow":
            n = np.abs(n) * 2.0 - 1.0
        total += amp * n
        norm += amp
        q = q * lacunarity
        amp *= gain
    return total / max(norm, 1e-9)


def spectral_fbm(fs: FieldSet, seed: int, *, beta: float = 2.0, octaves: int = 8,
                 frequency: float = 2.0) -> np.ndarray:
    """1/f^beta synthesis via octave weighting.

    beta controls hypsometry directly: beta~1 gives rough, self-similar, "young"
    surfaces; beta~2.5 gives smooth, long-wavelength, "relaxed" ones. Exposing
    beta rather than raw gain is what lets the LLM reason about landform character
    instead of fiddling with amplitudes.
    """
    total = np.zeros(fs.shape, dtype=np.float64)
    norm = 0.0
    for o in range(max(1, int(octaves))):
        f = frequency * (2.0 ** o)
        amp = f ** (-beta / 2.0)
        total += amp * perlin3(fs.xyz * f, seed + 104729 * o)
        norm += amp
    return total / max(norm, 1e-9)


def worley3(p: np.ndarray, seed: int, *, frequency: float = 6.0,
            jitter: float = 0.9, kind: str = "f1") -> np.ndarray:
    """Cellular noise; ``kind`` in {f1, f2f1, cell_id}. Returns ~[0,1]."""
    q = p * frequency
    base = np.floor(q)
    f1 = np.full(p.shape[:-1], 1e9)
    f2 = np.full(p.shape[:-1], 1e9)
    cid = np.zeros(p.shape[:-1])
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = base + np.array([dx, dy, dz], dtype=np.float64)
                hx = _hash3(c[..., 0], c[..., 1], c[..., 2], seed)
                hy = _hash3(c[..., 0], c[..., 1], c[..., 2], seed ^ 0x9E37)
                hz = _hash3(c[..., 0], c[..., 1], c[..., 2], seed ^ 0x1234)
                off = 0.5 + jitter * (np.stack([hx, hy, hz], axis=-1) / 16.0 - 0.5)
                d = np.linalg.norm(c + off - q, axis=-1)
                newer = d < f1
                f2 = np.where(newer, f1, np.minimum(f2, d))
                cid = np.where(newer, (hx * 16 + hy) / 256.0, cid)
                f1 = np.where(newer, d, f1)
    if kind == "f2f1":
        return np.clip(f2 - f1, 0.0, 1.0)
    if kind == "cell_id":
        return cid
    return np.clip(f1, 0.0, 1.0)


def normalise(arr: np.ndarray, lo: float = 0.0, hi: float = 1.0) -> np.ndarray:
    a, b = float(np.min(arr)), float(np.max(arr))
    if b - a < 1e-12:
        return np.full_like(arr, (lo + hi) * 0.5)
    return lo + (arr - a) * (hi - lo) / (b - a)
