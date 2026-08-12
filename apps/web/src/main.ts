/**
 * Multi-scale precision spike — PRD week 1-2.
 *
 * The one thing this must prove: continuous flight from 1 AU to a two-metre observer
 * height with no jitter, no loading screen and no popping. If that is not solid, nothing
 * built on top of it can be.
 *
 * Per-frame contract:
 *   1. Advance the f64 camera position (controls).
 *   2. Rebase the camera if it has crossed a frame boundary, with hysteresis.
 *   3. For each body, resolve its position relative to the camera in f64.
 *   4. Narrow *that offset only* to f32 and hand it to Three.js.
 *   5. Three's camera stays at the origin and only ever rotates.
 */

import * as THREE from "three";
import { AU } from "@aether/units";
import {
  cameraRelative,
  createCamera,
  depth as frameDepth,
  length as vecLength,
  maybeRebase,
} from "@aether/coordinates";
import { envelopeWidth } from "@aether/missions";
import { applyEvidence, buildScene } from "./scene.js";
import { createControls } from "./controls.js";
import { renderHud, renderWatermark } from "./hud.js";
import { createMissionPanel } from "./mission-panel.js";

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  // Logarithmic depth is the WebGL2 fallback, and Three applies it per-vertex, which
  // interpolates incorrectly across large triangles. It is enough to prove the traversal;
  // the production path is cascaded frusta with reversed-Z on WebGPU, and that is the
  // immediate P0 follow-up rather than a nice-to-have.
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// An M-dwarf world is dim. Exposure is scaled physically rather than lifted to taste.
renderer.toneMappingExposure = 1.4;

const scene = buildScene();

const threeCamera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1e15,
);
// The Three camera never moves. Only the universe does.
threeCamera.position.set(0, 0, 0);

// Start 1 AU from the star, looking at the planet.
const camera = createCamera(scene.system, { x: AU, y: 0, z: 0.2 * AU });

const controls = createControls(canvas);
renderWatermark();

// Mission selection drives what the app may claim, and therefore how speculative the world
// looks. Applied once at startup and again on every change.
const missionPanel = createMissionPanel("today");
document.body.appendChild(missionPanel.element);

let currentEnvelopeWidth = envelopeWidth(missionPanel.getProfile());
applyEvidence(scene, currentEnvelopeWidth);

missionPanel.onChange((profile) => {
  currentEnvelopeWidth = envelopeWidth(profile);
  applyEvidence(scene, currentEnvelopeWidth);
});

const relative = new THREE.Vector3();
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

  // 1. Altitude drives movement speed, so it is needed before the controls run.
  const toPlanet = cameraRelative(camera, scene.planet.frame);
  const altitude = vecLength(toPlanet) - scene.planet.radiusM;

  const before = { ...camera.position };
  controls.update(camera, threeCamera, altitude, dt);
  const speed =
    Math.hypot(
      camera.position.x - before.x,
      camera.position.y - before.y,
      camera.position.z - before.z,
    ) / Math.max(dt, 1e-6);

  // 2. Rebase with hysteresis. Entering at 4x scale and leaving at 8x leaves a wide dead
  //    band, so a camera hovering near a boundary cannot flip frames every frame.
  const rebased = maybeRebase(camera, scene.universe, { enterFactor: 4, exitFactor: 8 });

  // 3-4. Resolve every body relative to the camera in f64, then narrow only the offset.
  for (const body of scene.bodies) {
    const rel = cameraRelative(camera, body.frame);
    body.mesh.position.set(rel.x, rel.y, rel.z);
  }
  // Shells that wrap the planet track it.
  scene.speculationShell.position.copy(scene.planet.mesh.position);
  if (scene.atmosphere) {
    scene.atmosphere.mesh.position.copy(scene.planet.mesh.position);
    scene.atmosphere.setPlanetCentre(scene.planet.mesh.position);
    // Direction from the planet toward the star, for the scattering integral.
    scene.atmosphere.setSunDirection(
      new THREE.Vector3().subVectors(scene.star.mesh.position, scene.planet.mesh.position),
    );
  }
  // The star shell sits at effective infinity, so it rides with the camera rather than
  // being left behind — parallax over a few AU is far below one pixel at 4e17 m.
  scene.starfield.position.set(0, 0, 0);

  // The light sits at the star, camera-relative like everything else.
  const starRel = cameraRelative(camera, scene.star.frame);
  scene.starLight.position.set(starRel.x, starRel.y, starRel.z);
  // Inverse-square falloff from true luminosity would blow out or vanish depending on
  // distance; intensity is set so the planet reads correctly at its own orbit.
  const starDistance = Math.hypot(starRel.x, starRel.y, starRel.z);
  scene.starLight.intensity = Math.max(starDistance * starDistance * 1e-6, 1);

  relative.set(toPlanet.x, toPlanet.y, toPlanet.z);

  renderer.render(scene.three, threeCamera);

  renderHud({
    frameId: camera.frame.id,
    frameDepth: frameDepth(camera.frame),
    altitudeM: altitude,
    distanceToStarM: starDistance,
    speedMs: speed,
    throttle: controls.state.throttle,
    fps: smoothedFps,
    localPositionMagnitudeM: vecLength(camera.position),
    rebasedThisFrame: rebased,
    speculationFraction: currentEnvelopeWidth,
    terrainExaggeration: scene.terrain.exaggeration,
    reliefM: scene.terrain.reliefM.maxM - scene.terrain.reliefM.minM,
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
