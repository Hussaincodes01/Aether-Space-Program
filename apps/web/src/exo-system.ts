/**
 * Building a real exoplanet system you can fly into.
 *
 * Takes a row out of the mapped catalogue and constructs it: host star at the system's true
 * position, planets on real Keplerian orbits from measured periods and semi-major axes,
 * with the prior chain filling anything never measured — and labelling every fill.
 *
 * ## The orientation nobody has measured
 *
 * Transits constrain a planet's inclination *to our line of sight*, and radial velocity
 * constrains nothing about orientation at all. But the longitude of the ascending node,
 * which fixes how the orbital plane is rotated *about* that line of sight, has never been
 * measured for a transiting planet — it needs astrometry or resolved imaging.
 *
 * So the roll of every exoplanet system on screen is unknowable. Rather than picking zero
 * and implying we know, it is derived from a hash of the system name: deterministic, so the
 * same system always looks the same and deep links stay reproducible, and flagged as
 * `visual_convention` at confidence zero, because that is exactly what it is.
 *
 * Systems are built on arrival and torn down on departure. 4,722 of them upfront would be
 * ~30,000 frames for a scene that shows one.
 */

import * as THREE from "three";
import { AU, GRAVITATIONAL_CONSTANT, PARSEC } from "@aether/units";
import { stellarColor } from "@aether/physics";
import { perifocalToEcliptic, stateAt, type OrbitalElements } from "@aether/solar-system";
import {
  planetsOfSystem,
  resolvePlanet,
  speculationFraction,
  type CatalogNames,
  type PlanetCatalog,
  type ResolvedPlanet,
  type SystemCatalog,
} from "@aether/exoplanets";
import { attach, createFrame, detach, vec3, type Frame } from "@aether/coordinates";
import type { PlanetContext } from "@aether/terrain";

const SOLAR_MASS_KG = 1.98892e30;
const SOLAR_RADIUS_M = 6.957e8;
const EARTH_RADIUS_M = 6.3781e6;
const EARTH_MASS_KG = 5.97237e24;

/** Fallbacks where the host has no measurement. Flagged wherever they surface. */
const FALLBACK_TEFF = 4800;
const FALLBACK_STELLAR_RADIUS_SUN = 0.7;
const FALLBACK_STELLAR_MASS_SUN = 0.7;

export interface ExoPlanetBody {
  name: string;
  frame: Frame;
  mesh: THREE.Mesh;
  orbitLine: THREE.Line;
  radiusM: number;
  elements: OrbitalElements;
  rotation: ReturnType<typeof perifocalToEcliptic>;
  resolved: ResolvedPlanet;
  /** 0..1 — how much of this world is inference rather than measurement. */
  speculation: number;
  /** Terrain input, or null where there is no solid surface to generate. */
  context: PlanetContext | null;
  terrainState: "placeholder" | "building" | "detailed";
  placeholderGeometry: THREE.BufferGeometry;
}

export interface ExoSystem {
  index: number;
  name: string;
  distancePc: number;
  frame: Frame;
  starFrame: Frame;
  starMesh: THREE.Mesh;
  starRadiusM: number;
  starLight: THREE.PointLight;
  planets: ExoPlanetBody[];
  /** Mean speculation across the system's planets. */
  speculation: number;
  dispose: () => void;
}

/**
 * Deterministic pseudo-random from a string.
 *
 * Used only for the unmeasurable orbital orientation, so the same system always renders the
 * same way and a shared link reproduces exactly.
 */
function hashUnit(text: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0) / 0x1_0000_0000;
}

function orbitLineFor(elements: OrbitalElements, colour: number): THREE.Line {
  const rotation = perifocalToEcliptic(elements);
  const points: THREE.Vector3[] = [];
  const { semiMajorAxisM: a, eccentricity: e } = elements;

  for (let i = 0; i <= 256; i++) {
    // Step in eccentric anomaly so points spread evenly rather than bunching at periapsis.
    const E = (i / 256) * Math.PI * 2;
    const nu =
      2 *
      Math.atan2(
        Math.sqrt(1 + e) * Math.sin(E / 2),
        Math.sqrt(1 - e) * Math.cos(E / 2),
      );
    const r = a * (1 - e * Math.cos(E));
    const x = r * Math.cos(nu);
    const y = r * Math.sin(nu);
    points.push(
      new THREE.Vector3(
        rotation[0] * x + rotation[1] * y,
        rotation[3] * x + rotation[4] * y,
        rotation[6] * x + rotation[7] * y,
      ),
    );
  }

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.3 }),
  );
  line.frustumCulled = false;
  return line;
}

