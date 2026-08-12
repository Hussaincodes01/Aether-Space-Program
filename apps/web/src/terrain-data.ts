/**
 * Pure terrain geometry generation — no Three.js, no DOM.
 *
 * Kept free of rendering imports so it can run inside a Web Worker. Measured at ~273 ms for
 * a 10k-vertex sphere and ~1.1 s at 40k, which is far too long to spend on the main thread:
 * that is eighteen dropped frames at the low end, and the user sees a frozen tab.
 *
 * Everything here returns transferable typed arrays, so handing the result back to the main
 * thread costs a pointer move rather than a structured clone.
 */

import {
  compileTerrainProgram,
  evaluateTerrain,
  reliefRange,
  type PlanetContext,
} from "@aether/terrain";

export interface TerrainRequest {
  context: PlanetContext;
  seed: string;
  subdivisions: number;
  terrainExaggeration: number;
  substellarDir: { x: number; y: number; z: number };
}

export interface TerrainData {
  positions: Float32Array;
  normals: Float32Array;
  colours: Float32Array;
  indices: Uint32Array;
  reliefM: { minM: number; maxM: number };
  vertexCount: number;
  operators: string[];
}

// ── Icosphere ───────────────────────────────────────────────────────────────────────────

function icosphere(subdivisions: number): { dirs: Float32Array; indices: Uint32Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x!, y!, z!);
    return [x! / l, y! / l, z! / l];
  });

  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const midpoints = new Map<number, number>();
    const next: number[][] = [];

    const midpoint = (a: number, b: number): number => {
      // Pack the edge into one integer key — far cheaper than string concatenation, which
      // dominates the profile at 40k vertices.
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * 0x10_0000 + hi;
      const cached = midpoints.get(key);
      if (cached !== undefined) return cached;

      const va = vertices[a]!;
      const vb = vertices[b]!;
      const mx = (va[0]! + vb[0]!) / 2;
      const my = (va[1]! + vb[1]!) / 2;
      const mz = (va[2]! + vb[2]!) / 2;
      const l = Math.hypot(mx, my, mz);
      vertices.push([mx / l, my / l, mz / l]);
      const index = vertices.length - 1;
      midpoints.set(key, index);
      return index;
    };

    for (const [a, b, c] of faces) {
      const ab = midpoint(a!, b!);
      const bc = midpoint(b!, c!);
      const ca = midpoint(c!, a!);
      next.push([a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const dirs = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    dirs[i * 3] = v[0]!;
    dirs[i * 3 + 1] = v[1]!;
    dirs[i * 3 + 2] = v[2]!;
  });

  const indices = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => {
    indices[i * 3] = f[0]!;
    indices[i * 3 + 1] = f[1]!;
    indices[i * 3 + 2] = f[2]!;
  });

  return { dirs, indices };
}

/** Area-weighted vertex normals from the displaced mesh. */
function computeNormals(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
): Float32Array {
  const normals = new Float32Array(vertexCount * 3);

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;

    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;

    // Not normalised: the cross-product magnitude is twice the triangle area, which weights
    // each face by its size and gives smoother results on an irregular mesh.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    for (const idx of [a, b, c]) {
      normals[idx]! += nx;
      normals[idx + 1]! += ny;
      normals[idx + 2]! += nz;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (l > 0) {
      normals[i]! /= l;
      normals[i + 1]! /= l;
      normals[i + 2]! /= l;
    }
  }

  return normals;
}

// ── Surface palette ─────────────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

const COLOURS = {
  ocean: [0.05, 0.16, 0.29] as Rgb,
  shallow: [0.11, 0.35, 0.48] as Rgb,
  lava: [1.0, 0.35, 0.12] as Rgb,
  lavaCrust: [0.16, 0.08, 0.06] as Rgb,
  ice: [0.87, 0.92, 0.95] as Rgb,
  regolith: [0.42, 0.4, 0.38] as Rgb,
  basalt: [0.29, 0.27, 0.25] as Rgb,
  sand: [0.66, 0.57, 0.42] as Rgb,
  highland: [0.54, 0.5, 0.44] as Rgb,
  vegetation: [0.29, 0.39, 0.22] as Rgb,
};

function lerpInto(out: Rgb, target: Rgb, t: number): void {
  const k = Math.min(1, Math.max(0, t));
  out[0] += (target[0] - out[0]) * k;
  out[1] += (target[1] - out[1]) * k;
  out[2] += (target[2] - out[2]) * k;
}

/**
 * Colour a point from what the physics says is there.
 *
 * A rule-based lookup over the same context that gated the operators, not a palette chosen
 * by eye. A world with no stable liquid never gets an ocean colour, however much better it
 * might look.
 */
