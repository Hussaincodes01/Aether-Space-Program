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
import {
  buildExoSystem,
  updateExoSystem,
  type ExoPlanetBody,
  type ExoSystem,
} from "./exo-system.js";
import { createInterstellarMap } from "./interstellar-map.js";
import { createProvenancePanel } from "./provenance-panel.js";
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
  // Reconnected: changing the mission selection now changes what the world looks like,
  // rather than only a number in the HUD.
  applyEvidence();
});

// ── Interstellar travel ─────────────────────────────────────────────────────────────────

const starMap = createInterstellarMap();
document.body.appendChild(starMap.element);

/** The exoplanet system the camera is currently inside, if any. */
let activeSystem: ExoSystem | null = null;

/**
 * Drive the speculation rim from real catalogue completeness.
 *
 * This is where the mission panel and the exoplanet priors meet: the rim strengthens with
 * whichever is *less* certain, so a thin mission selection and a poorly measured planet
 * compound rather than cancel.
 */
function applyEvidence(): void {
  const systemSpeculation = activeSystem?.speculation ?? 0;
  const combined = Math.max(currentEnvelopeWidth, systemSpeculation);
  const neutral = new THREE.Color(0.55, 0.54, 0.53);

  for (const body of activeSystem?.planets ?? []) {
    const material = body.mesh.material as THREE.MeshStandardMaterial;
    const uncertainty = Math.max(combined, body.speculation);
    // Desaturate toward neutral grey as certainty drops. A confident colour would be a
    // claim the data cannot support.
    material.color.lerp(neutral, Math.min(0.85, uncertainty));
  }
}

function travelTo(systemIndex: number): void {
  const { systems, planets, names } = exoplanets;
  if (!systems || !planets || !names) return;

  // Tear the previous system down. 4,722 systems resident at once would be ~30,000 frames
  // for a scene that shows one.
  activeSystem?.dispose();
  activeSystem = buildExoSystem(
    systemIndex, systems, planets, names, scene.universe, scene.three,
  );

  // Arrive a few orbital radii out from the innermost planet, so the system reads as a
  // system rather than as a star with specks near it.
  const inner = activeSystem.planets[0];
  const standoff = inner
    ? inner.elements.semiMajorAxisM * 2.2
    : activeSystem.starRadiusM * 400;

  camera.frame = activeSystem.frame;
  camera.position = { x: standoff, y: standoff * 0.25, z: 0 };
  applyEvidence();
}

function returnToSolarSystem(): void {
  activeSystem?.dispose();
  activeSystem = null;
  camera.frame = earthEntry.frame;
  camera.position = { x: EARTH.radiusM * 2.6, y: EARTH.radiusM * 0.6, z: 0 };
  starMap.setCurrent(null);
}

starMap.onTravel(travelTo);
exoplanets.onReady(() => {
  if (exoplanets.systems && exoplanets.names) {
    starMap.setCatalog(exoplanets.systems, exoplanets.names);
  }
});

// ── Provenance inspector ────────────────────────────────────────────────────────────────

const provenance = createProvenancePanel();
document.body.appendChild(provenance.element);

/**
 * Point the inspector at whatever the camera is nearest.
 *
 * Called on demand rather than every frame: compiling a terrain program to enumerate its
 * gates is cheap but not free, and nothing about it changes between keypresses.
 */
function inspectNearest(): void {
  if (activeSystem && exoNearestName) {
    const body = activeSystem.planets.find((p) => p.name === exoNearestName);
    if (body) {
      provenance.show({
        name: body.name,
        subtitle:
          `${activeSystem.name} · ${(activeSystem.distancePc * 3.26156).toFixed(1)} ly from Earth`,
        resolved: body.resolved,
        context: body.context,
        seed: `sha256:${body.name}:v1`,
        speculation: Math.max(body.speculation, currentEnvelopeWidth),
      });
      return;
    }
  }

  // Solar System bodies are measured rather than resolved from a catalogue, so there is no
  // prior chain to show — but the terrain gates still apply, and they are the interesting
  // part here because these are the worlds we can check against a map.
  const entry = nearestEntry;
  if (entry) {
    provenance.show({
      name: entry.data.name,
      subtitle: entry.data.blurb,
      resolved: null,
      context: terrainContextFor(entry.data.id) ?? null,
      seed: `sha256:${entry.data.id}:v1`,
      speculation: currentEnvelopeWidth,
    });
  }
}

