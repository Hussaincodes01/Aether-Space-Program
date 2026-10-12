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
  buildDepthPartitions,
  cameraRelative,
  createCamera,
  depth as frameDepth,
  length as vecLength,
  maybeRebase,
  type DepthPartition,
} from "@aether/coordinates";
import {
  TERRAIN_ENTER_RADII,
  TERRAIN_EXIT_RADII,
  attachTerrain,
  bodyOrientation,
  buildSolarScene,
  collisionRadiusM,
  isLandable,
  nearestBody,
  releaseTerrain,
  hasSurfaceMap,
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
import { createBodyList } from "./body-list.js";
import { createProvenancePanel } from "./provenance-panel.js";
import { createControls } from "./controls.js";
import { renderHud, renderWatermark } from "./hud.js";
import { createMissionPanel } from "./mission-panel.js";
import {
  createCatalogPanel,
  DEFAULT_SELECTION,
  type CatalogSelection,
} from "./catalog-panel.js";
import { createModelInspector } from "./model-inspector.js";
import { createErrorPanel, webglSupportMessage } from "./error-panel.js";
import { buildPlanetModel, type PlanetModel } from "@aether/catalog";
import { createDebugOverlay } from "./debug-overlay.js";
import { createDock } from "./panel-dock.js";
import { desaturate, speculationStyle } from "./speculation.js";
import { planLighting, type LitWorld } from "./exposure.js";

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);

/**
 * Errors go on screen, not only into the console.
 *
 * Created before anything that can fail, because the first thing that can fail is the
 * renderer itself and a WebGL exception otherwise leaves a blank page with a message the
 * user will never look for.
 */
const errorPanel = createErrorPanel();
document.body.appendChild(errorPanel.element);

const webglProblem = webglSupportMessage();
if (webglProblem) {
  errorPanel.report({
    severity: "error",
    title: "WebGL 2 is not available",
    detail: webglProblem,
    suggestion: "Everything else on this page is static; the 3D view cannot start.",
  });
  throw new Error(webglProblem);
}

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

/**
 * Far plane large enough to contain the actual universe.
 *
 * The first value here was 1e15 m, which is inside the Oort cloud — every star (3e16 m and
 * out), every exoplanet host, and the entire deep sky (1e24 m) was clipped away before it
 * could be drawn. The scene rendered perfectly and showed nothing.
 *
 * The logarithmic depth buffer is what makes a range this absurd usable, and the point
 * layers disable depth testing entirely, so the only geometry that actually needs depth
 * precision is the handful of nearby bodies.
 */
const threeCamera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1e27,
);
threeCamera.position.set(0, 0, 0);

/**
 * Where to sit so a body is actually lit.
 *
 * The camera used to spawn at a fixed `+x` offset in the target's frame. On 2026-08-15 that
 * put it 128.8 degrees from Earth's subsolar point -- squarely on the night side -- so the
 * application opened on an unlit black sphere against black space, and the planet read as
 * missing rather than as dark. Every report of "the planets are not visible" traced here.
 *
 * The fix is to derive the standoff from the geometry instead of hardcoding it: sit on the
 * sunward side, lifted slightly out of the ecliptic so the terminator is visible and the
 * world reads as a sphere rather than a flat disc.
 */
function sunwardStandoff(
  bodyId: string,
  distanceM: number,
): { x: number; y: number; z: number } {
  const entry = scene.bodies.get(bodyId);
  const sun = scene.bodies.get("sun");

  // Heliocentric position of the body, walking up through any parent frames so a moon is
  // placed relative to the Sun rather than to its planet.
  let x = 0;
  let y = 0;
  let z = 0;
  for (let f = entry?.frame ?? null; f && f !== sun?.frame; f = f.parent) {
    x += f.position.x;
    y += f.position.y;
    z += f.position.z;
  }

  const r = Math.hypot(x, y, z);
  if (!Number.isFinite(r) || r === 0) {
    // The Sun itself, or anything without a resolvable heliocentric position.
    return { x: distanceM, y: distanceM * 0.3, z: 0 };
  }

  // Toward the Sun, plus a lift out of the orbital plane for a three-quarter view.
  const sunward = { x: -x / r, y: -y / r, z: -z / r };
  const lift = 0.32;
  const nx = sunward.x;
  const ny = sunward.y + lift;
  const nz = sunward.z + lift * 0.6;
  const n = Math.hypot(nx, ny, nz);

  return { x: (nx / n) * distanceM, y: (ny / n) * distanceM, z: (nz / n) * distanceM };
}