function surfaceColour(
  context: PlanetContext,
  heightM: number,
  normalisedHeight: number,
  slope: number,
  climate: number,
  out: Rgb,
): void {
  if (context.surfaceTemperatureK >= 1400) {
    out[0] = COLOURS.lavaCrust[0];
    out[1] = COLOURS.lavaCrust[1];
    out[2] = COLOURS.lavaCrust[2];
    lerpInto(out, COLOURS.lava, Math.pow(1 - normalisedHeight, 2.5));
    return;
  }

  if (context.hydrosphereFraction > 0.02 && heightM < 0) {
    const depth = Math.min(1, -heightM / 3000);
    out[0] = COLOURS.shallow[0];
    out[1] = COLOURS.shallow[1];
    out[2] = COLOURS.shallow[2];
    lerpInto(out, COLOURS.ocean, depth);
    return;
  }

  // Airless bodies are grey regolith; a body with an atmosphere weathers to tan.
  const base = context.surfacePressurePa > 1000 ? COLOURS.sand : COLOURS.regolith;
  out[0] = base[0];
  out[1] = base[1];
  out[2] = base[2];

  lerpInto(out, COLOURS.highland, Math.min(1, Math.max(0, normalisedHeight)) * 0.7);
  // Steep faces shed regolith and expose bedrock.
  lerpInto(out, COLOURS.basalt, Math.min(1, slope * 1.8));

  // Vegetation is a strong claim, so it stays subtle even where conditions permit it.
  if (
    context.stableLiquid === "water" &&
    context.surfaceTemperatureK > 260 &&
    context.surfaceTemperatureK < 320 &&
    context.hydrosphereFraction > 0.1
  ) {
    const lowland = 1 - Math.min(1, Math.abs(normalisedHeight));
    lerpInto(out, COLOURS.vegetation, lowland * 0.35 * (1 - climate));
  }

  if (context.hasStableIce) {
    const cold = Math.max(0, (climate - 0.62) / 0.38);
    lerpInto(out, COLOURS.ice, Math.min(1, cold * cold) * (1 - Math.min(1, slope * 2)));
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────────────────

export function generateTerrainData(request: TerrainRequest): TerrainData {
  const { context, seed, subdivisions, terrainExaggeration, substellarDir } = request;

  const program = compileTerrainProgram({ context, seed });
  const { dirs, indices } = icosphere(subdivisions);
  const vertexCount = dirs.length / 3;

  const evalOptions = {
    radiusM: context.radiusM,
    tidallyLocked: context.tidallyLocked,
    substellarDir,
  };

  const reliefM = reliefRange(program, evalOptions, 1500);
  const span = Math.max(reliefM.maxM - reliefM.minM, 1);

  const positions = new Float32Array(vertexCount * 3);
  const colours = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const dx = dirs[i * 3]!;
    const dy = dirs[i * 3 + 1]!;
    const dz = dirs[i * 3 + 2]!;

    const { heightM } = evaluateTerrain(program, { x: dx, y: dy, z: dz }, evalOptions);
    heights[i] = heightM;

    const r = context.radiusM + heightM * terrainExaggeration;
    positions[i * 3] = dx * r;
    positions[i * 3 + 1] = dy * r;
    positions[i * 3 + 2] = dz * r;
  }

  const normals = computeNormals(positions, indices, vertexCount);

  const colour: Rgb = [0, 0, 0];
  for (let i = 0; i < vertexCount; i++) {
    const dx = dirs[i * 3]!;
    const dy = dirs[i * 3 + 1]!;
    const dz = dirs[i * 3 + 2]!;

    const dot = normals[i * 3]! * dx + normals[i * 3 + 1]! * dy + normals[i * 3 + 2]! * dz;
    const slope = Math.min(1, Math.max(0, 1 - dot));

    const climate = context.tidallyLocked
      ? Math.acos(
          Math.min(1, Math.max(-1, dx * substellarDir.x + dy * substellarDir.y + dz * substellarDir.z)),
        ) / Math.PI
      : Math.abs(Math.asin(Math.min(1, Math.max(-1, dy)))) / (Math.PI / 2);

    const normalised = ((heights[i]! - reliefM.minM) / span) * 2 - 1;
    surfaceColour(context, heights[i]!, normalised, slope, climate, colour);

    colours[i * 3] = colour[0];
    colours[i * 3 + 1] = colour[1];
    colours[i * 3 + 2] = colour[2];
  }

  return {
    positions,
    normals,
    colours,
    indices,
    reliefM,
    vertexCount,
    operators: program.operators.map((o) => o.op),
  };
}
