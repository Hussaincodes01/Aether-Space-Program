/**
 * Reference planet contexts for the three MVP worlds, plus solar-system anchors.
 *
 * These are fixtures, not ingested data — the real ones come from the `ps` table in P1.
 * They exist so the operator gates can be exercised and regression-tested against worlds
 * whose character we already know, which is the only way to tell whether a gate is doing
 * anything useful before real data lands.
 */

import type { PlanetContext } from "./types.js";

/**
 * TRAPPIST-1 e — terrestrial, habitable zone, tidally locked, atmosphere unconstrained.
 *
 * Surface pressure is the assumed 1 bar; no atmospheric detection has been published, so
 * every feature this enables carries low confidence by construction.
 */
export const TRAPPIST_1E: PlanetContext = {
  surfaceTemperatureK: 249,
  surfacePressurePa: 1e5,
  jeansParameter: 41,
  surfaceGravityMs2: 8.0,
  bulkDensityKgM3: 4900,
  radiusM: 5.868e6,
  tidalHeatingWm2: 0.02,
  radiogenicHeatingWm2: 0.06,
  systemAgeS: 7.6e9 * 3.156e7,
  stableLiquid: "water",
  hasStableIce: true,
  tidallyLocked: true,
  hydrosphereFraction: 0.3,
};

/**
 * LHS 3844 b — airless rock candidate. Spitzer phase-curve data is consistent with little
 * or no atmosphere, which makes it the catalog's test of the "no atmosphere" path.
 */
export const LHS_3844B: PlanetContext = {
  surfaceTemperatureK: 805,
  surfacePressurePa: 0,
  jeansParameter: 3,
  surfaceGravityMs2: 12.2,
  bulkDensityKgM3: 5300,
  radiusM: 8.4e6,
  tidalHeatingWm2: 0.01,
  radiogenicHeatingWm2: 0.05,
  systemAgeS: null,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: true,
  hydrosphereFraction: 0,
};

/**
 * GJ 1214 b — sub-Neptune with a thick, high-metallicity envelope. Bulk density is too low
 * for a solid surface, so the structural gate should reject it outright.
 */
export const GJ_1214B: PlanetContext = {
  surfaceTemperatureK: 596,
  surfacePressurePa: 1e8,
  jeansParameter: 60,
  surfaceGravityMs2: 8.9,
  bulkDensityKgM3: 1300,
  radiusM: 1.635e7,
  tidalHeatingWm2: 0.05,
  radiogenicHeatingWm2: 0.03,
  systemAgeS: 6e9 * 3.156e7,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: true,
  hydrosphereFraction: 0,
};

/** 55 Cancri e — lava world. Surface above the basalt solidus. */
export const CANCRI_55E: PlanetContext = {
  surfaceTemperatureK: 2000,
  surfacePressurePa: 1e4,
  jeansParameter: 20,
  surfaceGravityMs2: 22.5,
  bulkDensityKgM3: 6700,
  radiusM: 1.13e7,
  tidalHeatingWm2: 0.4,
  radiogenicHeatingWm2: 0.08,
  systemAgeS: 8.6e9 * 3.156e7,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: true,
  hydrosphereFraction: 0,
};

/** Earth, as a sanity anchor: every erosional operator should be admissible here. */
export const EARTH: PlanetContext = {
  surfaceTemperatureK: 288,
  surfacePressurePa: 101_325,
  jeansParameter: 700,
  surfaceGravityMs2: 9.81,
  bulkDensityKgM3: 5514,
  radiusM: 6.3781e6,
  tidalHeatingWm2: 0.003,
  radiogenicHeatingWm2: 0.087,
  systemAgeS: 4.54e9 * 3.156e7,
  stableLiquid: "water",
  hasStableIce: true,
  tidallyLocked: false,
  hydrosphereFraction: 0.71,
};

/** Titan: methane is the working fluid. The gate must not require water. */
export const TITAN: PlanetContext = {
  surfaceTemperatureK: 94,
  surfacePressurePa: 146_700,
  jeansParameter: 400,
  surfaceGravityMs2: 1.35,
  bulkDensityKgM3: 1880,
  radiusM: 2.575e6,
  tidalHeatingWm2: 0.005,
  radiogenicHeatingWm2: 0.003,
  systemAgeS: 4.5e9 * 3.156e7,
  stableLiquid: "methane",
  hasStableIce: true,
  tidallyLocked: true,
  hydrosphereFraction: 0.02,
};

export const REFERENCE_CONTEXTS = {
  "TRAPPIST-1 e": TRAPPIST_1E,
  "LHS 3844 b": LHS_3844B,
  "GJ 1214 b": GJ_1214B,
  "55 Cancri e": CANCRI_55E,
  Earth: EARTH,
  Titan: TITAN,
} as const satisfies Record<string, PlanetContext>;
