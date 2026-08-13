/**
 * Aether — Solar System client.
 *
 * Starts in Earth orbit. Planets move along their real Keplerian orbits at their real
 * periods, and terrain is generated live in a worker as the camera closes on a body, then
 * released when it leaves.
 *
 * Per-frame contract, unchanged from the precision spike and still the thing that must not
 * be broken:
 *   1. Advance simulation time and the f64 orbital positions.
 *   2. Advance the f64 camera position, then rebase across frames with hysteresis.
 *   3. For each body, resolve its position relative to the camera in f64.
 *   4. Narrow *that offset only* to f32 and hand it to Three.js.
 *   5. Three's camera stays at the origin and only ever rotates.
 */

import * as THREE from "three";
import { envelopeWidth } from "@aether/missions";
import { EARTH, secondsSinceJ2000 } from "@aether/solar-system";
import {
  cameraRelative,
  createCamera,
  depth as frameDepth,
  length as vecLength,
  maybeRebase,
} from "@aether/coordinates";
import {
  TERRAIN_ENTER_RADII,
  TERRAIN_EXIT_RADII,
  attachTerrain,
  bodyOrientation,
  buildSolarScene,
  nearestBody,
  releaseTerrain,
  terrainContextFor,
  updateOrbits,
  type SceneBody,
} from "./solar-scene.js";
import { createTerrainBuilder } from "./planet-mesh.js";
import { createAtmosphere, scaleHeight, type AtmosphereShell } from "./atmosphere.js";
import { createStarfield } from "./starfield.js";
import { createDeepSkyLayer } from "./deepsky-layer.js";
import { createExoplanetLayer } from "./exoplanet-layer.js";
import { createControls } from "./controls.js";
import { renderHud, renderWatermark } from "./hud.js";
import { createMissionPanel } from "./mission-panel.js";

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  // Logarithmic depth is the WebGL2 fallback, and Three applies it per-vertex, which
  // interpolates incorrectly across large triangles. Enough to prove the traversal; the
  // production path is cascaded frusta with reversed-Z, and remains the immediate P0 item.
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// Start at the present moment, so the planets are where they actually are today.
const scene = buildSolarScene(secondsSinceJ2000(new Date()));

// The real sky: 109k stars at measured parallax distances. Loads progressively.
const starfield = createStarfield();
scene.three.add(starfield.points);

// The deep sky: 12,160 galaxies, clusters and nebulae, most at real derived distances.
const deepSky = createDeepSkyLayer();
scene.three.add(deepSky.points);

// Every confirmed planetary system, at its true distance. ~4,700 of the 109,000 stars in
// the field are known to have planets, and picking them out is the point of the layer.
const exoplanets = createExoplanetLayer();
scene.three.add(exoplanets.points);

const threeCamera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1e15,
);
threeCamera.position.set(0, 0, 0);

// Begin in low Earth orbit, looking down. Home first.
const earthEntry = scene.bodies.get("earth")!;
const camera = createCamera(earthEntry.frame, {
  x: EARTH.radiusM * 2.6,
  y: EARTH.radiusM * 0.6,
  z: 0,
});

const controls = createControls(canvas);
renderWatermark();

const missionPanel = createMissionPanel("today");
document.body.appendChild(missionPanel.element);
let currentEnvelopeWidth = envelopeWidth(missionPanel.getProfile());
missionPanel.onChange((profile) => {
  currentEnvelopeWidth = envelopeWidth(profile);
});

// ── Live terrain ────────────────────────────────────────────────────────────────────────

const terrainBuilder = createTerrainBuilder();
/** One build at a time: several concurrent workers would fight for the same core. */
let building: string | null = null;
let atmosphere: AtmosphereShell | null = null;
let atmosphereBodyId: string | null = null;

function requestTerrain(entry: SceneBody): void {
  if (building || entry.terrainState !== "placeholder") return;
  const context = terrainContextFor(entry.data.id);
  if (!context) return;

  building = entry.data.id;
  entry.terrainState = "building";

  terrainBuilder
    .build({
      context,
      seed: `sha256:${entry.data.id}:v1`,
      subdivisions: 6,
      terrainExaggeration: TERRAIN_EXAGGERATION,
    })
    .then((result) => {
      attachTerrain(entry, result);
      attachAtmosphere(entry);
    })
    .catch((error: unknown) => {
      // A failed build leaves the placeholder in place, which is still a valid world.
      console.warn(`Terrain build failed for ${entry.data.id}`, error);
      entry.terrainState = "placeholder";
    })
    .finally(() => {
      building = null;
    });
}

function attachAtmosphere(entry: SceneBody): void {
  detachAtmosphere();
  const body = entry.data;
  if (body.surfacePressurePa <= 0) return;

  // Mean molecular weight is an assumption for every body except the few with measured
  // composition, and the sky colour it produces inherits that uncertainty.
  const meanMolecularWeightAmu = body.id === "venus" || body.id === "mars" ? 44.01 : 28.013;
  const gravity = (6.6743e-11 * body.massKg) / body.radiusM ** 2;

  atmosphere = createAtmosphere({
    planetRadiusM: body.radiusM,
    scaleHeightM: scaleHeight({
      surfaceTemperatureK: body.surfaceTemperatureK,
      meanMolecularWeightAmu,
      surfaceGravityMs2: gravity,
    }),
    surfacePressurePa: body.surfacePressurePa,
    meanMolecularWeightAmu,
    surfaceTemperatureK: body.surfaceTemperatureK,
    surfaceGravityMs2: gravity,
    starColour: new THREE.Color(1.0, 0.945, 0.918),
  });

  if (atmosphere) {
    scene.three.add(atmosphere.mesh);
    atmosphereBodyId = body.id;
  }
}

