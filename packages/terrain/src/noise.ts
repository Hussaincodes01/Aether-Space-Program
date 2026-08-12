/**
 * Deterministic noise primitives.
 *
 * Everything here is built on **integer** hashing, not float hashing. The usual
 * `fract(sin(dot(p, k)) * 43758.5453)` trick falls apart at planetary coordinates — the
 * sine argument grows large enough that neighbouring sample points collapse onto the same
 * value and the surface goes visibly blotchy. The C++ reference implementation hit exactly
 * this and had to switch to a 32-bit integer hash to keep detail coherent at planet scale.
 *
 * Determinism is the point. The same planet must grow the same mountain in the same place
 * on every machine, so nothing here touches `Math.random`, wall-clock time, or any float
 * operation whose last bit could differ between platforms.
 */

/** Hermite interpolation between two edges. Returns 0 below `a`, 1 above `b`. */
export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 32-bit integer hash. Avalanches well and stays exact in JS's int32 range. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed >>> 0;
  h = (Math.imul(h ^ (x | 0), 0x27d4eb2d) ^ (h >>> 15)) >>> 0;
  h = (Math.imul(h ^ (y | 0), 0x165667b1) ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h ^ (z | 0), 0x9e3779b1) ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Hash to the unit interval. */
function unit(h: number): number {
  return h / 0x1_0000_0000;
}

/** Quintic smoothstep — C2 continuous, so derived normals stay smooth. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 3D value noise in [-1, 1].
 *
 * Value rather than gradient noise: it is cheaper, and at the frequencies used here the
 * visual difference is negligible once several octaves are stacked.
 */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);

  const corner = (dx: number, dy: number, dz: number): number =>
    unit(hash3(xi + dx, yi + dy, zi + dz, seed));

  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), xf);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), xf);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), xf);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), xf);

  const y0 = lerp(x00, x10, yf);
  const y1 = lerp(x01, x11, yf);

  return lerp(y0, y1, zf) * 2 - 1;
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
}

/** Fractal Brownian motion. The base layer for continents and general roughness. */
export function fbm(
  x: number,
  y: number,
  z: number,
  seed: number,
  options: FbmOptions = {},
): number {
  const octaves = options.octaves ?? 5;
  const lacunarity = options.lacunarity ?? 2.03;
  const gain = options.gain ?? 0.5;

  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalisation = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 7919);
    normalisation += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return normalisation > 0 ? sum / normalisation : 0;
}

/**
 * Ridged multifractal, in [0, 1].
 *
 * Folding the noise about zero and inverting produces sharp crests, which is what makes
 * mountain chains and fracture networks read as linear features rather than blobs.
 */
export function ridged(
  x: number,
  y: number,
  z: number,
  seed: number,
  options: FbmOptions = {},
): number {
  const octaves = options.octaves ?? 5;
  const lacunarity = options.lacunarity ?? 2.03;
  const gain = options.gain ?? 0.5;

  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalisation = 0;

  for (let i = 0; i < octaves; i++) {
    const n = valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 6229);
    sum += amplitude * (1 - Math.abs(n));
    normalisation += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return normalisation > 0 ? sum / normalisation : 0;
}

export interface WorleyResult {
  /** Distance to the nearest feature point, roughly 0..1 at unit cell size. */
  f1: number;
  /** Distance to the second nearest. `f2 - f1` gives clean cell borders. */
  f2: number;
}

/**
 * Worley (cellular) noise — the crater generator.
 *
 * Each grid cell holds one feature point; `f1` is the distance to the nearest. Craters are
 * drawn as a radial profile about those points, which is why the impact operator wants the
 * distance rather than a plain noise value.
 */
export function worley3(x: number, y: number, z: number, seed: number): WorleyResult {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);

  let f1 = Infinity;
  let f2 = Infinity;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;

        const h = hash3(cx, cy, cz, seed);
        // Three decorrelated offsets from one hash, so a feature point can sit anywhere
        // inside its cell rather than on a lattice.
        const px = cx + unit(h);
        const py = cy + unit(Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
        const pz = cz + unit(Math.imul(h ^ 0x165667b1, 0x27d4eb2d) >>> 0);

        const ddx = px - x;
        const ddy = py - y;
        const ddz = pz - z;
        const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }

  return { f1, f2 };
}

/**
 * Domain warping — offset the sample point by another noise field.
 *
 * This is what stops continents looking like noise and starts them looking like coastlines:
 * it introduces the meandering, non-isotropic structure that plain fBm cannot produce.
 */
export function warp(
  x: number,
  y: number,
  z: number,
  seed: number,
  strength: number,
): [number, number, number] {
  const wx = fbm(x, y, z, seed + 1013, { octaves: 2 });
  const wy = fbm(x + 5.2, y + 1.3, z + 2.7, seed + 2027, { octaves: 2 });
  const wz = fbm(x + 9.7, y + 4.1, z + 6.3, seed + 3041, { octaves: 2 });
  return [x + wx * strength, y + wy * strength, z + wz * strength];
}
