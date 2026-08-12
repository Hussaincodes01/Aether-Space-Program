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
import { stellarColor } from "@aether/physics";
import {
  attach,
  createFrame,
  createUniverseRoot,
  vec3,
  type Frame,
} from "@aether/coordinates";

export interface Body {
  name: string;
  frame: Frame;
  radiusM: number;
  mesh: THREE.Mesh;
  /** True for the star: it lights the scene rather than being lit. */
  emissive: boolean;
}

export interface Scene {
  three: THREE.Scene;
  universe: Frame;
  system: Frame;
  bodies: Body[];
  star: Body;
  planet: Body;
  starLight: THREE.PointLight;
  /** Amber rim whose strength tracks how much of the world is inferred rather than measured. */
  speculationShell: THREE.Mesh;
}

/** TRAPPIST-1 and TRAPPIST-1 e, from the published parameters the ingest will supply in P1. */
const TRAPPIST_1 = {
  distanceLy: 40.66,
  starRadiusM: solarRadii(0.1192),
  starTeffK: 2566,
  planetSemimajorAxisM: 0.02925 * AU,
  planetRadiusM: earthRadii(0.92),
};

function makeSphere(
  radiusM: number,
  material: THREE.Material,
  segments: number,
): THREE.Mesh {
  // Unit sphere scaled to radius, so one geometry can be shared if we add more bodies.
  const geometry = new THREE.SphereGeometry(1, segments, segments / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(radiusM);
  // Bodies are placed manually from f64 every frame; Three must not cull them using the
  // stale bounding sphere of a unit geometry at astronomical scale.
  mesh.frustumCulled = false;
  return mesh;
}

export function buildScene(): Scene {
  const three = new THREE.Scene();

  const universe = createUniverseRoot();

  const system = createFrame("system:TRAPPIST-1", AU * 50);
  attach(system, universe, vec3(TRAPPIST_1.distanceLy * LIGHT_YEAR, 0, 0));

  // ── Star ──────────────────────────────────────────────────────────────────────────────
  // Colour comes straight from the physics layer. An M-dwarf at 2566 K is genuinely
  // orange-red; this is the first place in the app where a measurement becomes a pixel.
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
    emissive: true,
  };

  // ── Planet ────────────────────────────────────────────────────────────────────────────
  const planetFrame = createFrame("planet:TRAPPIST-1 e", TRAPPIST_1.planetRadiusM);
  attach(planetFrame, system, vec3(TRAPPIST_1.planetSemimajorAxisM, 0, 0));

  const planetMesh = makeSphere(
    TRAPPIST_1.planetRadiusM,
    // Untextured on purpose. The PRD is explicit: prove the scale transition before any
    // art exists, or the art will hide the jitter.
    new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95, metalness: 0 }),
    128,
  );
  three.add(planetMesh);

  const planet: Body = {
    name: "TRAPPIST-1 e",
    frame: planetFrame,
    radiusM: TRAPPIST_1.planetRadiusM,
    mesh: planetMesh,
    emissive: false,
  };

  // ── Speculation shimmer ───────────────────────────────────────────────────────────────
  // The PRD's most distinctive UI idea, wired to the evidence model rather than to a
  // hand-set number: the less the selected missions constrain, the more strongly the
  // planet is rimmed in amber. A world drawn from three parameters should *look* like a
  // world drawn from three parameters.
  const speculationShell = makeSphere(
    TRAPPIST_1.planetRadiusM * 1.02,
    new THREE.MeshBasicMaterial({
      color: 0xffb454,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    64,
  );
  three.add(speculationShell);

  // ── Lighting ──────────────────────────────────────────────────────────────────────────
  // Physically scaled: an M-dwarf world is genuinely dim, and cheating that would throw
  // away one of the few things the data tells us directly.
  const starLight = new THREE.PointLight(starColour, 1, 0, 0);
  three.add(starLight);
  three.add(new THREE.AmbientLight(starColour, 0.02));

  return {
    three,
    universe,
    system,
    bodies: [star, planet],
    star,
    planet,
    starLight,
    speculationShell,
  };
}

/**
 * Apply an evidence profile to the scene.
 *
 * Two visible consequences, both honest: the amber rim strengthens as the envelope widens,
 * and the surface desaturates toward a neutral grey when there is little to constrain its
 * composition — because a confident colour would be a claim we cannot support.
 */
export function applyEvidence(scene: Scene, envelopeWidth: number): void {
  const shell = scene.speculationShell.material as THREE.MeshBasicMaterial;
  shell.opacity = Math.min(0.5, envelopeWidth * 0.5);

  const surface = scene.planet.mesh.material as THREE.MeshStandardMaterial;
  const constrained = 1 - envelopeWidth;
  // Interpolate between a neutral unknown grey and a mineral-plausible tone.
  const grey = new THREE.Color(0x6a6a6a);
  const mineral = new THREE.Color(0x8a7358);
  surface.color.copy(grey).lerp(mineral, constrained);
}

/** Altitude above the planet's surface, metres. Negative means below it. */
export function altitudeAboveSurface(cameraRelativeToPlanet: THREE.Vector3, radiusM: number): number {
  return cameraRelativeToPlanet.length() - radiusM;
}