function detachAtmosphere(): void {
  if (!atmosphere) return;
  scene.three.remove(atmosphere.mesh);
  atmosphere.mesh.geometry.dispose();
  atmosphere.material.dispose();
  atmosphere = null;
  atmosphereBodyId = null;
}

const TERRAIN_EXAGGERATION = 25;

// ── Loop ────────────────────────────────────────────────────────────────────────────────

const distances = new Map<string, number>();
let lastTime = performance.now();
let smoothedFps = 60;

function resize(): void {
  threeCamera.aspect = window.innerWidth / window.innerHeight;
  threeCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  smoothedFps = smoothedFps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

  // 1. Real orbital motion.
  updateOrbits(scene, scene.timeS + dt * scene.timeScale);

  // 2. Resolve every body relative to the camera, in f64, and record surface distances.
  distances.clear();
  for (const entry of scene.bodies.values()) {
    const rel = cameraRelative(camera, entry.frame);
    entry.mesh.position.set(rel.x, rel.y, rel.z);
    entry.mesh.quaternion.copy(bodyOrientation(entry.data, scene.timeS));

    if (entry.orbitLine) {
      const parent = scene.bodies.get(entry.data.parentId ?? "sun");
      if (parent) {
        const parentRel = cameraRelative(camera, parent.frame);
        entry.orbitLine.position.set(parentRel.x, parentRel.y, parentRel.z);
      }
    }

    distances.set(entry.data.id, Math.hypot(rel.x, rel.y, rel.z));
  }

  const nearest = nearestBody(scene, distances);
  const altitudeM = nearest?.altitudeM ?? 1e9;

  // 3. Camera, then rebase with hysteresis so a hovering camera cannot flip frames.
  controls.update(camera, threeCamera, altitudeM, dt);
  const rebased = maybeRebase(camera, scene.universe, { enterFactor: 4, exitFactor: 8 });

  // 4. Generate terrain on approach; release it on departure.
  if (nearest) {
    const radii = nearest.altitudeM / nearest.entry.data.radiusM;
    if (radii < TERRAIN_ENTER_RADII) requestTerrain(nearest.entry);
  }
  for (const entry of scene.bodies.values()) {
    if (entry.terrainState !== "detailed") continue;
    const distance = distances.get(entry.data.id) ?? Infinity;
    if ((distance - entry.data.radiusM) / entry.data.radiusM > TERRAIN_EXIT_RADII) {
      releaseTerrain(entry);
      if (atmosphereBodyId === entry.data.id) detachAtmosphere();
    }
  }

  // 5. Sunlight and atmosphere follow the camera-relative frame like everything else.
  const sunRel = scene.bodies.get("sun")!.mesh.position;
  scene.sunLight.position.copy(sunRel);
  // Star positions are stored relative to the Sun, so the whole field rides with it.
  starfield.update(sunRel);
  deepSky.update(sunRel);
  exoplanets.update(sunRel);
  const sunDistance = sunRel.length();
  scene.sunLight.intensity = Math.max(sunDistance * sunDistance * 1e-6, 1);

  if (atmosphere && atmosphereBodyId) {
    const host = scene.bodies.get(atmosphereBodyId)!;
    atmosphere.mesh.position.copy(host.mesh.position);
    atmosphere.setPlanetCentre(host.mesh.position);
    atmosphere.setSunDirection(
      new THREE.Vector3().subVectors(sunRel, host.mesh.position),
    );
  }

  renderer.render(scene.three, threeCamera);

  renderHud({
    frameId: camera.frame.id,
    frameDepth: frameDepth(camera.frame),
    altitudeM,
    nearestBodyName: nearest?.entry.data.name ?? "deep space",
    nearestBodyBlurb: nearest?.entry.data.blurb ?? "",
    distanceToStarM: sunDistance,
    speedMs: 0,
    throttle: controls.state.throttle,
    fps: smoothedFps,
    localPositionMagnitudeM: vecLength(camera.position),
    rebasedThisFrame: rebased,
    speculationFraction: currentEnvelopeWidth,
    terrainExaggeration: TERRAIN_EXAGGERATION,
    reliefM: nearest?.entry.terrain
      ? nearest.entry.terrain.reliefM.maxM - nearest.entry.terrain.reliefM.minM
      : 0,
    vertexCount: nearest?.entry.terrain?.vertexCount ?? 0,
    refining: building !== null,
    starCount: starfield.count,
    exoSystemCount: exoplanets.systemCount,
    exoPlanetCount: exoplanets.planetCount,
    exoSpeculation: exoplanets.meanSpeculation,
    deepSkyCount: deepSky.count,
    deepSkyWithoutDistance: deepSky.withoutDistance,
    starsComplete: starfield.complete,
    simulationDate: new Date(Date.UTC(2000, 0, 1, 12) + scene.timeS * 1000),
    timeScale: scene.timeScale,
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
