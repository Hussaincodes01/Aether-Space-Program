/**
 * Background star field.
 *
 * Two things make this worth doing properly rather than scattering white dots.
 *
 * First, stellar colour: every point is coloured by a blackbody at its own temperature,
 * using the same function that lights the scene. Real skies are not white — they are mostly
 * dim orange, because most stars are M dwarfs.
 *
 * Second, the luminosity function: sampling temperature uniformly would produce a sky full
 * of blue giants, which is the opposite of reality. Roughly three quarters of stars are M
 * dwarfs, and the bright tail is rare — so brightness follows a steep power law and only a
 * handful of points resolve as anything more than haze.
 *
 * Placeholder until Gaia DR3 lands in P2, at which point this is replaced by the real sky
 * rendered from the *planet's* position rather than Earth's.
 */

import * as THREE from "three";
import { stellarColor } from "@aether/physics";
import { makeRng } from "@aether/schema";

export interface StarfieldOptions {
  count?: number;
  /** Radius of the shell the stars sit on, metres. Well beyond anything else in the scene. */
  radiusM?: number;
  seed?: number;
}

/**
 * Draw a stellar temperature from something close to the real distribution.
 *
 * Present-day mass function by spectral class, approximately:
 * M ~76%, K ~12%, G ~7.6%, F ~3%, A ~0.6%, B ~0.13%, O ~0.00003%.
 */
function sampleTemperature(u: number): number {
  if (u < 0.76) return 2400 + u * (3700 - 2400) / 0.76;
  if (u < 0.88) return 3700 + (u - 0.76) * (5200 - 3700) / 0.12;
  if (u < 0.956) return 5200 + (u - 0.88) * (6000 - 5200) / 0.076;
  if (u < 0.986) return 6000 + (u - 0.956) * (7500 - 6000) / 0.03;
  if (u < 0.9985) return 7500 + (u - 0.986) * (10000 - 7500) / 0.0125;
  return 10000 + (u - 0.9985) * (25000 - 10000) / 0.0015;
}

export function createStarfield(options: StarfieldOptions = {}): THREE.Points {
  const count = options.count ?? 12000;
  const radiusM = options.radiusM ?? 4e17;
  const rng = makeRng(options.seed ?? 0x5eed);

  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: z uniform in [-1,1], not latitude, or the poles clump.
    const z = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));

    positions[i * 3] = Math.cos(theta) * r * radiusM;
    positions[i * 3 + 1] = z * radiusM;
    positions[i * 3 + 2] = Math.sin(theta) * r * radiusM;

    const temperature = sampleTemperature(rng());
    const { linear } = stellarColor(temperature);

    // Steep power law: the faint majority melts into haze, a rare few resolve as points.
    const brightness = Math.pow(rng(), 3.2);
    colours[i * 3] = linear.r * (0.25 + brightness * 0.75);
    colours[i * 3 + 1] = linear.g * (0.25 + brightness * 0.75);
    colours[i * 3 + 2] = linear.b * (0.25 + brightness * 0.75);

    sizes[i] = 0.6 + brightness * 3.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColour;
      void main() {
        vColour = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Constant screen size: stars are point sources and must not shrink with distance.
        gl_PointSize = size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3 vColour;
      void main() {
        // Soft radial falloff so points read as stars rather than squares.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float a = 1.0 - smoothstep(0.35, 1.0, r);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(vColour, a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  // The star shell is effectively at infinity; it must never be culled or depth-sorted out.
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}
