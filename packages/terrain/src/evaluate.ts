/**
 * Turning a compiled terrain program into actual height.
 *
 * Operators run in layer order, each seeing what the previous ones produced, so erosion
 * cuts into construction rather than being blended with it. That sequencing is the whole
 * reason this is not just a sum of noise fields: a river valley has to know where the
 * mountain is.
 */

import { getOperator } from "./registry.js";
import { hash32 } from "./seed-util.js";
import type { CompiledTerrainProgram, EvalContext } from "./types.js";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface TerrainSample {
  /** Displacement from the datum, metres. Signed: basins are real geometry, not painted. */
  heightM: number;
  /** Per-operator contribution, so the inspector can attribute any feature to a process. */
  contributions: Record<string, number>;
}

export interface EvaluateOptions {
  radiusM: number;
  /** Direction of the substellar point. Defaults to +X. */
  substellarDir?: Vec3Like;
  tidallyLocked?: boolean;
}

function normalise(v: Vec3Like): Vec3Like {
  const len = Math.hypot(v.x, v.y, v.z);
  return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 1, z: 0 };
}

/**
 * Sample the terrain at one direction on the sphere.
 *
 * Deterministic by construction: the only inputs are the program, the direction and the
 * seed, and every noise call is integer-hashed. The same planet grows the same mountain in
 * the same place on every machine.
 */
export function evaluateTerrain(
  program: CompiledTerrainProgram,
  direction: Vec3Like,
  options: EvaluateOptions,
): TerrainSample {
  const dir = normalise(direction);
  const substellar = normalise(options.substellarDir ?? { x: 1, y: 0, z: 0 });

  const latitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const dot = dir.x * substellar.x + dir.y * substellar.y + dir.z * substellar.z;
  const substellarAngle = Math.acos(Math.max(-1, Math.min(1, dot)));

  const worldSeed = hash32(program.seed);
  const contributions: Record<string, number> = {};
  let heightM = 0;

  for (const compiled of program.operators) {
    const operator = getOperator(compiled.op);
    if (!operator?.evaluate) continue;

    const context: EvalContext = {
      dir,
      params: compiled.params,
      // Decorrelate operators so two processes on the same world do not share features.
      seed: hash32(`${worldSeed}:${compiled.op}`),
      radiusM: options.radiusM,
      latitude,
      substellarAngle,
      tidallyLocked: options.tidallyLocked ?? false,
      heightSoFarM: heightM,
    };

    const delta = operator.evaluate(context);
    if (Number.isFinite(delta) && delta !== 0) {
      contributions[compiled.op] = delta;
      heightM += delta;
    }
  }

  return { heightM, contributions };
}

/**
 * Convert a feature size in kilometres to an angular frequency on the unit sphere.
 *
 * A 1800 km feature on an Earth-sized planet should appear roughly 22 times around the
 * circumference, and this is what makes the same operator produce sensibly-sized features
 * on bodies of very different radius.
 */
export function frequencyForScale(scaleKm: number, radiusM: number): number {
  const circumferenceKm = (2 * Math.PI * radiusM) / 1000;
  return Math.max(0.5, circumferenceKm / Math.max(scaleKm, 1));
}

/**
 * Surface normal from finite differences of the displaced surface.
 *
 * Computed by sampling two nearby points and taking the cross product of the resulting
 * tangents. Analytic derivatives would be faster but every operator would have to supply
 * one, and getting a single derivative wrong produces lighting that is subtly and
 * confusingly wrong rather than obviously broken.
 */
export function terrainNormal(
  program: CompiledTerrainProgram,
  direction: Vec3Like,
  options: EvaluateOptions,
  epsilon = 1e-3,
): Vec3Like {
  const dir = normalise(direction);

  // Build an orthonormal tangent basis, avoiding the degenerate case near the poles.
  const up = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const t1 = normalise({
    x: up.y * dir.z - up.z * dir.y,
    y: up.z * dir.x - up.x * dir.z,
    z: up.x * dir.y - up.y * dir.x,
  });
  const t2 = {
    x: dir.y * t1.z - dir.z * t1.y,
    y: dir.z * t1.x - dir.x * t1.z,
    z: dir.x * t1.y - dir.y * t1.x,
  };

  const at = (offset: Vec3Like): Vec3Like => {
    const p = normalise({
      x: dir.x + offset.x,
      y: dir.y + offset.y,
      z: dir.z + offset.z,
    });
    const r = options.radiusM + evaluateTerrain(program, p, options).heightM;
    return { x: p.x * r, y: p.y * r, z: p.z * r };
  };

  const centre = at({ x: 0, y: 0, z: 0 });
  const a = at({ x: t1.x * epsilon, y: t1.y * epsilon, z: t1.z * epsilon });
  const b = at({ x: t2.x * epsilon, y: t2.y * epsilon, z: t2.z * epsilon });

  const u = { x: a.x - centre.x, y: a.y - centre.y, z: a.z - centre.z };
  const v = { x: b.x - centre.x, y: b.y - centre.y, z: b.z - centre.z };

  const n = normalise({
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  });

  // Keep the normal on the outward side; the cross-product order flips near the poles.
  const outward = n.x * dir.x + n.y * dir.y + n.z * dir.z;
  return outward < 0 ? { x: -n.x, y: -n.y, z: -n.z } : n;
}

/** Peak-to-trough relief across a sample of the surface, for HUD and QA. */
export function reliefRange(
  program: CompiledTerrainProgram,
  options: EvaluateOptions,
  samples = 2000,
): { minM: number; maxM: number } {
  let minM = Infinity;
  let maxM = -Infinity;

  // Fibonacci sphere: even coverage without clustering at the poles.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const h = evaluateTerrain(
      program,
      { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius },
      options,
    ).heightM;
    if (h < minM) minM = h;
    if (h > maxM) maxM = h;
  }

  return { minM, maxM };
}