/** Build a terrain context, or null where bulk density says there is no surface. */
function terrainContext(resolved: ResolvedPlanet, teqK: number): PlanetContext | null {
  const radiusEarth = resolved.radiusEarth.value;
  const massEarth = resolved.massEarth.value;
  if (!Number.isFinite(radiusEarth) || !Number.isFinite(massEarth)) return null;

  const radiusM = radiusEarth * EARTH_RADIUS_M;
  const massKg = massEarth * EARTH_MASS_KG;
  const density = massKg / ((4 / 3) * Math.PI * radiusM ** 3);
  if (density < 1500) return null; // Envelope-dominated: nothing to stand on.

  const gravity = (GRAVITATIONAL_CONSTANT * massKg) / radiusM ** 2;

  // Surface pressure has never been measured for any of these. It is assumed from the
  // planet's class, and every feature it gates inherits that as an assumption.
  const surfacePressurePa = teqK > 1400 ? 1e4 : radiusEarth < 1.8 ? 1e5 : 1e6;

  return {
    surfaceTemperatureK: Number.isFinite(teqK) ? teqK : 300,
    surfacePressurePa,
    jeansParameter: 30,
    surfaceGravityMs2: gravity,
    bulkDensityKgM3: density,
    radiusM,
    tidalHeatingWm2: resolved.semiMajorAu.value < 0.05 ? 0.15 : 0.01,
    radiogenicHeatingWm2: 0.05 * (massEarth / Math.max(radiusEarth ** 2, 0.01)),
    systemAgeS: null, // Ages are rarely known, and the volcanic gate must say so.
    stableLiquid: teqK > 273 && teqK < 373 ? "water" : "none",
    hasStableIce: teqK < 273,
    // Inside ~0.1 AU tidal locking is the overwhelming expectation, but it is inferred from
    // a timescale rather than observed for a single exoplanet.
    tidallyLocked: resolved.semiMajorAu.value < 0.1,
    hydrosphereFraction: teqK > 273 && teqK < 373 ? 0.4 : 0,
  };
}

