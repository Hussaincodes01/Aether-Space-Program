/**
 * Atmospheric scattering, driven by the physics rather than by taste.
 *
 * This is the moment the science visibly becomes the visuals. Rayleigh scattering goes as
 * 1/λ⁴, and the constant of proportionality depends on the column density and the mean
 * molecular weight — so an N₂/CO₂ atmosphere and an H₂/He one give genuinely different sky
 * colours, for a real reason, without anyone picking a hex value.
 *
 * A single-scattering raymarch: cheap, and honest about being an approximation. Multiple
 * scattering (Bruneton, or Hillaire's LUT method) is the production upgrade and is what the
 * PRD specifies for the real atmosphere pass.
 */

import * as THREE from "three";
import { ATOMIC_MASS_UNIT, BOLTZMANN } from "@aether/units";

export interface AtmosphereParams {
  planetRadiusM: number;
  /** Scale height from the physics layer, metres. */
  scaleHeightM: number;
  /** Surface pressure, pascals. Zero means no shell is drawn at all. */
  surfacePressurePa: number;
  /** Mean molecular weight, atomic mass units. */
  meanMolecularWeightAmu: number;
  surfaceTemperatureK: number;
  surfaceGravityMs2: number;
  /** Star colour, linear sRGB, from the blackbody function. */
  starColour: THREE.Color;
}

/**
 * Rayleigh scattering coefficient per channel, in 1/m.
 *
 *   β(λ) = 8π³(n² − 1)² / (3 N λ⁴)
 *
 * Refractive index is approximated from molar refractivity scaled by number density, which
 * is adequate at these pressures and keeps the mean molecular weight in the loop — the
 * thing that actually distinguishes one atmosphere from another.
 */
export function rayleighCoefficients(params: AtmosphereParams): THREE.Vector3 {
  const { surfacePressurePa, surfaceTemperatureK, meanMolecularWeightAmu } = params;
  if (surfacePressurePa <= 0) return new THREE.Vector3(0, 0, 0);

  // Number density at the surface from the ideal gas law.
  const numberDensity = surfacePressurePa / (BOLTZMANN * Math.max(surfaceTemperatureK, 1));

  // Molar refractivity scales roughly with polarisability, which tracks molecular mass for
  // the species we care about. Referenced to N2 at STP.
  const refractivityRatio = meanMolecularWeightAmu / 28.013;
  const nMinusOne = 2.78e-4 * refractivityRatio * (numberDensity / 2.547e25);

  // Wavelengths at the sRGB primaries.
  const lambdas = [680e-9, 550e-9, 440e-9];
  const coefficients = lambdas.map((lambda) => {
    const numerator = 8 * Math.PI ** 3 * (2 * nMinusOne) ** 2;
    const denominator = 3 * numberDensity * lambda ** 4;
    return numerator / denominator;
  });

  return new THREE.Vector3(coefficients[0]!, coefficients[1]!, coefficients[2]!);
}

/** Scale height H = kT/(μ m_u g), recomputed here so the shell matches the physics layer. */
export function scaleHeight(params: {
  surfaceTemperatureK: number;
  meanMolecularWeightAmu: number;
  surfaceGravityMs2: number;
}): number {
  return (
    (BOLTZMANN * params.surfaceTemperatureK) /
    (params.meanMolecularWeightAmu * ATOMIC_MASS_UNIT * params.surfaceGravityMs2)
  );
}

