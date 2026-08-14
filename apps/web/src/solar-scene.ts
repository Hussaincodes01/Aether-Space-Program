/**
 * The Solar System, from real orbital elements, with terrain generated live on approach.
 *
 * Starting at home is not just friendlier. It is the only place the generator can be
 * checked: we have maps of Mars and the Moon, so if the operator gates are sound the worlds
 * here should look recognisable, and if they do not, the rules are wrong. Every exoplanet
 * this project ever renders inherits its credibility from whether Mars comes out looking
 * like Mars.
 *
 * Positions come from `stateAt` each frame, so the planets really do move on their real
 * orbits at their real periods. Terrain is built by a worker when the camera closes on a
 * body and released when it leaves, which keeps memory bounded across a whole system.
 */

import * as THREE from "three";
import { AU } from "@aether/units";
import { stellarColor } from "@aether/physics";
import {
  SOLAR_SYSTEM,
  getBody,
  orbitalPeriod,
  perifocalToEcliptic,
  ringsFor,
  sampleOrbit,
  stateAt,
  toPlanetContext,
  type RingSystem,
  type Mat3,
  type SolarBody,
} from "@aether/solar-system";
import { attach, createFrame, createUniverseRoot, vec3, type Frame } from "@aether/coordinates";
import type { PlanetMeshResult } from "./planet-mesh.js";

export type TerrainState = "placeholder" | "building" | "detailed";

export interface SceneBody {
  data: SolarBody;
  frame: Frame;
  mesh: THREE.Mesh;
  orbitLine?: THREE.Line;
  /** Cached rotation matrix; the elements are static so this never needs recomputing. */
  rotation?: Mat3;
  terrainState: TerrainState;
  terrain?: PlanetMeshResult;
  /** Placeholder geometry, kept so it can be restored when terrain is released. */
  placeholderGeometry: THREE.BufferGeometry;
  /** Ring plane, for the four giants. Positioned with the body each frame. */
  rings?: THREE.Mesh;
}

export interface SolarScene {
  three: THREE.Scene;
  universe: Frame;
  sunFrame: Frame;
  bodies: Map<string, SceneBody>;
  sunLight: THREE.PointLight;
  /** Simulation time, seconds since J2000. */
  timeS: number;
  /** Seconds of simulation per second of real time. */
  timeScale: number;
}

/** Terrain is built inside this many body radii, and released beyond the outer bound. */
export const TERRAIN_ENTER_RADII = 14;
export const TERRAIN_EXIT_RADII = 30;

/**
 * Shared loader, so ten textures do not open ten independent decode pipelines.
 */
const textureLoader = new THREE.TextureLoader();

/**
 * Bodies with a real, measured surface map.
 *
 * These get their actual imagery rather than generated terrain — which is the entire point
 * of the Solar System here. It is the only place with ground truth, so it is the one place
 * a procedural surface would be *wrong* rather than merely unverifiable. Putting invented
 * geography on Mars would discard the comparison that makes the generator testable at all.
 *
 * See `public/textures/ATTRIBUTION.md`: Earth and the Moon are NASA public domain, the rest
 * are Solar System Scope under CC BY 4.0.
 */
const SURFACE_MAPS = new Set([
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
]);

export function hasSurfaceMap(bodyId: string): boolean {
  return SURFACE_MAPS.has(bodyId);
}

function bodySphere(body: SolarBody): THREE.Mesh {
  // 96x48 rather than 48x24: an equirectangular map on a coarse sphere shows visible
  // faceting along the terminator, which is exactly where the eye is drawn.
  const geometry = new THREE.SphereGeometry(1, 96, 48);

  const map = SURFACE_MAPS.has(body.id) ? textureLoader.load(`textures/${body.id}.jpg`) : null;
  if (map) map.colorSpace = THREE.SRGBColorSpace;

  const material =
    body.kind === "star"
      ? new THREE.MeshBasicMaterial({ color: map ? 0xffffff : body.tintHex, map })
      : new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : body.tintHex,
          map,
          roughness: 0.92,
          metalness: 0.02,
        });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(body.radiusM);
  // Bodies are positioned from f64 each frame; Three must not cull them using the stale
  // bounding sphere of a unit geometry at astronomical scale.
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A ring system, as an annulus in the planet's equatorial plane.
 *
 * Rings are drawn double-sided and unlit. Real ring particles scatter light forward, so the
 * far side of a ring seen against the Sun is *brighter* than the near side — a lit material
 * gets that backwards and makes the shadowed half vanish, which is the usual tell of a
 * ring rendered without thinking about it.
 */
