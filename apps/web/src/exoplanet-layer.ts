/**
 * Every confirmed planetary system, mapped.
 *
 * 4,722 systems and 6,309 planets from the NASA Exoplanet Archive, each at its true
 * position — right ascension, declination and Gaia parallax distance — in the same
 * equatorial J2000 frame as the star and deep-sky layers.
 *
 * These are drawn as a separate layer from the general star field on purpose. The visual
 * point is *which* stars we know have planets: about 4,700 out of the 109,000 in the star
 * catalogue, picked out of the crowd. That ratio is the honest picture of how much of the
 * sky we have actually surveyed, and it is more informative than any number in a caption.
 *
 * Host colour is the star's real blackbody colour from its measured effective temperature,
 * through the same `stellarColor()` that lights planets and colours the star field.
 */

import * as THREE from "three";
import { PARSEC } from "@aether/units";
import { stellarColor } from "@aether/physics";
import {
  loadNames,
  loadPlanets,
  loadSystems,
  planetsOfSystem,
  resolvePlanet,
  speculationFraction,
  type CatalogNames,
  type PlanetCatalog,
  type SystemCatalog,
} from "@aether/exoplanets";
import { DISCARD_OFFSCREEN_POINT } from "./point-sprite.js";

import systemsUrl from "@aether/exoplanets/data/systems.bin?url";
import planetsUrl from "@aether/exoplanets/data/planets.bin?url";
import namesUrl from "@aether/exoplanets/data/names.json?url";

/** Default when a host has no measured effective temperature — roughly a K dwarf, the mode. */
const FALLBACK_TEFF = 4800;

export interface ExoplanetLayer {
  points: THREE.Points;
  systemCount: number;
  planetCount: number;
  systems: SystemCatalog | null;
  planets: PlanetCatalog | null;
  names: CatalogNames | null;
  /** Mean speculation across the catalogue — how much of it is inference rather than data. */
  meanSpeculation: number;
  /** Fires once the catalogue has loaded, for UI that needs it. */
  onReady: (listener: () => void) => void;
  update: (sunRelativeToCamera: THREE.Vector3) => void;
  /** Nearest system to a point given in parsecs from the Sun, for the HUD. */
  nearestTo: (
    positionPc: THREE.Vector3,
  ) => { index: number; name: string; distancePc: number } | null;
  dispose: () => void;
}

function buildGeometry(systems: SystemCatalog): THREE.BufferGeometry {
  const { count } = systems;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = systems.positionsPc[i * 3]! * PARSEC;
    positions[i * 3 + 1] = systems.positionsPc[i * 3 + 1]! * PARSEC;
    positions[i * 3 + 2] = systems.positionsPc[i * 3 + 2]! * PARSEC;

    const teff = systems.effectiveTemperatures[i]!;
    const { linear } = stellarColor(Number.isFinite(teff) ? teff : FALLBACK_TEFF);

    // Nearby systems are drawn brighter. This is a legibility choice, not photometry — the
    // faintest known host is far below naked-eye visibility, and rendering true apparent
    // magnitude would make almost the entire catalogue invisible.
    const distancePc = systems.distancesPc[i]!;
    const proximity = Math.min(1, Math.pow(30 / Math.max(distancePc, 1), 0.35));

    colours[i * 3] = linear.r * (0.45 + proximity * 0.55);
    colours[i * 3 + 1] = linear.g * (0.45 + proximity * 0.55);
    colours[i * 3 + 2] = linear.b * (0.45 + proximity * 0.55);

    // Multi-planet systems read slightly larger: they are the ones with real dynamics.
    const planetCount = systems.planetCount[i]!;
    sizes[i] = 2.0 + proximity * 3.2 + Math.min(planetCount - 1, 6) * 0.45;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geometry;
}

function createMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;
      varying vec3 vColour;
      void main() {
        vColour = color;
        gl_PointSize = size;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${DISCARD_OFFSCREEN_POINT}
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vColour;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        // A bright core with a thin ring, so a known host reads as marked rather than as
        // just another star in the field behind it.
        float core = exp(-r * r * 8.0);
        float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.82, 0.95, r)) * 0.55;
        float a = core + ring;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(vColour * a, 1.0);
      }
    `,
    vertexColors: true,
    transparent: true,
    // Depth *write* stays off -- these are additive point sprites and must not occlude one
    // another. Depth *test* is on, so solid geometry occludes them. Both halves are needed:
    // the test alone was useless until the shaders above joined the logarithmic depth
    // pipeline, because the planets encode depth logarithmically and these did not, so the
    // comparison was between two different encodings.
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

export function createExoplanetLayer(): ExoplanetLayer {
  const material = createMaterial();
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false;
  // Between the star field and the deep sky.
  points.renderOrder = -900;

  const readyListeners: Array<() => void> = [];

  const layer: ExoplanetLayer = {
    points,
    onReady: (listener) => {
      if (layer.systems) listener();
      else readyListeners.push(listener);
    },
    systemCount: 0,
    planetCount: 0,
    systems: null,
    planets: null,
    names: null,
    meanSpeculation: 0,
    update: (sunRelativeToCamera) => {
      // Positions are relative to the Sun, so one vector places all 4,722.
      points.position.copy(sunRelativeToCamera);
    },
    nearestTo: (positionPc) => {
      const s = layer.systems;
      if (!s || !layer.names) return null;
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < s.count; i++) {
        const dx = s.positionsPc[i * 3]! - positionPc.x;
        const dy = s.positionsPc[i * 3 + 1]! - positionPc.y;
        const dz = s.positionsPc[i * 3 + 2]! - positionPc.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      if (best < 0) return null;
      return {
        index: best,
        name: layer.names.systems[best] ?? "unknown",
        distancePc: Math.sqrt(bestDistance),
      };
    },
    dispose: () => {
      points.geometry.dispose();
      material.dispose();
    },
  };

  Promise.all([loadSystems(systemsUrl), loadPlanets(planetsUrl), loadNames(namesUrl)])
    .then(([systems, planets, names]) => {
      const previous = points.geometry;
      points.geometry = buildGeometry(systems);
      previous.dispose();

      layer.systems = systems;
      layer.planets = planets;
      layer.names = names;
      layer.systemCount = systems.count;
      layer.planetCount = planets.count;

      // Resolve the whole catalogue once so the HUD can report how much of it is inference
      // rather than measurement. ~6,300 resolutions is a few milliseconds.
      let total = 0;
      for (let s = 0; s < systems.count; s++) {
        const star = {
          teff: systems.effectiveTemperatures[s]!,
          radiusSun: systems.stellarRadiiSun[s]!,
          massSun: systems.stellarMassesSun[s]!,
          logLuminosity: systems.logLuminosities[s]!,
        };
        for (const p of planetsOfSystem(systems, s)) {
          total += speculationFraction(
            resolvePlanet(
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
            ),
          );
        }
      }
      layer.meanSpeculation = planets.count > 0 ? total / planets.count : 0;
      for (const listener of readyListeners) listener();
    })
    .catch((error: unknown) => {
      console.warn("Exoplanet catalogue failed to load.", error);
    });

  return layer;
}
