/**
 * The deep sky — 12,160 galaxies, clusters and nebulae from OpenNGC.
 *
 * Two populations, drawn the same way but meaning different things:
 *
 *   - **10,568 objects with a derived distance**, placed at their true 3D position. Mostly
 *     galaxies, from redshift; a few hundred Galactic objects from parallax.
 *   - **1,592 with no distance at all**, projected onto a nominal sphere beyond the stars.
 *     These are flagged rather than given an invented depth, and the HUD says how many.
 *
 * Colour is by object class and follows the physics where there is one: HII regions red
 * from hydrogen-alpha, planetary nebulae teal from doubly ionised oxygen, reflection
 * nebulae blue because scattering favours short wavelengths — the same reason Earth's sky
 * is blue. See `DEEP_SKY_DISPLAY`.
 */

import * as THREE from "three";
import {
  DEEP_SKY_DISPLAY,
  DeepSkyType,
  UNKNOWN_MAGNITUDE,
  loadDeepSky,
  loadNames,
  megaparsecsToMetres,
  type DeepSkyCatalog,
  type NamedObject,
} from "@aether/deepsky";

import catalogUrl from "@aether/deepsky/data/deepsky.bin?url";
import namesUrl from "@aether/deepsky/data/deepsky-names.json?url";

/**
 * Radius for objects with no measured distance, in metres — about 100 Mpc.
 *
 * Beyond the star catalogue so they never interleave with it, and roughly where the
 * catalogue's median galaxy sits, so an unmeasured object does not stand out as obviously
 * misplaced. It is a display convention, not a measurement, and is labelled as one.
 */
const NOMINAL_RADIUS_M = 3.1e24;

export interface DeepSkyLayer {
  points: THREE.Points;
  count: number;
  /** How many are shown at a conventional distance because none is known. */
  withoutDistance: number;
  names: NamedObject[];
  catalog: DeepSkyCatalog | null;
  update: (sunRelativeToCamera: THREE.Vector3) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

function buildGeometry(catalog: DeepSkyCatalog): {
  geometry: THREE.BufferGeometry;
  withoutDistance: number;
} {
  const { count } = catalog;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  let withoutDistance = 0;

  for (let i = 0; i < count; i++) {
    const dx = catalog.directions[i * 3]!;
    const dy = catalog.directions[i * 3 + 1]!;
    const dz = catalog.directions[i * 3 + 2]!;

    const mpc = catalog.distancesMpc[i]!;
    const radius = mpc > 0 ? megaparsecsToMetres(mpc) : NOMINAL_RADIUS_M;
    if (mpc <= 0) withoutDistance++;

    positions[i * 3] = dx * radius;
    positions[i * 3 + 1] = dy * radius;
    positions[i * 3 + 2] = dz * radius;

    const type = catalog.types[i] as DeepSkyType;
    const display = DEEP_SKY_DISPLAY[type] ?? DEEP_SKY_DISPLAY[DeepSkyType.Other];

    // Magnitude drives brightness where it is known. Roughly a third of the catalogue has
    // no measured V magnitude; those are drawn dim rather than dropped, because absence of
    // a photometric measurement is not absence of an object.
    const mag = catalog.magnitudes[i]!;
    const known = mag < UNKNOWN_MAGNITUDE;
    const brightness = known ? Math.min(1, Math.pow(10, -0.4 * (mag - 8))) : 0.18;

    colours[i * 3] = display.colour[0] * brightness;
    colours[i * 3 + 1] = display.colour[1] * brightness;
    colours[i * 3 + 2] = display.colour[2] * brightness;

    // Apparent size nudges the point size, so the Andromeda Galaxy is not the same dot as a
    // 15th-magnitude smudge. Heavily compressed: real angular sizes span four decades.
    const arcmin = catalog.majorAxes[i]!;
    const extent = arcmin > 0 ? Math.min(1, Math.log10(1 + arcmin) / 2.2) : 0;
    sizes[i] = 1.1 + (known ? Math.pow(brightness, 0.35) * 3.0 : 0.4) + extent * 3.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  return { geometry, withoutDistance };
}

function createMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColour;
      void main() {
        vColour = color;
        gl_PointSize = size;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3 vColour;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        // Softer and broader than a star: these are extended objects, and a hard point
        // would read as another star rather than as a galaxy.
        float a = exp(-r * r * 2.2) * (1.0 - smoothstep(0.8, 1.0, r));
        if (a <= 0.002) discard;
        gl_FragColor = vec4(vColour * a, 1.0);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createDeepSkyLayer(): DeepSkyLayer {
  const material = createMaterial();
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false;
  // Behind the stars: the extragalactic sky is the furthest thing there is.
  points.renderOrder = -2000;

  const layer: DeepSkyLayer = {
    points,
    count: 0,
    withoutDistance: 0,
    names: [],
    catalog: null,
    update: (sunRelativeToCamera) => {
      // Positions are stored relative to the Sun, so one vector places all 12,000.
      points.position.copy(sunRelativeToCamera);
    },
    setVisible: (visible) => {
      points.visible = visible;
    },
    dispose: () => {
      points.geometry.dispose();
      material.dispose();
    },
  };

  loadDeepSky(catalogUrl)
    .then((catalog) => {
      const { geometry, withoutDistance } = buildGeometry(catalog);
      points.geometry.dispose();
      points.geometry = geometry;
      layer.catalog = catalog;
      layer.count = catalog.count;
      layer.withoutDistance = withoutDistance;
      return loadNames(namesUrl);
    })
    .then((names) => {
      layer.names = names;
    })
    .catch((error: unknown) => {
      // An empty deep sky is wrong but survivable; everything else still renders.
      console.warn("Deep-sky catalogue failed to load.", error);
    });

  return layer;
}