// Home returns to the Solar System — the one place with ground truth to check against.
window.addEventListener("keydown", (event) => {
  if (event.code === "Home") returnToSolarSystem();
  if (event.code === "KeyI") {
    if (provenance.visible) provenance.hide();
    else inspectNearest();
  }
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
/** Nearest body each frame, so the inspector can be opened without re-deriving it. */
let exoNearestName: string | null = null;
let nearestEntry: SceneBody | null = null;
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

  // 1. Real orbital motion — in the Solar System, and in whichever system we are visiting.
  updateOrbits(scene, scene.timeS + dt * scene.timeScale);
  if (activeSystem) updateExoSystem(activeSystem, scene.timeS);

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

  // Exoplanet bodies, resolved camera-relative exactly like Solar System ones.
  let exoAltitudeM = Infinity;
  let exoNearest: ExoPlanetBody | null = null;

  if (activeSystem) {
    const starRel = cameraRelative(camera, activeSystem.starFrame);
    activeSystem.starMesh.position.set(starRel.x, starRel.y, starRel.z);
    activeSystem.starLight.position.copy(activeSystem.starMesh.position);
    const starDistance = Math.hypot(starRel.x, starRel.y, starRel.z);
    activeSystem.starLight.intensity = Math.max(starDistance * starDistance * 1e-6, 1);

    for (const body of activeSystem.planets) {
      const rel = cameraRelative(camera, body.frame);
      body.mesh.position.set(rel.x, rel.y, rel.z);
      body.orbitLine.position.copy(activeSystem.starMesh.position);
      const altitude = Math.hypot(rel.x, rel.y, rel.z) - body.radiusM;
      if (altitude < exoAltitudeM) {
        exoAltitudeM = altitude;
        exoNearest = body;
      }
    }
  }

  const nearest = nearestBody(scene, distances);
  const altitudeM = activeSystem ? exoAltitudeM : (nearest?.altitudeM ?? 1e9);
  exoNearestName = exoNearest?.name ?? null;
  nearestEntry = nearest?.entry ?? null;

  // 3. Camera, then rebase with hysteresis so a hovering camera cannot flip frames.
  controls.update(camera, threeCamera, altitudeM, dt);
  const rebased = maybeRebase(camera, scene.universe, { enterFactor: 4, exitFactor: 8 });

  // 4. Generate terrain on approach; release it on departure.
  if (exoNearest?.context && exoNearest.terrainState === "placeholder" && !building) {
    const body = exoNearest;
    // Captured before the closure: TypeScript cannot carry the narrowing from the guard
    // above through into an async callback, and a non-null assertion would hide the reason.
    const context = body.context;
    if (context && exoAltitudeM / body.radiusM < TERRAIN_ENTER_RADII) {
      building = body.name;
      body.terrainState = "building";
      terrainBuilder
        .build({
          context,
          seed: `sha256:${body.name}:v1`,
          subdivisions: 6,
          terrainExaggeration: TERRAIN_EXAGGERATION,
        })
        .then((result) => {
          body.mesh.geometry = result.geometry;
          body.mesh.scale.setScalar(1);
          const material = body.mesh.material as THREE.MeshStandardMaterial;
          material.vertexColors = true;
          material.color.setScalar(1);
          material.needsUpdate = true;
          body.terrainState = "detailed";
          applyEvidence();
        })
        .catch(() => {
          body.terrainState = "placeholder";
        })
        .finally(() => {
          building = null;
        });
    }
  }

  if (!activeSystem && nearest) {
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
    nearestBodyName: activeSystem
      ? (exoNearest?.name ?? activeSystem.name)
      : (nearest?.entry.data.name ?? "deep space"),
    nearestBodyBlurb: activeSystem
      ? `${activeSystem.name} · ${(activeSystem.distancePc * 3.26156).toFixed(1)} ly · ` +
        `${activeSystem.planets.length} planets · press Home to return`
      : (nearest?.entry.data.blurb ?? ""),
    distanceToStarM: sunDistance,
    speedMs: 0,
    throttle: controls.state.throttle,
    fps: smoothedFps,
    localPositionMagnitudeM: vecLength(camera.position),
    rebasedThisFrame: rebased,
    speculationFraction: Math.max(currentEnvelopeWidth, activeSystem?.speculation ?? 0),
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