// Begin in low Earth orbit on the daylit side. Home first.
const earthEntry = scene.bodies.get("earth")!;
const camera = createCamera(earthEntry.frame, { x: EARTH.radiusM * 2.6, y: 0, z: 0 });
camera.position = sunwardStandoff("earth", EARTH.radiusM * 2.9);

/**
 * Depth strategy.
 *
 * Two paths, and the default is the one that has actually been looked at on a screen.
 *
 * `logarithmic` is a single pass with Three's logarithmic depth buffer. Three applies it
 * per-vertex, which interpolates incorrectly across very large triangles, so it is a
 * compromise rather than a solution -- but it is one pass, it is fast, and the scene it
 * produces has been verified.
 *
 * `partitioned` renders the scene once per depth partition, far to near, clearing depth
 * between passes so nearer partitions overwrite. This is what actually makes twenty orders
 * of magnitude work: each pass gets its own near/far planes and therefore its own full
 * depth range, instead of six orders of magnitude sharing one buffer. The cost is one full
 * scene traversal per partition.
 *
 * It is opt-in via `?depth=partitioned` rather than default because six full passes is a
 * real performance change and shipping it as the default without having watched the frame
 * time would be trading a verified path for an unverified one. The code is here, tested,
 * and one query parameter away.
 */
const depthStrategy =
  new URLSearchParams(window.location.search).get("depth") === "partitioned"
    ? "partitioned"
    : "logarithmic";

/**
 * Four partitions rather than the module default of six.
 *
 * The near end starts at 0.1 m because that is the closest anything is drawn, and the far
 * end at 1e27 m to match the single-pass far plane, so switching strategies cannot change
 * what is visible -- only how precisely it is depth-sorted.
 */
const depthPartitions: readonly DepthPartition[] =
  depthStrategy === "partitioned" ? buildDepthPartitions(0.1, 1e27, 4) : [];

const controls = createControls(canvas);
renderWatermark();

const debugOverlay = createDebugOverlay();
document.body.appendChild(debugOverlay.element);

// Point at Earth. Without this the camera starts at its default heading, which puts the
// planet ~90 degrees off-axis and outside a 60 degree field of view — you spawn in orbit
// staring at empty space, which is exactly what it looked like.
controls.lookAt(-camera.position.x, -camera.position.y, -camera.position.z);

/**
 * Two rails, and nothing appended straight to the body any more.
 *
 * Left holds the places you can go, right holds what is known about them. Everything starts
 * collapsed: the default state of a space application should be looking at space, and the
 * previous layout opened with six full-height panels covering almost the whole canvas.
 */
const leftDock = createDock("left");
const rightDock = createDock("right");
document.body.append(leftDock.element, rightDock.element);

const missionPanel = createMissionPanel("today");
let currentEnvelopeWidth = envelopeWidth(missionPanel.getProfile());
missionPanel.onChange((profile) => {
  currentEnvelopeWidth = envelopeWidth(profile);
  // Reconnected: changing the mission selection now changes what the world looks like,
  // rather than only a number in the HUD.
  applyEvidence();
  // The catalog counts and the planet model are both functions of the evidence, so they
  // are recomputed rather than left showing what a different selection implied.
  catalogPanel.setEvidence(profile);
  rebuildModel();
});

// ── Interstellar travel ─────────────────────────────────────────────────────────────────

const starMap = createInterstellarMap();

const bodyList = createBodyList();

// -- The modelled catalog -----------------------------------------------------------------

/**
 * The catalog-driven half of the application.
 *
 * Distinct from the interstellar map on purpose. The map covers 4,722 systems as positions
 * and names; this covers the handful with a full PlanetModel -- sourced measurements,
 * derived physics, an interrogable surface hypothesis. Blurring the two would let a system
 * we know almost nothing about look as authoritative as TRAPPIST-1.
 */
const catalogPanel = createCatalogPanel(missionPanel.getProfile());

const modelInspector = createModelInspector();
document.body.appendChild(modelInspector.element);

let currentSelection: CatalogSelection = DEFAULT_SELECTION;
let currentModel: PlanetModel | null = null;

/**
 * Rebuild the model for the selected planet under the current evidence.
 *
 * Called on selection change and on every mission change, because the evidence profile is
 * an input to the model rather than a filter applied afterwards -- that is what makes
 * deselecting a mission change the world rather than just the HUD.
 */
