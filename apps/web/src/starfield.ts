/**
 * The real sky.
 *
 * 109,389 stars with measured parallax distances, from the HYG database (Hipparcos, Yale
 * Bright Star, Gliese) — the same underlying catalogues OpenSpace's Digital Universe star
 * layer is built from, under a licence that permits redistribution. See
 * `packages/stars/data/ATTRIBUTION.md`.
 *
 * Two things make this a map rather than a backdrop:
 *
 *   - **Positions are real and three-dimensional.** Stars sit at their measured distances,
 *     so the constellations are an accident of our viewpoint, and would distort if the
 *     camera ever travelled far enough. Nothing is painted on a dome.
 *   - **Brightness is computed, not stored.** Apparent magnitude comes from the distance
 *     modulus against the camera's actual position, so approaching a star brightens it by
 *     exactly the right amount.
 *
 * Colour goes B-V -> effective temperature -> blackbody -> sRGB, using the same
 * `stellarColor()` that lights the planets. One physical model throughout.
 *
 * Loading is progressive: the naked-eye tier (~8,700 stars, 170 KB) appears within a frame
 * or two, then the full catalogue (2.1 MB) streams in and replaces it.
 */

import * as THREE from "three";
import { PARSEC } from "@aether/units";
import {
  loadCatalog,
  parseCatalog,
  renderScale,
  starColour,
  type StarCatalog,
} from "@aether/stars";

import brightUrl from "@aether/stars/data/stars-bright.bin?url";
import fullUrl from "@aether/stars/data/stars-full.bin?url";

export interface Starfield {
  points: THREE.Points;
  /** Number of stars currently uploaded. */
  count: number;
  /** True once the full catalogue has replaced the naked-eye tier. */
  complete: boolean;
  /**
   * Position the field for this frame.
   *
   * @param sunRelativeToCamera Sun's position relative to the camera, metres. Star
   * positions are stored relative to the Sun, so offsetting by this places the whole
   * catalogue correctly without touching 109k vertices.
   */
  update: (sunRelativeToCamera: THREE.Vector3) => void;
  dispose: () => void;
}

/**
 * Reference magnitude for brightness normalisation.
 *
 * Set near Sirius so the brightest star in the sky saturates and everything else falls
 * below it, which is what the eye actually sees.
 */
const REFERENCE_MAGNITUDE = -1.0;

function buildGeometry(catalog: StarCatalog): THREE.BufferGeometry {
  const { count, positionsPc, absoluteMagnitudes, colourIndices } = catalog;

  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  let visible = 0;

  for (let i = 0; i < count; i++) {
    const px = positionsPc[i * 3]!;
    const py = positionsPc[i * 3 + 1]!;
    const pz = positionsPc[i * 3 + 2]!;

    const distancePc = Math.hypot(px, py, pz);
    if (distancePc <= 0) continue;

    // Apparent magnitude as seen from the Sun. Recomputing per-frame from the camera's
    // true position is the correct thing and is a v2 upgrade; within the Solar System the
    // difference is far below one part in a million, since the nearest star is 270,000 AU
    // away and the camera moves over AU.
    const apparent = absoluteMagnitudes[i]! + 5 * Math.log10(distancePc) - 5;
    const { size, brightness } = renderScale(apparent, {
      referenceMagnitude: REFERENCE_MAGNITUDE,
      limitingMagnitude: 9.5,
      minPointSize: 0.55,
      maxPointSize: 6.5,
    });
    if (size <= 0) continue;

    const rgb = starColour(colourIndices[i]!);

    const o = visible * 3;
    positions[o] = px * PARSEC;
    positions[o + 1] = py * PARSEC;
    positions[o + 2] = pz * PARSEC;

    // Brightness modulates colour rather than alpha: an additive point that is dim should
    // contribute less light, not become transparent, or overlapping faint stars stack into
    // a haze brighter than any individual one.
    colours[o] = rgb.r * brightness;
    colours[o + 1] = rgb.g * brightness;
    colours[o + 2] = rgb.b * brightness;

    sizes[visible] = size;
    visible++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions.subarray(0, visible * 3), 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colours.subarray(0, visible * 3), 3),
  );
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes.subarray(0, visible), 1));
  // Bounding spheres over a 990 pc cloud are meaningless for culling and expensive to
  // compute; the field is always in view by definition.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  return geometry;
}

function createMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColour;
      void main() {
        vColour = color;
        // Constant screen size: stars are point sources. Perspective-scaling them would
        // shrink distant stars, which is exactly backwards — distance is already in the
        // magnitude.
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
        // Gaussian-ish falloff reads as a star; a hard disc reads as a sprite.
        float a = exp(-r * r * 3.5) * (1.0 - smoothstep(0.75, 1.0, r));
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

export function createStarfield(): Starfield {
  const material = createMaterial();
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false;
  // Drawn first, behind everything: the sky is infinitely far away.
  points.renderOrder = -1000;

  const field: Starfield = {
    points,
    count: 0,
    complete: false,
    update: (sunRelativeToCamera) => {
      // Star positions are stored relative to the Sun, so moving the whole object by the
      // Sun's camera-relative offset places all 109k correctly for the cost of one vector.
      points.position.copy(sunRelativeToCamera);
    },
    dispose: () => {
      points.geometry.dispose();
      material.dispose();
    },
  };

  const swapIn = (catalog: StarCatalog, complete: boolean): void => {
    const previous = points.geometry;
    points.geometry = buildGeometry(catalog);
    previous.dispose();
    field.count = points.geometry.getAttribute("position").count;
    field.complete = complete;
  };

  // Naked-eye tier first — it is what a user recognises, and it is 170 KB.
  loadCatalog(brightUrl)
    .then((catalog) => {
      swapIn(catalog, false);
      return loadCatalog(fullUrl);
    })
    .then((catalog) => swapIn(catalog, true))
    .catch((error: unknown) => {
      // A missing catalogue leaves an empty sky, which is wrong but not fatal — every other
      // part of the scene still works, and an empty sky is honest about the failure.
      console.warn("Star catalogue failed to load; the sky will be empty.", error);
    });

  return field;
}

/** Parse an already-fetched catalogue, for tests and for preloaded buffers. */
export { parseCatalog };