function ringMesh(ring: RingSystem): THREE.Mesh {
  const geometry = new THREE.RingGeometry(ring.innerRadiusM, ring.outerRadiusM, 192, 1);

  // RingGeometry's default UVs are unusable for a radial gradient; rebuild v as the
  // normalised radius so any future ring texture bands correctly from inner to outer edge.
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    const t = (r - ring.innerRadiusM) / (ring.outerRadiusM - ring.innerRadiusM);
    uv.setXY(i, t, 0.5);
  }
  uv.needsUpdate = true;

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: ring.tintHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: ring.opacity,
      depthWrite: false,
    }),
  );
  // Orientation is set from the planet's tilt each frame in the render loop.
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

function orbitLine(body: SolarBody, colour: number): THREE.Line | undefined {
  if (!body.elements) return undefined;

  const points = sampleOrbit(body.elements, 512).map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      // Nineteen moon orbits at planetary scale are visual noise; they only need to read
      // once the camera is close enough for the planet to fill the view.
      opacity: body.kind === "moon" ? 0.1 : 0.22,
    }),
  );
  line.frustumCulled = false;
  return line;
}

export function buildSolarScene(startTimeS = 0): SolarScene {
  const three = new THREE.Scene();
  const universe = createUniverseRoot();

  // The Sun sits at the origin of the system frame. Barycentric wobble is real but is a few
  // solar radii, far below anything visible at the scales this view operates over.
  const sunFrame = createFrame("sun", AU * 60);
  attach(sunFrame, universe, vec3(0, 0, 0));

  const bodies = new Map<string, SceneBody>();

  for (const data of SOLAR_SYSTEM) {
    const mesh = bodySphere(data);
    three.add(mesh);

    const frame =
      data.id === "sun" ? sunFrame : createFrame(data.id, Math.max(data.radiusM * 40, 1e6));

    if (data.id !== "sun") {
      const parentFrame =
        data.parentId && bodies.get(data.parentId)
          ? bodies.get(data.parentId)!.frame
          : sunFrame;
      attach(frame, parentFrame, vec3(0, 0, 0));
    }

    const entry: SceneBody = {
      data,
      frame,
      mesh,
      rotation: data.elements ? perifocalToEcliptic(data.elements) : undefined,
      orbitLine: data.id === "sun" ? undefined : orbitLine(data, data.tintHex),
      terrainState: "placeholder",
      placeholderGeometry: mesh.geometry,
    };

    const ring = ringsFor(data.id);
    if (ring) {
      entry.rings = ringMesh(ring);
      three.add(entry.rings);
    }

    if (entry.orbitLine) three.add(entry.orbitLine);
    bodies.set(data.id, entry);
  }

  // Sunlight, coloured by the Sun's actual blackbody temperature. It is very slightly warm,
  // not pure white, which is why every "white sunlight" render looks subtly wrong.
  const { linear } = stellarColor(5772);
  const sunLight = new THREE.PointLight(new THREE.Color(linear.r, linear.g, linear.b), 1, 0, 0);
  three.add(sunLight);
  three.add(new THREE.AmbientLight(0x334455, 0.06));

  const scene: SolarScene = {
    three,
    universe,
    sunFrame,
    bodies,
    sunLight,
    timeS: startTimeS,
    timeScale: 60 * 60 * 24, // One day per second by default.
  };

  updateOrbits(scene, startTimeS);
  return scene;
}

/**
 * Advance every body along its real orbit.
 *
 * Positions are written into the frame tree in f64 metres; the renderer never sees an
 * absolute coordinate, only the camera-relative offset computed later.
 */
