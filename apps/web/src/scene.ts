/**
 * The TRAPPIST-1 scene, at true scale.
 *
 * Two representations run side by side and must never be confused:
 *
 *   - the **frame tree** (`@aether/coordinates`) holds authoritative f64 positions in
 *     metres, and is the only thing that knows where anything actually is;
 *   - the **Three.js scene graph** holds camera-relative f32 offsets, rewritten every
 *     frame, and is purely a drawing instruction.
 *
 * Nothing reads a position back out of Three.js. That one-way flow is what keeps the
 * precision guarantee intact.
 */

import * as THREE from "three";
import { AU, LIGHT_YEAR, earthRadii, solarRadii } from "@aether/units";
import { MOLECULAR_WEIGHT, stellarColor } from "@aether/physics";
import { TRAPPIST_1E, type PlanetContext } from "@aether/terrain";
import {
  attach,
  createFrame,
  createUniverseRoot,
  vec3,
  type Frame,
} from "@aether/coordinates";
import { buildPlanetGeometry, type PlanetMeshResult } from "./planet-mesh.js";
import { createAtmosphere, scaleHeight, type AtmosphereShell } from "./atmosphere.js";
import { createStarfield } from "./starfield.js";

export interface Body {
  name: string;
  frame: Frame;
  radiusM: number;
  mesh: THREE.Mesh;
}

export interface Scene {
  three: THREE.Scene;
  universe: Frame;
  system: Frame;
  bodies: Body[];
  star: Body;
  planet: Body;
  starLight: THREE.PointLight;
  starfield: THREE.Points;
  atmosphere: AtmosphereShell | null;
  /** Amber rim whose strength tracks how much of the world is inferred, not measured. */
  speculationShell: THREE.Mesh;
  terrain: PlanetMeshResult;
  context: PlanetContext;
}

const TRAPPIST_1 = {
  distanceLy: 40.66,
  starRadiusM: solarRadii(0.1192),
  starTeffK: 2566,
  planetSemimajorAxisM: 0.02925 * AU,
};

/**
 * Vertical exaggeration for the terrain.
 *
 * Earth's entire relief is 0.3% of its radius — at true scale a terrestrial planet is
 * smoother than a billiard ball. Every "realistic" planet you have seen is exaggerated;
 * Aether just says by how much, in the HUD, and lets you set it to 1 to see the truth.
 */
export const DEFAULT_TERRAIN_EXAGGERATION = 45;

function makeSphere(radiusM: number, material: THREE.Material, segments: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, segments, segments / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(radiusM);
  // Bodies are placed manually from f64 each frame; Three must not cull them using the
  // stale bounding sphere of a unit geometry at astronomical scale.
  mesh.frustumCulled = false;
  return mesh;
}