const VERTEX = /* glsl */ `
varying vec3 vViewDir;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vViewDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uPlanetCentre;     // camera-relative, metres
uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform float uScaleHeight;
uniform vec3  uRayleigh;         // per-channel coefficient, 1/m
uniform float uMieCoefficient;
uniform vec3  uSunDir;
uniform vec3  uSunColour;
uniform float uExposure;

varying vec3 vViewDir;
varying vec3 vLocalPos;

const int STEPS = 16;
const int LIGHT_STEPS = 6;

// Ray-sphere intersection. Returns (near, far); far < near means no hit.
vec2 raySphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(1.0, -1.0);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}

float density(vec3 p) {
  float h = length(p) - uPlanetRadius;
  return exp(-max(h, 0.0) / uScaleHeight);
}

void main() {
  vec3 dir = normalize(vViewDir);
  vec3 origin = -uPlanetCentre;   // camera position in planet-local space

  vec2 atmo = raySphere(origin, dir, uAtmosphereRadius);
  if (atmo.y < 0.0) discard;

  vec2 ground = raySphere(origin, dir, uPlanetRadius);
  float start = max(atmo.x, 0.0);
  float end = (ground.y > 0.0 && ground.x > 0.0) ? ground.x : atmo.y;
  if (end <= start) discard;

  float segment = (end - start) / float(STEPS);
  vec3 rayleighAccum = vec3(0.0);
  float mieAccum = 0.0;
  float opticalDepthView = 0.0;

  for (int i = 0; i < STEPS; i++) {
    vec3 p = origin + dir * (start + segment * (float(i) + 0.5));
    float d = density(p);
    opticalDepthView += d * segment;

    // Optical depth from this point toward the star.
    vec2 lightHit = raySphere(p, uSunDir, uAtmosphereRadius);
    float lightSegment = max(lightHit.y, 0.0) / float(LIGHT_STEPS);
    float opticalDepthLight = 0.0;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      vec3 q = p + uSunDir * (lightSegment * (float(j) + 0.5));
      opticalDepthLight += density(q) * lightSegment;
    }

    vec3 transmittance = exp(-(uRayleigh * (opticalDepthView + opticalDepthLight)));
    rayleighAccum += transmittance * d * segment;
    mieAccum += d * segment;
  }

  float cosTheta = dot(dir, uSunDir);
  // Rayleigh phase: forward and back scattering are equal, which is why the sky is bright
  // in every direction rather than only near the star.
  float rayleighPhase = 0.75 * (1.0 + cosTheta * cosTheta);
  // Henyey-Greenstein, strongly forward scattering: the halo tight around the star.
  float g = 0.76;
  float g2 = g * g;
  float miePhase = (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));

  vec3 colour = uSunColour * (uRayleigh * rayleighAccum * rayleighPhase
                              + vec3(uMieCoefficient * mieAccum * miePhase));

  colour = 1.0 - exp(-colour * uExposure);
  float alpha = clamp(max(max(colour.r, colour.g), colour.b), 0.0, 1.0);
  if (alpha < 0.002) discard;

  gl_FragColor = vec4(colour, alpha);
}
`;

export interface AtmosphereShell {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Outer radius of the shell, metres. */
  radiusM: number;
  setSunDirection: (dir: THREE.Vector3) => void;
  /** Planet centre relative to the camera, metres. */
  setPlanetCentre: (centre: THREE.Vector3) => void;
}

export function createAtmosphere(params: AtmosphereParams): AtmosphereShell | null {
  // No atmosphere, no shell. An airless world must render as an airless world — drawing a
  // faint haze "so it looks nicer" would be inventing a measurement.
  if (params.surfacePressurePa <= 0) return null;

  const h = params.scaleHeightM;
  // Practically all the mass is within a handful of scale heights.
  const radiusM = params.planetRadiusM + h * 8;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uPlanetCentre: { value: new THREE.Vector3() },
      uPlanetRadius: { value: params.planetRadiusM },
      uAtmosphereRadius: { value: radiusM },
      uScaleHeight: { value: h },
      uRayleigh: { value: rayleighCoefficients(params) },
      uMieCoefficient: { value: 2.1e-6 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColour: { value: params.starColour.clone() },
      uExposure: { value: 12 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });

  const geometry = new THREE.SphereGeometry(1, 64, 32);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(radiusM);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  return {
    mesh,
    material,
    radiusM,
    setSunDirection: (dir) => {
      (material.uniforms.uSunDir!.value as THREE.Vector3).copy(dir).normalize();
    },
    setPlanetCentre: (centre) => {
      (material.uniforms.uPlanetCentre!.value as THREE.Vector3).copy(centre);
    },
  };
}
