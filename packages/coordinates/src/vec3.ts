/**
 * Double-precision 3-vectors.
 *
 * JavaScript numbers are IEEE-754 binary64, so f64 world coordinates cost nothing here —
 * a genuine advantage of the web target over engines that must opt into doubles. The
 * discipline is to *keep* positions in this type all the way to the camera-relative
 * subtraction, and only then narrow to f32 for the GPU.
 *
 * Plain objects rather than classes: they are monomorphic, allocation is cheap and
 * predictable, and the in-place `*Into` variants exist for the per-frame hot path where
 * even that allocation is not wanted.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ZERO: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function clone(a: Readonly<Vec3>): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Readonly<Vec3>, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Readonly<Vec3>): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function lengthSquared(a: Readonly<Vec3>): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function normalise(a: Readonly<Vec3>): Vec3 {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : vec3();
}

// ── In-place variants for the per-frame hot path ────────────────────────────────────────

export function addInto(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function subInto(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function copyInto(out: Vec3, a: Readonly<Vec3>): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

/**
 * Narrow to f32, the only legal exit from f64 space.
 *
 * Call this **after** the camera-relative subtraction, never before. Narrowing an absolute
 * astronomical position is precisely the bug this package exists to prevent, so the name
 * is deliberately explicit rather than a generic `toArray`.
 */
export function toFloat32CameraRelative(cameraRelative: Readonly<Vec3>): Float32Array {
  return new Float32Array([cameraRelative.x, cameraRelative.y, cameraRelative.z]);
}

/** Convert sky coordinates to an inertial Cartesian position. */
export function fromSpherical(
  rightAscensionRad: number,
  declinationRad: number,
  distanceM: number,
): Vec3 {
  const cosDec = Math.cos(declinationRad);
  return {
    x: distanceM * cosDec * Math.cos(rightAscensionRad),
    y: distanceM * cosDec * Math.sin(rightAscensionRad),
    z: distanceM * Math.sin(declinationRad),
  };
}