export function buildScene(
  terrainExaggeration = DEFAULT_TERRAIN_EXAGGERATION,
): Scene {
  const three = new THREE.Scene();
  const context = TRAPPIST_1E;

  const universe = createUniverseRoot();
  const system = createFrame("system:TRAPPIST-1", AU * 50);
  attach(system, universe, vec3(TRAPPIST_1.distanceLy * LIGHT_YEAR, 0, 0));

  // ── Background sky ────────────────────────────────────────────────────────────────────
  const starfield = createStarfield({ count: 14000 });
  three.add(starfield);

  // ── Star ──────────────────────────────────────────────────────────────────────────────
  // Colour straight from the physics layer. An M-dwarf at 2566 K is genuinely orange-red;
  // this is the first place a measurement becomes a pixel.
  const { linear } = stellarColor(TRAPPIST_1.starTeffK);
  const starColour = new THREE.Color(linear.r, linear.g, linear.b);

  const starFrame = createFrame("star:TRAPPIST-1", TRAPPIST_1.starRadiusM);
  attach(starFrame, system, vec3(0, 0, 0));

  const starMesh = makeSphere(
    TRAPPIST_1.starRadiusM,
    new THREE.MeshBasicMaterial({ color: starColour }),
    64,
  );
  three.add(starMesh);

  const star: Body = {
    name: "TRAPPIST-1",
    frame: starFrame,
    radiusM: TRAPPIST_1.starRadiusM,
    mesh: starMesh,
  };

  // ── Planet ────────────────────────────────────────────────────────────────────────────
  // Geometry comes from the compiled terrain program: every hill was put there by a gated
  // geological process, and the inspector can name which.
  const planetFrame = createFrame("planet:TRAPPIST-1 e", context.radiusM);
  attach(planetFrame, system, vec3(TRAPPIST_1.planetSemimajorAxisM, 0, 0));

  const terrain = buildPlanetGeometry({
    context,
    seed: "sha256:trappist-1e:v1",
    subdivisions: 5,
    terrainExaggeration,
  });

  const planetMesh = new THREE.Mesh(
    terrain.geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
    }),
  );
  planetMesh.frustumCulled = false;
  three.add(planetMesh);

  const planet: Body = {
    name: "TRAPPIST-1 e",
    frame: planetFrame,
    radiusM: context.radiusM,
    mesh: planetMesh,
  };

  // ── Atmosphere ────────────────────────────────────────────────────────────────────────
  // Composition has never been measured for this planet, so mean molecular weight is an
  // assumption — and the sky colour it produces is therefore a low-confidence claim, badged
  // as such in the inspector rather than presented as observation.
  const meanMolecularWeightAmu = MOLECULAR_WEIGHT.N2;
  const atmosphere = createAtmosphere({
    planetRadiusM: context.radiusM,
    scaleHeightM: scaleHeight({
      surfaceTemperatureK: context.surfaceTemperatureK,
      meanMolecularWeightAmu,
      surfaceGravityMs2: context.surfaceGravityMs2,
    }),
    surfacePressurePa: context.surfacePressurePa,
    meanMolecularWeightAmu,
    surfaceTemperatureK: context.surfaceTemperatureK,
    surfaceGravityMs2: context.surfaceGravityMs2,
    starColour,
  });
  if (atmosphere) three.add(atmosphere.mesh);

  // ── Speculation shimmer ───────────────────────────────────────────────────────────────
  // Wired to the evidence model rather than to a hand-set number: the less the selected
  // missions constrain, the more strongly the planet is rimmed in amber.
  const speculationShell = makeSphere(
    context.radiusM * 1.035,
    new THREE.MeshBasicMaterial({
      color: 0xffb454,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    48,
  );
  speculationShell.renderOrder = 11;
  three.add(speculationShell);

  // ── Lighting ──────────────────────────────────────────────────────────────────────────
  const starLight = new THREE.PointLight(starColour, 1, 0, 0);
  three.add(starLight);
  three.add(new THREE.AmbientLight(starColour, 0.03));

  return {
    three,
    universe,
    system,
    bodies: [star, planet],
    star,
    planet,
    starLight,
    starfield,
    atmosphere,
    speculationShell,
    terrain,
    context,
  };
}

/**
 * Apply an evidence profile to the scene.
 *
 * The amber rim strengthens as the envelope widens, and the surface desaturates toward a
 * neutral grey when little constrains its composition — a confident colour would be a claim
 * the data cannot support.
 */
export function applyEvidence(scene: Scene, envelopeWidth: number): void {
  const shell = scene.speculationShell.material as THREE.MeshBasicMaterial;
  shell.opacity = Math.min(0.42, envelopeWidth * 0.42);

  const surface = scene.planet.mesh.material as THREE.MeshStandardMaterial;
  // Desaturate toward grey as certainty drops. Full colour is never claimed outright.
  surface.color.setScalar(1);
  const constrained = 1 - envelopeWidth;
  surface.color.setRGB(
    0.55 + constrained * 0.45,
    0.55 + constrained * 0.42,
    0.55 + constrained * 0.38,
  );
}
