/**
 * Keplerian orbital mechanics.
 *
 * Position from orbital elements is three rotation matrices applied in sequence. Writing
 * them out explicitly rather than collapsing to a trigonometric one-liner is deliberate:
 * the composed form is impossible to check by eye, and the order of rotations is exactly
 * where this goes wrong.
 *
 *   r_ecliptic = Rz(Ω) · Rx(i) · Rz(ω) · r_orbital
 *
 * Reading right to left: rotate within the orbital plane by the argument of periapsis, tilt
 * the plane by the inclination, then swing the ascending node round to its longitude.
 */

/** Classical orbital elements at an epoch, angles in radians, distances in metres. */
export interface OrbitalElements {
  /** Semi-major axis, metres. */
  semiMajorAxisM: number;
  eccentricity: number;
  /** Inclination to the ecliptic. */
  inclinationRad: number;
  /** Longitude of the ascending node, Ω. */
  ascendingNodeRad: number;
  /** Argument of periapsis, ω. */
  argumentOfPeriapsisRad: number;
  /** Mean anomaly at epoch, M₀. */
  meanAnomalyAtEpochRad: number;
  /** Gravitational parameter of the primary, GM, in m³/s². */
  gravitationalParameter: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A 3×3 matrix in row-major order. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function rotationZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function rotationX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k]! * b[k * 3 + col]!;
      out[row * 3 + col] = sum;
    }
  }
  return out as unknown as Mat3;
}

export function transform(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/**
 * The orbital-plane to ecliptic transform, as an explicit matrix product.
 *
 * Cached by callers where the elements are static, since the rotation only changes when
 * the elements precess.
 */
export function perifocalToEcliptic(elements: OrbitalElements): Mat3 {
  return multiplyMat3(
    multiplyMat3(rotationZ(elements.ascendingNodeRad), rotationX(elements.inclinationRad)),
    rotationZ(elements.argumentOfPeriapsisRad),
  );
}

/** Orbital period from Kepler's third law: T = 2π√(a³/GM). */
export function orbitalPeriod(elements: OrbitalElements): number {
  return (
    2 * Math.PI * Math.sqrt(elements.semiMajorAxisM ** 3 / elements.gravitationalParameter)
  );
}

export function meanMotion(elements: OrbitalElements): number {
  return Math.sqrt(elements.gravitationalParameter / elements.semiMajorAxisM ** 3);
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly.
 *
 * Newton–Raphson. Converges in a handful of iterations below e ≈ 0.9; the starting guess
 * is shifted for high eccentricity, where E ≈ M diverges. Every Solar System planet is
 * below e = 0.21, so this is comfortable — but the guard matters for comets, and returning
 * a silently unconverged answer would be worse than being slow.
 */
export function solveKepler(meanAnomalyRad: number, eccentricity: number): number {
  // Wrap into [-π, π] so the solver starts near the root.
  let M = meanAnomalyRad % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  let E = eccentricity < 0.8 ? M : Math.PI * Math.sign(M || 1);

  for (let i = 0; i < 60; i++) {
    const f = E - eccentricity * Math.sin(E) - M;
    const df = 1 - eccentricity * Math.cos(E);
    const delta = f / df;
    E -= delta;
    if (Math.abs(delta) < 1e-12) return E;
  }

  return E;
}

/** True anomaly from eccentric anomaly. */
export function trueAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  const halfE = eccentricAnomalyRad / 2;
  return (
    2 *
    Math.atan2(
      Math.sqrt(1 + eccentricity) * Math.sin(halfE),
      Math.sqrt(1 - eccentricity) * Math.cos(halfE),
    )
  );
}

export interface StateVector {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Position and velocity at a time offset from the element epoch.
 *
 * @param secondsSinceEpoch Seconds since the elements' epoch (J2000 for the bundled data).
 */
export function stateAt(
  elements: OrbitalElements,
  secondsSinceEpoch: number,
  cachedRotation?: Mat3,
): StateVector {
  const { semiMajorAxisM: a, eccentricity: e, gravitationalParameter: mu } = elements;

  const M = elements.meanAnomalyAtEpochRad + meanMotion(elements) * secondsSinceEpoch;
  const E = solveKepler(M, e);
  const nu = trueAnomaly(E, e);

  // Distance from the focus.
  const r = a * (1 - e * Math.cos(E));

  // Perifocal frame: periapsis along +x, motion toward +y.
  const perifocalPosition: Vec3 = {
    x: r * Math.cos(nu),
    y: r * Math.sin(nu),
    z: 0,
  };

  const p = a * (1 - e * e);
  const h = Math.sqrt(mu * p);
  const perifocalVelocity: Vec3 = {
    x: -((mu / h) * Math.sin(nu)),
    y: (mu / h) * (e + Math.cos(nu)),
    z: 0,
  };

  const rotation = cachedRotation ?? perifocalToEcliptic(elements);

  return {
    position: transform(rotation, perifocalPosition),
    velocity: transform(rotation, perifocalVelocity),
  };
}

/** Sample points along a full orbit, for drawing the path. */
export function sampleOrbit(elements: OrbitalElements, samples = 256): Vec3[] {
  const rotation = perifocalToEcliptic(elements);
  const { semiMajorAxisM: a, eccentricity: e } = elements;
  const points: Vec3[] = [];

  for (let i = 0; i <= samples; i++) {
    // Step in eccentric anomaly rather than true anomaly: it distributes points evenly
    // along the ellipse instead of bunching them at periapsis.
    const E = (i / samples) * 2 * Math.PI;
    const nu = trueAnomaly(E, e);
    const r = a * (1 - e * Math.cos(E));
    points.push(transform(rotation, { x: r * Math.cos(nu), y: r * Math.sin(nu), z: 0 }));
  }

  return points;
}

/** Julian date of the J2000.0 epoch. */
export const J2000_JD = 2451545.0;

/** Seconds from J2000 to a JavaScript Date. */
export function secondsSinceJ2000(date: Date): number {
  // J2000.0 is 2000-01-01T12:00:00 TT. The couple of minutes between TT and UTC are far
  // below the precision the approximate elements themselves offer.
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  return (date.getTime() - j2000) / 1000;
}
