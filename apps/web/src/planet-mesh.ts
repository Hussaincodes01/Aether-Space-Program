/**
 * Building planet geometry from a compiled terrain program.
 *
 * An icosphere is subdivided, every vertex is displaced by `evaluateTerrain`, and the
 * surface is coloured from altitude, slope and climate. Nothing here invents a feature: if
 * a mountain is on screen, some gated operator put it there and the inspector can say which.
 *
 * ## The scale problem nobody expects
 *
 * Earth's full relief — Everest to the Mariana Trench — is about 20 km on a 6371 km radius.
 * That is 0.3%. Rendered at true scale a terrestrial planet is smoother than a billiard
 * ball, and every "realistic" planet you have ever seen in a game or a documentary is
 * exaggerated, usually by one to two orders of magnitude, silently.
 *
 * Aether exaggerates too, because a perfectly smooth sphere teaches nothing — but it says
 * so. The multiplier is a `VisualSpec` value, it is displayed in the HUD, and scientific
 * scale mode sets it to 1 so you can see the truth: an almost perfect sphere.
 */

import * as THREE from "three";
import {
  compileTerrainProgram,
  evaluateTerrain,
  reliefRange,
  type CompiledTerrainProgram,
  type PlanetContext,
} from "@aether/terrain";

export interface PlanetMeshOptions {
  context: PlanetContext;
  seed: string;
  /** Icosphere subdivisions. 5 gives ~10k vertices — enough detail, ~0.5 s to build. */
  subdivisions?: number;
  /**
   * Vertical exaggeration. 1 is physically true and looks like a billiard ball.
   * Always surfaced in the HUD; never applied silently.
   */
  terrainExaggeration?: number;
  substellarDir?: THREE.Vector3;
}

export interface PlanetMeshResult {
  geometry: THREE.BufferGeometry;
  program: CompiledTerrainProgram;
  /** True relief across the surface, before exaggeration. */
  reliefM: { minM: number; maxM: number };
  exaggeration: number;
  vertexCount: number;
}

// ── Icosphere ───────────────────────────────────────────────────────────────────────────
// A subdivided icosahedron distributes triangles far more evenly than a UV sphere and has
// no pole pinching, which matters once displacement is applied.

function icosphereDirections(subdivisions: number): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const t = (1 + Math.sqrt(5)) / 2;
  let vertices: number[][] = [
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
    const midpoints = new Map<string, number>();
    const next: number[][] = [];

    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
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

  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    positions[i * 3] = v[0]!;
    positions[i * 3 + 1] = v[1]!;
    positions[i * 3 + 2] = v[2]!;
  });

  const indices = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => {
    indices[i * 3] = f[0]!;
    indices[i * 3 + 1] = f[1]!;
    indices[i * 3 + 2] = f[2]!;
  });

  return { positions, indices };
}

// ── Surface palette ─────────────────────────────────────────────────────────────────────

const COLOURS = {
  ocean: new THREE.Color(0x0d2a4a),
  shallow: new THREE.Color(0x1d5a7a),
  lava: new THREE.Color(0xff5a1e),
  lavaCrust: new THREE.Color(0x2a1410),
  ice: new THREE.Color(0xdfeaf2),
  regolith: new THREE.Color(0x6b6560),
  basalt: new THREE.Color(0x4a453f),
  sand: new THREE.Color(0xa8916a),
  highland: new THREE.Color(0x8a7f70),
  vegetation: new THREE.Color(0x4a6438),
};

/**
 * Colour a point from what the physics says is there.
 *
 * This is a rule-based lookup over the same context that gated the operators, not an art
 * palette chosen by eye. A world with no stable liquid never gets an ocean colour, however
 * much better it might look.
 */
