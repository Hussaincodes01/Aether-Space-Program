/**
 * Turning a real body into a terrain context.
 *
 * This is the validation path. Every parameter here is a measurement, so if the operator
 * gates are sound they should reproduce the character of worlds we have actually visited:
 * craters on the Moon, dunes and dry valley networks on Mars, ice caps on Earth, no solid
 * surface on Jupiter. Where they do not, the rules are wrong — and that is a far cheaper
 * way to find out than waiting for someone to disagree about an exoplanet.
 */

import { ATOMIC_MASS_UNIT, BOLTZMANN, EARTH_MASS, EARTH_RADIUS, GRAVITATIONAL_CONSTANT } from "@aether/units";
import type { PlanetContext } from "@aether/terrain";
import { meanMotion } from "./kepler.js";
import { getBody, type SolarBody } from "./bodies.js";

/** Earth's mean surface heat flux from radiogenic decay, W/m². */
const EARTH_RADIOGENIC_FLUX = 0.087;

export function surfaceGravity(body: SolarBody): number {
  return (GRAVITATIONAL_CONSTANT * body.massKg) / body.radiusM ** 2;
}

export function bulkDensity(body: SolarBody): number {
  return body.massKg / ((4 / 3) * Math.PI * body.radiusM ** 3);
}

/**
 * Radiogenic surface heat flux.
 *
 * Radiogenic power scales with mantle volume, so roughly with mass; spread over the surface
 * that gives flux ∝ M/R². Normalised to Earth. Reproduces the Moon at ~0.015 W/m² and Mars
 * at ~0.03 W/m², both close to the measured and modelled values.
 */
export function radiogenicHeating(body: SolarBody): number {
  const massRatio = body.massKg / EARTH_MASS;
  const radiusRatio = body.radiusM / EARTH_RADIUS;
  return EARTH_RADIOGENIC_FLUX * (massRatio / radiusRatio ** 2);
}

/**
 * Tidal heating flux from the standard synchronous-rotation expression:
 *
 *   Ė = (21/2) · (k₂/Q) · n⁵ R⁵ e² / G
 *
 * `k₂/Q` is a bulk property nobody has measured for most bodies, so a rocky default is
 * assumed and stated. For every Solar System body modelled here the result is negligible —
 * which is correct, and is exactly why none of them look like Io.
 */
export function tidalHeating(body: SolarBody, k2OverQ = 6.5e-4): number {
  if (!body.elements) return 0;
  const n = meanMotion(body.elements);
  const e = body.elements.eccentricity;
  if (e === 0) return 0;

  const power =
    (10.5 * k2OverQ * n ** 5 * body.radiusM ** 5 * e ** 2) / GRAVITATIONAL_CONSTANT;
  return power / (4 * Math.PI * body.radiusM ** 2);
}

/**
 * Jeans escape parameter for the dominant heavy species.
 *
 * Uses an exobase temperature scaled from the surface temperature — nobody has measured an
 * exobase temperature for an exoplanet, so the same assumption is applied here to keep the
 * Solar System comparison honest rather than flattering.
 */
export function jeansParameter(body: SolarBody, speciesMassAmu = 28.013): number {
  const exobaseK = Math.max(body.surfaceTemperatureK * 1.5, 150);
  return (
    (GRAVITATIONAL_CONSTANT * body.massKg * speciesMassAmu * ATOMIC_MASS_UNIT) /
    (BOLTZMANN * exobaseK * body.radiusM)
  );
}

/**
 * Derive a terrain context from measured parameters.
 *
 * Nothing is invented here: every field traces to a value in `bodies.ts`, or to a formula
 * above that names its assumption.
 */
export function toPlanetContext(body: SolarBody): PlanetContext {
  return {
    surfaceTemperatureK: body.surfaceTemperatureK,
    surfacePressurePa: body.surfacePressurePa,
    jeansParameter: jeansParameter(body),
    surfaceGravityMs2: surfaceGravity(body),
    bulkDensityKgM3: bulkDensity(body),
    radiusM: body.radiusM,
    tidalHeatingWm2: tidalHeating(body),
    radiogenicHeatingWm2: radiogenicHeating(body),
    // The Solar System is well dated; an exoplanet usually is not.
    systemAgeS: 4.568e9 * 3.15576e7,
    stableLiquid: body.stableLiquid,
    hasStableIce: body.hasStableIce,
    tidallyLocked: body.tidallyLocked,
    hydrosphereFraction: body.hydrosphereFraction,
  };
}

export function contextFor(bodyId: string): PlanetContext | undefined {
  const body = getBody(bodyId);
  return body ? toPlanetContext(body) : undefined;
}

/** Equilibrium temperature check, for comparing derived values against the measured ones. */
export function equilibriumTemperature(body: SolarBody, solarLuminosityW = 3.828e26): number {
  if (!body.elements) return body.surfaceTemperatureK;
  const a = body.elements.semiMajorAxisM;
  const flux = solarLuminosityW / (4 * Math.PI * a * a);
  const sigma = 5.670374419e-8;
  return Math.pow((flux * (1 - body.bondAlbedo)) / (4 * sigma), 0.25);
}