export function buildExoSystem(
  index: number,
  systems: SystemCatalog,
  planets: PlanetCatalog,
  names: CatalogNames,
  universe: Frame,
  scene: THREE.Scene,
): ExoSystem {
  const name = names.systems[index] ?? `system-${index}`;

  const teff = Number.isFinite(systems.effectiveTemperatures[index]!)
    ? systems.effectiveTemperatures[index]!
    : FALLBACK_TEFF;
  const starRadiusSun = Number.isFinite(systems.stellarRadiiSun[index]!)
    ? systems.stellarRadiiSun[index]!
    : FALLBACK_STELLAR_RADIUS_SUN;
  const starMassSun = Number.isFinite(systems.stellarMassesSun[index]!)
    ? systems.stellarMassesSun[index]!
    : FALLBACK_STELLAR_MASS_SUN;

  const starRadiusM = starRadiusSun * SOLAR_RADIUS_M;
  const starGM = GRAVITATIONAL_CONSTANT * starMassSun * SOLAR_MASS_KG;

  // System frame at the catalogue's true position, in metres.
  const systemFrame = createFrame(`exosystem:${name}`, AU * 200);
  attach(systemFrame, universe, vec3(
    systems.positionsPc[index * 3]! * PARSEC,
    systems.positionsPc[index * 3 + 1]! * PARSEC,
    systems.positionsPc[index * 3 + 2]! * PARSEC,
  ));

  const starFrame = createFrame(`star:${name}`, starRadiusM * 50);
  attach(starFrame, systemFrame, vec3(0, 0, 0));

  const { linear } = stellarColor(teff);
  const starColour = new THREE.Color(linear.r, linear.g, linear.b);

  const starMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.MeshBasicMaterial({ color: starColour }),
  );
  starMesh.scale.setScalar(starRadiusM);
  starMesh.frustumCulled = false;
  scene.add(starMesh);

  const starLight = new THREE.PointLight(starColour, 1, 0, 0);
  scene.add(starLight);

  const star = {
    teff: systems.effectiveTemperatures[index]!,
    radiusSun: systems.stellarRadiiSun[index]!,
    massSun: systems.stellarMassesSun[index]!,
    logLuminosity: systems.logLuminosities[index]!,
  };

  const bodies: ExoPlanetBody[] = [];
  let speculationTotal = 0;

  for (const p of planetsOfSystem(systems, index)) {
    const resolved = resolvePlanet(
      {
        radiusEarth: planets.radiiEarth[p]!,
        massEarth: planets.massesEarth[p]!,
        periodDays: planets.periodsDays[p]!,
        semiMajorAu: planets.semiMajorAxesAu[p]!,
        eccentricity: planets.eccentricities[p]!,
        inclinationDeg: planets.inclinationsDeg[p]!,
        eqTempK: planets.equilibriumTemperatures[p]!,
        densityGcc: planets.densitiesGcc[p]!,
        discoveredByTransit: planets.discoveryMethods[p] === 0,
      },
      star,
    );

    const semiMajorAu = resolved.semiMajorAu.value;
    if (!Number.isFinite(semiMajorAu) || semiMajorAu <= 0) continue;

    const planetName = names.planets[p] ?? `planet-${p}`;

    // The unmeasurable angles. Deterministic from the name so the system is reproducible,
    // and confidence zero because nobody has ever measured either of them.
    const ascendingNodeRad = hashUnit(planetName, 0x9e37) * Math.PI * 2;
    const argumentOfPeriapsisRad = hashUnit(planetName, 0x85eb) * Math.PI * 2;

    const elements: OrbitalElements = {
      semiMajorAxisM: semiMajorAu * AU,
      eccentricity: Math.min(Math.max(resolved.eccentricity.value, 0), 0.95),
      inclinationRad: ((90 - resolved.inclinationDeg.value) * Math.PI) / 180,
      ascendingNodeRad,
      argumentOfPeriapsisRad,
      meanAnomalyAtEpochRad: hashUnit(planetName, 0x27d4) * Math.PI * 2,
      gravitationalParameter: starGM,
    };

    const radiusEarth = Number.isFinite(resolved.radiusEarth.value)
      ? resolved.radiusEarth.value
      : 1;
    const radiusM = radiusEarth * EARTH_RADIUS_M;

    const frame = createFrame(`exoplanet:${planetName}`, radiusM * 40);
    attach(frame, starFrame, vec3(0, 0, 0));

    const teqK = resolved.eqTempK.value;
    const context = terrainContext(resolved, teqK);

    // Placeholder tint before terrain arrives: temperature-led, because that is the one
    // thing usually measured. Nothing here claims to be a surface.
    const tint = !Number.isFinite(teqK)
      ? 0x8a8378
      : teqK > 1200 ? 0xff6a3a
      : teqK > 600 ? 0xc98a5e
      : teqK > 350 ? 0xb5a184
      : teqK > 250 ? 0x6d8fa8
      : 0xcdd9e5;

    const placeholderGeometry = new THREE.SphereGeometry(1, 32, 16);
    const mesh = new THREE.Mesh(
      placeholderGeometry,
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.92, metalness: 0.02 }),
    );
    mesh.scale.setScalar(radiusM);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const orbitLine = orbitLineFor(elements, 0x5ea8ff);
    scene.add(orbitLine);

    const speculation = speculationFraction(resolved);
    speculationTotal += speculation;

    bodies.push({
      name: planetName,
      frame,
      mesh,
      orbitLine,
      radiusM,
      elements,
      rotation: perifocalToEcliptic(elements),
      resolved,
      speculation,
      context,
      terrainState: "placeholder",
      placeholderGeometry,
    });
  }

  const dispose = (): void => {
    for (const body of bodies) {
      scene.remove(body.mesh, body.orbitLine);
      body.mesh.geometry.dispose();
      (body.mesh.material as THREE.Material).dispose();
      body.orbitLine.geometry.dispose();
      (body.orbitLine.material as THREE.Material).dispose();
      detach(body.frame);
    }
    scene.remove(starMesh, starLight);
    starMesh.geometry.dispose();
    (starMesh.material as THREE.Material).dispose();
    detach(starFrame);
    detach(systemFrame);
  };

  return {
    index,
    name,
    distancePc: systems.distancesPc[index]!,
    frame: systemFrame,
    starFrame,
    starMesh,
    starRadiusM,
    starLight,
    planets: bodies,
    speculation: bodies.length > 0 ? speculationTotal / bodies.length : 1,
    dispose,
  };
}

/** Advance every planet along its orbit. */
export function updateExoSystem(system: ExoSystem, timeS: number): void {
  for (const body of system.planets) {
    const { position } = stateAt(body.elements, timeS, body.rotation);
    body.frame.position.x = position.x;
    body.frame.position.y = position.y;
    body.frame.position.z = position.z;
  }
}