function surfaceColour(
  context: PlanetContext,
  heightM: number,
  normalisedHeight: number,
  slope: number,
  climate: number,
  out: THREE.Color,
): void {
  const molten = context.surfaceTemperatureK >= 1400;
  if (molten) {
    // Lava worlds read as a dark crust with incandescent cracks in the low ground.
    out.copy(COLOURS.lavaCrust).lerp(COLOURS.lava, Math.pow(1 - normalisedHeight, 2.5));
    return;
  }

  const seaLevelM = 0;
  if (context.hydrosphereFraction > 0.02 && heightM < seaLevelM) {
    const depth = Math.min(1, -heightM / 3000);
    out.copy(COLOURS.shallow).lerp(COLOURS.ocean, depth);
    return;
  }

  // Base rock. Airless bodies are grey regolith; bodies with an atmosphere weather to tan.
  const weathered = context.surfacePressurePa > 1000;
  out.copy(weathered ? COLOURS.sand : COLOURS.regolith);

  // Highlands expose fresher rock.
  out.lerp(COLOURS.highland, Math.min(1, Math.max(0, normalisedHeight)) * 0.7);

  // Steep faces shed regolith and show bedrock.
  out.lerp(COLOURS.basalt, Math.min(1, slope * 1.8));

  // Vegetation only where a liquid is stable and the surface is temperate — and even then
  // it is a strong claim, so it stays subtle.
  if (
    context.stableLiquid === "water" &&
    context.surfaceTemperatureK > 260 &&
    context.surfaceTemperatureK < 320 &&
    context.hydrosphereFraction > 0.1
  ) {
    const lowland = 1 - Math.min(1, Math.abs(normalisedHeight));
    out.lerp(COLOURS.vegetation, lowland * 0.35 * (1 - climate));
  }

  // Ice caps, keyed on the same climate axis the glacial operator used.
  if (context.hasStableIce) {
    const cold = Math.max(0, (climate - 0.62) / 0.38);
    out.lerp(COLOURS.ice, Math.min(1, cold * cold) * (1 - Math.min(1, slope * 2)));
  }
}

// ── Build ───────────────────────────────────────────────────────────────────────────────

export function buildPlanetGeometry(options: PlanetMeshOptions): PlanetMeshResult {
  const {
    context,
    seed,
    subdivisions = 5,
    terrainExaggeration = 1,
    substellarDir = new THREE.Vector3(1, 0, 0),
  } = options;

  const program = compileTerrainProgram({ context, seed });
  const { positions: dirs, indices } = icosphereDirections(subdivisions);
  const vertexCount = dirs.length / 3;

  const evalOptions = {
    radiusM: context.radiusM,
    tidallyLocked: context.tidallyLocked,
    substellarDir: { x: substellarDir.x, y: substellarDir.y, z: substellarDir.z },
  };

  const reliefM = reliefRange(program, evalOptions, 1500);
  const span = Math.max(reliefM.maxM - reliefM.minM, 1);

  const positions = new Float32Array(vertexCount * 3);
  const colours = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);

  const colour = new THREE.Color();

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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // Normals from the displaced mesh rather than from analytic derivatives: every operator
  // would otherwise have to supply a correct derivative, and one wrong derivative produces
  // lighting that is subtly wrong rather than obviously broken.
  geometry.computeVertexNormals();

  const normals = geometry.getAttribute("normal");

  for (let i = 0; i < vertexCount; i++) {
    const dx = dirs[i * 3]!;
    const dy = dirs[i * 3 + 1]!;
    const dz = dirs[i * 3 + 2]!;

    // Slope: how far the surface normal has tilted away from straight up.
    const dot = normals.getX(i) * dx + normals.getY(i) * dy + normals.getZ(i) * dz;
    const slope = Math.min(1, Math.max(0, 1 - dot));

    const climate = context.tidallyLocked
      ? Math.acos(Math.min(1, Math.max(-1, dx * substellarDir.x + dy * substellarDir.y + dz * substellarDir.z))) / Math.PI
      : Math.abs(Math.asin(Math.min(1, Math.max(-1, dy)))) / (Math.PI / 2);

    const normalised = (heights[i]! - reliefM.minM) / span;
    surfaceColour(context, heights[i]!, normalised * 2 - 1, slope, climate, colour);

    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();

  return { geometry, program, reliefM, exaggeration: terrainExaggeration, vertexCount };
}