export function updateOrbits(scene: SolarScene, timeS: number): void {
  scene.timeS = timeS;

  for (const entry of scene.bodies.values()) {
    if (!entry.data.elements) continue;
    const { position } = stateAt(entry.data.elements, timeS, entry.rotation);
    entry.frame.position.x = position.x;
    entry.frame.position.y = position.y;
    entry.frame.position.z = position.z;

    // Orbit lines are drawn in the parent's frame, so they move with the parent rather than
    // with the body — the Moon's orbit follows Earth around the Sun.
    if (entry.orbitLine && entry.data.parentId) {
      const parent = scene.bodies.get(entry.data.parentId);
      if (parent) entry.orbitLine.userData.parentFrame = parent.frame;
    }
  }
}

/** Body rotation about its own axis at the current time, including axial tilt. */
export function bodyOrientation(body: SolarBody, timeS: number): THREE.Quaternion {
  const spin = body.rotationPeriodS === 0 ? 0 : (2 * Math.PI * timeS) / body.rotationPeriodS;

  const tilt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    body.axialTiltRad,
  );
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin);
  return tilt.multiply(rotation);
}

/** Distance from a point to a body's surface, in body radii. Negative means inside. */
export function altitudeInRadii(distanceToCentreM: number, body: SolarBody): number {
  return distanceToCentreM / body.radiusM - 1;
}

/**
 * Which body the camera is closest to, by surface distance rather than centre distance.
 *
 * Centre distance would name the Sun almost everywhere, since it dwarfs everything else.
 */
export function nearestBody(
  scene: SolarScene,
  distances: Map<string, number>,
): { entry: SceneBody; altitudeM: number } | undefined {
  let best: { entry: SceneBody; altitudeM: number } | undefined;

  for (const [id, distance] of distances) {
    const entry = scene.bodies.get(id);
    if (!entry) continue;
    const altitudeM = distance - entry.data.radiusM;
    if (!best || altitudeM < best.altitudeM) best = { entry, altitudeM };
  }

  return best;
}

/** Attach detailed terrain to a body, releasing the placeholder. */
export function attachTerrain(entry: SceneBody, terrain: PlanetMeshResult): void {
  entry.mesh.geometry = terrain.geometry;
  // The generated mesh carries absolute radii in its vertex positions, so the unit-sphere
  // scale must be cleared or the planet comes out radius-squared across.
  entry.mesh.scale.setScalar(1);
  (entry.mesh.material as THREE.MeshStandardMaterial).vertexColors = true;
  (entry.mesh.material as THREE.MeshStandardMaterial).color.setScalar(1);
  (entry.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
  entry.terrain = terrain;
  entry.terrainState = "detailed";
}

/**
 * Release terrain and restore the placeholder.
 *
 * Called when the camera leaves a body. Three does not free GPU buffers on garbage
 * collection, so the dispose is what actually bounds memory across a system tour.
 */
export function releaseTerrain(entry: SceneBody): void {
  if (entry.terrainState !== "detailed" || !entry.terrain) return;

  entry.mesh.geometry = entry.placeholderGeometry;
  entry.mesh.scale.setScalar(entry.data.radiusM);
  const material = entry.mesh.material as THREE.MeshStandardMaterial;
  material.vertexColors = false;
  material.color.setHex(entry.data.tintHex);
  material.needsUpdate = true;

  entry.terrain.geometry.dispose();
  entry.terrain = undefined;
  entry.terrainState = "placeholder";
}

/** Terrain context for a body, or undefined where there is no solid surface to generate. */
export function terrainContextFor(bodyId: string) {
  const body = getBody(bodyId);
  if (!body || body.kind === "star") return undefined;
  const context = toPlanetContext(body);
  return context.bulkDensityKgM3 >= 1500 ? context : undefined;
}

/** Human-readable orbital period, for the UI. */
export function periodDays(body: SolarBody): number | undefined {
  return body.elements ? orbitalPeriod(body.elements) / 86_400 : undefined;
}