function rebuildModel(): void {
  try {
    currentModel = buildPlanetModel(
      currentSelection.systemId,
      currentSelection.planetId,
      missionPanel.getProfile(),
    );
    if (modelInspector.visible) modelInspector.show(currentModel);
  } catch (error) {
    currentModel = null;
    errorPanel.reportThrown(
      error,
      `Building ${currentSelection.systemId} ${currentSelection.planetId}`,
    );
  }
}

catalogPanel.onSelect((selection) => {
  currentSelection = selection;
  rebuildModel();
  if (currentModel) modelInspector.show(currentModel);
});

rebuildModel();

/**
 * Panel registration.
 *
 * Order here is the order on screen. The hints are the keyboard shortcut, so the binding is
 * discoverable without reading the help line.
 */
leftDock.add({
  id: "catalog",
  title: "Catalog",
  hint: "C",
  element: catalogPanel.element,
  // The one panel worth opening on load: it is where a first-time user chooses what to look
  // at, and it is the entry point to the provenance inspector.
  startOpen: true,
});
leftDock.add({ id: "bodies", title: "Solar System", hint: "B", element: bodyList.element });
leftDock.add({ id: "starmap", title: "Interstellar map", hint: "K", element: starMap.element });

/**
 * Telemetry is a panel, not an overlay.
 *
 * It was fixed at top-centre, directly over whatever the camera was framing -- so the readout
 * describing Earth was drawn on top of Earth. In the rail it cannot collide with anything,
 * and it is toggleable like everything else.
 */
const hudElement = document.getElementById("hud");
if (hudElement) {
  rightDock.add({
    id: "telemetry",
    title: "Telemetry",
    hint: "H",
    element: hudElement,
    startOpen: true,
  });
}

rightDock.add({ id: "missions", title: "Missions", hint: "M", element: missionPanel.element });

/**
 * Travel to a Solar System body.
 *
 * The camera is placed in the body's own frame rather than offset from the Sun, so the
 * floating-origin machinery keeps full precision right down to the surface. Standoff scales
 * with radius: three radii out frames the Sun and Ganymede equally well, which a fixed
 * distance in kilometres cannot do across four orders of magnitude of body size.
 */
function travelToBody(bodyId: string): void {
  const entry = scene.bodies.get(bodyId);
  if (!entry) return;

  // Leave any exoplanet system first, or the camera keeps a frame that is about to be freed.
  if (activeSystem) {
    activeSystem.dispose();
    activeSystem = null;
    starMap.setCurrent(null);
  }

  // Never inside the collision floor, and always on the lit side -- arriving at a black
  // disc is indistinguishable from arriving at nothing.
  const standoff = Math.max(entry.data.radiusM * 3.2, collisionRadiusM(entry.data) * 1.4);
  camera.frame = entry.frame;
  camera.position = sunwardStandoff(bodyId, standoff);
  controls.lookAt(-camera.position.x, -camera.position.y, -camera.position.z);
}

bodyList.onTravel(travelToBody);

/** Nearest-body altitude in radii, carried one frame for the orbit-line fade. */
let lastAltitudeRadii = 1e9;

/** Set to a body's name while the camera is resting on its surface. */
let grounded: string | null = null;

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

  // The modelled planet, where there is one, is the authority: its style already carries
  // the uncertainty floor, so the rendering cannot accidentally drop below it.
  const style = currentModel ? speculationStyle(currentModel) : null;

  for (const body of activeSystem?.planets ?? []) {
    const material = body.mesh.material as THREE.MeshStandardMaterial;
    const uncertainty = Math.max(combined, body.speculation, style?.speculation ?? 0);
    // Desaturate toward neutral grey as certainty drops. A confident colour would be a
    // claim the data cannot support.
    const faded = desaturate(
      { r: material.color.r, g: material.color.g, b: material.color.b },
      Math.min(0.85, uncertainty),
    );
    material.color.setRGB(faded.r, faded.g, faded.b);
  }
}

function travelTo(systemIndex: number): void {
  const { systems, planets, names } = exoplanets;
  if (!systems || !planets || !names) return;

  // Tear the previous system down. 4,722 systems resident at once would be ~30,000 frames
  // for a scene that shows one.
  activeSystem?.dispose();
  activeSystem = buildExoSystem(
    systemIndex,
    systems,
    planets,
    names,
    scene.universe,
    scene.three,
    scene.timeS,
  );

  // Arrive a few orbital radii out from the innermost planet, so the system reads as a
  // system rather than as a star with specks near it.
  const inner = activeSystem.planets[0];
  const standoff = inner ? inner.elements.semiMajorAxisM * 2.2 : activeSystem.starRadiusM * 400;

  camera.frame = activeSystem.frame;
  camera.position = { x: standoff, y: standoff * 0.25, z: 0 };
  // Face the star you have just travelled to, rather than whatever heading you arrived with.
  controls.lookAt(-camera.position.x, -camera.position.y, -camera.position.z);
  applyEvidence();
}

function returnToSolarSystem(): void {
  activeSystem?.dispose();
  activeSystem = null;
  camera.frame = earthEntry.frame;
  camera.position = sunwardStandoff("earth", EARTH.radiusM * 2.9);
  controls.lookAt(-camera.position.x, -camera.position.y, -camera.position.z);
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
        subtitle: `${activeSystem.name} · ${(activeSystem.distancePc * 3.26156).toFixed(1)} ly from Earth`,
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

// ── Panel visibility ────────────────────────────────────────────────────────────────────

/**
 * Every panel can be hidden.
 *
 * Four panels at 300-340px each leave almost no canvas on a laptop, and flying somewhere
 * while looking through a letterbox is miserable. `U` clears everything; the individual
 * keys toggle one at a time.
 */
const panels = {
  help: document.getElementById("help"),
};

let uiHidden = false;

function setPanel(el: HTMLElement | null, visible: boolean): void {
  if (el) el.style.display = visible ? "" : "none";
}

function toggleAllUi(): void {
  uiHidden = !uiHidden;
  // Both rails slide away rather than being hidden, so the reopen handles stay reachable
  // without needing to remember the shortcut that got rid of them.
  leftDock.setRailCollapsed(uiHidden);
  rightDock.setRailCollapsed(uiHidden);
  setPanel(panels.help, !uiHidden);
  if (uiHidden) {
    provenance.hide();
    modelInspector.hide();
  }
}

// Home returns to the Solar System — the one place with ground truth to check against.
window.addEventListener("keydown", (event) => {
  // Ignore shortcuts while typing in the system search box.
  if ((event.target as HTMLElement)?.tagName === "INPUT") return;

  switch (event.code) {
    case "Home":
      returnToSolarSystem();
      break;
    case "KeyI":
      if (provenance.visible) provenance.hide();
      else inspectNearest();
      break;
    case "KeyU":
      toggleAllUi();
      break;
    case "KeyM":
      rightDock.toggle("missions");
      break;
    case "KeyK":
      leftDock.toggle("starmap");
      break;
    case "KeyB":
      leftDock.toggle("bodies");
      break;
    case "KeyH":
      rightDock.toggle("telemetry");
      break;
    case "KeyC":
      leftDock.open("catalog");
      break;
    case "KeyG":
      // The precision readout. Named for "geometry", and kept off by default because it is
      // a diagnostic rather than part of the product.
      debugOverlay.toggle();
      break;
    case "KeyP":
      // The model inspector, as distinct from I, which inspects whatever the camera is
      // nearest in the live scene.
      if (modelInspector.visible) modelInspector.hide();
      else if (currentModel) modelInspector.show(currentModel);
      break;
    default:
      break;
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
  // The giants list 1 bar because that is the reference level their radius is quoted at,
  // not a surface. Their H2/He envelope is not a composition modelled below, and drawing an
  // N2 sky over Jupiter would be inventing one.
  if (body.surfacePressurePa <= 0 || !isLandable(body)) return;

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

/**
 * Keep an atmosphere on whichever world the camera is close to.
 *
 * The shell used to be attached only when generated terrain arrived, and terrain is
 * deliberately never generated for worlds with a real surface map -- so Earth, Venus and
 * Mars, the three best-measured atmospheres there are, never drew one. The shell depends on
 * measured pressure, temperature and gravity, not on terrain, so it now follows proximity
 * alone, with the same enter/exit hysteresis terrain uses.
 */
function updateAtmosphere(nearest: { entry: SceneBody; altitudeM: number } | undefined): void {
  const id = activeSystem || !nearest ? null : nearest.entry.data.id;
  const radii = nearest ? nearest.altitudeM / nearest.entry.data.radiusM : Infinity;

  // Kept out to the exit radius, so hovering at the boundary cannot rebuild it every frame.
  if (atmosphereBodyId !== null && atmosphereBodyId === id && radii <= TERRAIN_EXIT_RADII) {
    return;
  }

  detachAtmosphere();
  if (id !== null && nearest && radii < TERRAIN_ENTER_RADII) attachAtmosphere(nearest.entry);
}

/** RingGeometry lies in the XY plane; the equatorial plane is XZ. */
const RING_PLANE_TO_EQUATOR = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);

const TERRAIN_EXAGGERATION = 25;

/**
 * Freeze orbital motion and body rotation.
 *
 * Requested while navigation is being sorted out: a moving target is hard to fly to, and
 * rotation makes it hard to tell whether the camera is drifting or the planet is. Positions
 * remain the real ones for the scene's epoch.
 */
const FROZEN = true;

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

/**
 * Draw the scene under the active depth strategy.
 *
 * The partitioned path relies on `autoClear = false`: colour is cleared once, then each
 * pass clears only depth. Far to near, so a nearer partition's geometry always wins the
 * depth test against a farther one it overlaps.
 */
function renderScene(): void {
  if (depthStrategy === "logarithmic") {
    renderer.render(scene.three, threeCamera);
    return;
  }

  renderer.autoClear = false;
  renderer.clear(true, true, true);

  for (let i = depthPartitions.length - 1; i >= 0; i--) {
    const partition = depthPartitions[i]!;
    threeCamera.near = partition.nearM;
    threeCamera.far = partition.farM;
    threeCamera.updateProjectionMatrix();
    renderer.clearDepth();
    renderer.render(scene.three, threeCamera);
  }
}

/** Largest camera-relative offset handed to Three.js this frame, for the debug overlay. */
let maxRelativeM = 0;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  smoothedFps = smoothedFps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

  // 1. Motion is frozen for now, by request. Positions are still the real ones for the
  //    epoch the scene was built at — the planets simply do not advance along their orbits,
  //    and nothing spins. Everything below still resolves through the same f64 path, so
  //    turning motion back on is a one-line change rather than a rewrite.
  if (!FROZEN) {
    updateOrbits(scene, scene.timeS + dt * scene.timeScale);
    if (activeSystem) updateExoSystem(activeSystem, scene.timeS);
  }

  /**
   * How strongly to draw orbit lines this frame.
   *
   * An orbit is a navigation aid at system scale and pure noise up close. From low Earth
   * orbit the other planets' orbits are 1-30 AU ellipses seen edge-on from the inside, so
   * they render as straight streaks slashing right across the sky -- which is most of what
   * made the view look broken rather than merely busy.
   *
   * One global strength rather than a per-orbit fade: the question "am I looking at a system
   * or standing on a world" has a single answer per frame, and answering it per-orbit left
   * every *other* planet's line drawn at full strength while you were on Earth.
   *
   * Uses the previous frame's altitude, which is a frame stale and entirely unnoticeable at
   * these rates.
   */
  const orbitLineStrength = Math.min(Math.max((lastAltitudeRadii - 12) / 90, 0), 1);

  // 2. Resolve every body relative to the camera, in f64, and record surface distances.
  distances.clear();
  maxRelativeM = 0;
  for (const entry of scene.bodies.values()) {
    const rel = cameraRelative(camera, entry.frame);
    entry.mesh.position.set(rel.x, rel.y, rel.z);
    // Axial tilt is kept — it is measured — but the spin term is frozen at zero.
    entry.mesh.quaternion.copy(bodyOrientation(entry.data, FROZEN ? 0 : scene.timeS));

    if (entry.rings) {
      // Rings share the planet's centre and its axial tilt, but never its spin: the ring
      // plane is fixed by the planet's equator, and the particles orbit within it. Saturn's
      // rings do not turn once per Saturn day.
      entry.rings.position.copy(entry.mesh.position);
      entry.rings.quaternion
        .copy(bodyOrientation(entry.data, 0))
        .multiply(RING_PLANE_TO_EQUATOR);
    }

    if (entry.orbitLine) {
      const parent = scene.bodies.get(entry.data.parentId ?? "sun");
      if (parent) {
        const parentRel = cameraRelative(camera, parent.frame);
        entry.orbitLine.position.set(parentRel.x, parentRel.y, parentRel.z);
      }

      /**
       * Fade an orbit out as you approach the body it belongs to.
       *
       * An orbit line is a navigation aid at system scale and pure noise from close in: seen
       * from low Earth orbit, the planetary orbits are 1-30 AU ellipses that read as straight
       * streaks slashing across the whole sky, which is what made the view look broken.
       *
       * Faded on the ratio of the camera's distance to the orbit's own radius, so each line
       * disappears at its own scale rather than at one hardcoded distance -- Phobos's orbit
       * and Neptune's are eight orders of magnitude apart.
       */
      const base = entry.data.kind === "moon" ? 0.1 : 0.22;
      const material = entry.orbitLine.material as THREE.LineBasicMaterial;
      material.opacity = base * orbitLineStrength;
      entry.orbitLine.visible = material.opacity > 0.004;
    }

    const distance = Math.hypot(rel.x, rel.y, rel.z);
    distances.set(entry.data.id, distance);
    if (distance > maxRelativeM) maxRelativeM = distance;
  }

  // Exoplanet bodies, resolved camera-relative exactly like Solar System ones.
  let exoAltitudeM = Infinity;
  let exoNearest: ExoPlanetBody | null = null;
  /** Set while the camera is in another star system: the world its star is lighting. */
  let host: LitWorld | null = null;

  if (activeSystem) {
    const starRel = cameraRelative(camera, activeSystem.starFrame);
    activeSystem.starMesh.position.set(starRel.x, starRel.y, starRel.z);
    activeSystem.starLight.position.copy(activeSystem.starMesh.position);
    const starDistance = Math.hypot(starRel.x, starRel.y, starRel.z);

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

    /**
     * The world being lit is the nearest planet, at its actual distance from its own star.
     *
     * Luminosity genuinely matters here: TRAPPIST-1 is 0.00055 L_sun, its planets orbit at
     * 0.01-0.06 AU, and they still receive roughly Earth's illumination. Assuming a Sun-like
     * host would render them hundreds of times too bright. `planLighting` below turns this
     * into both the exposure and the readout.
     */
    const lit = exoNearest as ExoPlanetBody | null;
    host = {
      distanceFromStarM: lit
        ? lit.mesh.position.distanceTo(activeSystem.starMesh.position)
        : Math.max(starDistance, activeSystem.starRadiusM * 10),
      luminositySun: activeSystem.starLuminositySun,
    };
  }

  const nearest = nearestBody(scene, distances);
  const altitudeM = activeSystem ? exoAltitudeM : (nearest?.altitudeM ?? 1e9);
  exoNearestName = exoNearest?.name ?? null;
  nearestEntry = nearest?.entry ?? null;
  lastAltitudeRadii = nearest ? nearest.altitudeM / nearest.entry.data.radiusM : 1e9;

  // Keep the gazetteer's highlight on wherever you actually are, including when you arrive
  // somewhere by flying rather than by clicking. It re-renders only when the answer changes.
  bodyList.setCurrent(activeSystem ? null : (nearestEntry?.data.id ?? null));

  // 3. Camera, then rebase with hysteresis so a hovering camera cannot flip frames.
  // The flight model wants distance to the nearest *surface*: it sets the throttle
  // ceiling so you can always cross the gap ahead in about half a second.
  controls.update(camera, threeCamera, Math.max(altitudeM, 1), dt);
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

  // Solar System bodies keep their measured maps: generating terrain over real imagery
  // would replace data with invention on the one set of worlds we can actually check.
  if (!activeSystem && nearest && !hasSurfaceMap(nearest.entry.data.id)) {
    const radii = nearest.altitudeM / nearest.entry.data.radiusM;
    if (radii < TERRAIN_ENTER_RADII) requestTerrain(nearest.entry);
  }
  for (const entry of scene.bodies.values()) {
    if (entry.terrainState !== "detailed") continue;
    const distance = distances.get(entry.data.id) ?? Infinity;
    if ((distance - entry.data.radiusM) / entry.data.radiusM > TERRAIN_EXIT_RADII) {
      releaseTerrain(entry);
    }
  }
  updateAtmosphere(nearest);

  /**
   * Solid ground.
   *
   * Without this the camera passes straight through every world: you aim at Earth, hold the
   * throttle, and emerge on the far side having seen the inside of the sphere. That is the
   * whole of "the planets are transparent, there is no solid ground".
   *
   * The push-out is applied in the body's own frame, along the surface normal, so it works
   * identically whether you are descending onto Titan or grazing the Sun. The Sun and the
   * giants get a standoff rather than a surface, because neither has one.
   */
  grounded = null;
  for (const entry of scene.bodies.values()) {
    if (entry.frame !== camera.frame) continue;

    const floor = collisionRadiusM(entry.data);
    const d = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
    if (d >= floor || d === 0) continue;

    const s = floor / d;
    camera.position.x *= s;
    camera.position.y *= s;
    camera.position.z *= s;
    // Kill the inward velocity too, or the throttle keeps pressing the camera into the
    // floor and it jitters against the surface instead of resting on it.
    controls.stop();
    grounded = isLandable(entry.data) ? entry.data.name : null;
    break;
  }

  // 5. Sunlight and atmosphere follow the camera-relative frame like everything else.
  const sunRel = scene.bodies.get("sun")!.mesh.position;
  scene.sunLight.position.copy(sunRel);
  // Star positions are stored relative to the Sun, so the whole field rides with it.
  starfield.update(sunRel);
  deepSky.update(sunRel);
  exoplanets.update(sunRel);
  const sunDistance = sunRel.length();

  /**
   * Expose for the world you are looking at, not for where the camera happens to be.
   *
   * The light is created with `decay: 0`, so Three applies no attenuation of its own and
   * every body in view receives this one intensity. Driving it from the *nearest body's*
   * distance from the Sun is therefore adaptive exposure: whatever fills the screen is lit
   * correctly, exactly as a camera or an eye would adjust on arrival.
   *
   * `adaptedExposure` compresses four decades of real illumination into about 6.4:1 while
   * keeping the ordering intact. The unmodified physics is still reported in the HUD, so
   * the compression is a stated viewing transform rather than a quiet edit to the data.
   *
   * In another star system the Sun is switched off and the host star does the lighting;
   * `planLighting` owns that decision so the light and the readout cannot disagree.
   */
  const sunMesh = scene.bodies.get("sun")!.mesh;
  const litBody = nearestEntry ?? earthEntry;
  const litHelioDistanceM = litBody.mesh.position.distanceTo(sunMesh.position);
  const lighting = planLighting(litHelioDistanceM, host);

  scene.sunLight.position.copy(sunRel);
  scene.sunLight.visible = lighting.sunEnabled;
  scene.sunLight.intensity = lighting.sunIntensity;
  if (activeSystem) activeSystem.starLight.intensity = lighting.hostIntensity;

  // Star positions are stored relative to the Sun, so the whole field rides with it.
  starfield.update(sunRel);
  deepSky.update(sunRel);
  exoplanets.update(sunRel);

  if (atmosphere && atmosphereBodyId) {
    const world = scene.bodies.get(atmosphereBodyId)!;
    atmosphere.mesh.position.copy(world.mesh.position);
    atmosphere.setPlanetCentre(world.mesh.position);
    atmosphere.setSunDirection(new THREE.Vector3().subVectors(sunRel, world.mesh.position));
  }

  renderScene();

  renderHud({
    groundedOn: grounded,
    insolationWm2: lighting.insolationWm2,
    insolationVsFullMoon: lighting.versusFullMoon,
    insolationSource: lighting.source,
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
    throttle: controls.state.speedMs,
    speedMs: controls.state.actualSpeedMs,
    fps: smoothedFps,
    localPositionMagnitudeM: vecLength(camera.position),
    rebasedThisFrame: rebased,
    speculationFraction: Math.max(currentEnvelopeWidth, activeSystem?.speculation ?? 0),
    // The exaggeration actually applied to the mesh on screen, which the builder caps against
    // the body's radius. Reporting the requested 25x while showing 2.9x would be the HUD
    // stating something untrue about the geometry the user is looking at.
    terrainExaggeration: nearest?.entry.terrain?.exaggeration ?? TERRAIN_EXAGGERATION,
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

  debugOverlay.update({
    frameId: camera.frame.id,
    frameDepth: frameDepth(camera.frame),
    localMagnitudeM: vecLength(camera.position),
    maxRelativeM,
    altitudeM,
    rebasedThisFrame: rebased,
    depthStrategy,
    partition: depthPartitions.length ? depthPartitions.length - 1 : null,
    fps: smoothedFps,
    light: lighting.sunEnabled ? "Sun" : `${activeSystem?.name ?? "host star"} (Sun off)`,
    atmosphere: atmosphereBodyId
      ? (scene.bodies.get(atmosphereBodyId)?.data.name ?? atmosphereBodyId)
      : "none",
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
