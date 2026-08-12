/**
 * The Solar System, from real measurements.
 *
 * Orbital elements are the JPL approximate elements for 1800-2050 (Standish), referred to
 * the mean ecliptic and equinox of J2000. Physical parameters are IAU 2015 nominal values
 * where they exist and JPL fact-sheet values otherwise.
 *
 * These bodies matter beyond being a nice starting view: this is the only place the terrain
 * generator can be checked against ground truth. Nobody has resolved an exoplanet surface,
 * but we have maps of Mars. If feeding Mars's real parameters into the operator gates
 * produces something recognisably Mars-like - craters retained, dunes present, no rivers
 * today - that is genuine evidence the rules work. If it produces an ocean world, the rules
 * are wrong, and we would never have learned that from exoplanets alone.
 *
 * Source files stay ASCII-only: this one was corrupted once by a tool that read UTF-8 as
 * ANSI and wrote it back, and physics symbols in comments are not worth that risk.
 */

import { AU, DAY, GRAVITATIONAL_CONSTANT, JULIAN_YEAR } from "@aether/units";
import type { OrbitalElements } from "./kepler.js";

const deg = (d: number): number => (d * Math.PI) / 180;

/** Heliocentric gravitational parameter, GM_sun. Known far better than G or M_sun alone. */
export const SUN_GM = 1.32712440018e20;

export type BodyKind = "star" | "planet" | "moon" | "dwarf";

export interface SolarBody {
  id: string;
  name: string;
  kind: BodyKind;
  /** Parent body id. Absent for the Sun. */
  parentId?: string;

  radiusM: number;
  massKg: number;
  /** Sidereal rotation period, seconds. Negative means retrograde. */
  rotationPeriodS: number;
  /** Obliquity to the orbital plane, radians. */
  axialTiltRad: number;

  /** Absent for the Sun. */
  elements?: OrbitalElements;

  /** Bond albedo, measured. */
  bondAlbedo: number;
  /** Mean surface (or 1-bar) temperature, kelvin. */
  surfaceTemperatureK: number;
  /** Surface pressure, pascals. Zero for airless bodies. */
  surfacePressurePa: number;
  /** Fraction of the surface covered by stable surface liquid. */
  hydrosphereFraction: number;
  /** Which liquid, if any, is stable at the surface. */
  stableLiquid: "water" | "methane" | "co2" | "none";
  hasStableIce: boolean;
  tidallyLocked: boolean;
  /** Display tint, used before terrain generation completes. */
  tintHex: number;
  /** One line for the UI. */
  blurb: string;
}

function heliocentric(
  semiMajorAxisAu: number,
  eccentricity: number,
  inclinationDeg: number,
  ascendingNodeDeg: number,
  longitudeOfPerihelionDeg: number,
  meanLongitudeDeg: number,
  planetMassKg = 0,
): OrbitalElements {
  // JPL tabulates longitude of perihelion (pi-bar) and mean longitude (L); the classical
  // elements follow as omega = pi-bar - Omega, and M = L - pi-bar.
  const argumentOfPeriapsisDeg = longitudeOfPerihelionDeg - ascendingNodeDeg;
  const meanAnomalyDeg = meanLongitudeDeg - longitudeOfPerihelionDeg;

  return {
    semiMajorAxisM: semiMajorAxisAu * AU,
    eccentricity,
    inclinationRad: deg(inclinationDeg),
    ascendingNodeRad: deg(ascendingNodeDeg),
    argumentOfPeriapsisRad: deg(argumentOfPeriapsisDeg),
    meanAnomalyAtEpochRad: deg(meanAnomalyDeg),
    // The two-body parameter is G(M_sun + m), not GM_sun. For the terrestrial planets the
    // difference is invisible, but Jupiter is 1/1047 of a solar mass and omitting it puts
    // its orbital period out by two days.
    gravitationalParameter: SUN_GM + GRAVITATIONAL_CONSTANT * planetMassKg,
  };
}

export const SUN: SolarBody = {
  id: "sun",
  name: "Sun",
  kind: "star",
  radiusM: 6.957e8,
  massKg: SUN_GM / GRAVITATIONAL_CONSTANT,
  rotationPeriodS: 25.05 * DAY,
  axialTiltRad: deg(7.25),
  bondAlbedo: 0,
  surfaceTemperatureK: 5772,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: false,
  tintHex: 0xfff1ea,
  blurb: "G2V main-sequence star. Effective temperature 5772 K.",
};

export const MERCURY: SolarBody = {
  id: "mercury",
  name: "Mercury",
  kind: "planet",
  parentId: "sun",
  radiusM: 2.4397e6,
  massKg: 3.3011e23,
  rotationPeriodS: 58.646 * DAY,
  axialTiltRad: deg(0.034),
  elements: heliocentric(
    0.38709927, 0.20563593, 7.00497902, 48.33076593, 77.4577963, 252.2503235, 3.3011e23,
  ),
  bondAlbedo: 0.088,
  surfaceTemperatureK: 440,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true, // Permanently shadowed polar craters hold water ice.
  tidallyLocked: false, // 3:2 spin-orbit resonance, not synchronous.
  tintHex: 0x8c8378,
  blurb: "Airless, heavily cratered, 3:2 spin-orbit resonance.",
};

export const VENUS: SolarBody = {
  id: "venus",
  name: "Venus",
  kind: "planet",
  parentId: "sun",
  radiusM: 6.0518e6,
  massKg: 4.8675e24,
  rotationPeriodS: -243.025 * DAY, // Retrograde.
  axialTiltRad: deg(177.36),
  elements: heliocentric(
    0.72333566, 0.00677672, 3.39467605, 76.67984255, 131.60246718, 181.9790995, 4.8675e24,
  ),
  bondAlbedo: 0.76,
  surfaceTemperatureK: 737,
  surfacePressurePa: 9.2e6, // 92 bar.
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: false,
  tintHex: 0xd9c9a3,
  blurb: "92 bar of CO2, 737 K surface, retrograde rotation.",
};

export const EARTH: SolarBody = {
  id: "earth",
  name: "Earth",
  kind: "planet",
  parentId: "sun",
  radiusM: 6.3781e6,
  massKg: 5.97237e24,
  rotationPeriodS: 0.99726968 * DAY,
  axialTiltRad: deg(23.4393),
  elements: heliocentric(
    1.00000261, 0.01671123, -0.00001531, 0.0, 102.93768193, 100.46457166, 5.97237e24,
  ),
  bondAlbedo: 0.306,
  surfaceTemperatureK: 288,
  surfacePressurePa: 101_325,
  hydrosphereFraction: 0.708,
  stableLiquid: "water",
  hasStableIce: true,
  tidallyLocked: false,
  tintHex: 0x2a5f8f,
  blurb: "The only world where the generator can be checked against a map.",
};

export const MOON: SolarBody = {
  id: "moon",
  name: "Moon",
  kind: "moon",
  parentId: "earth",
  radiusM: 1.7374e6,
  massKg: 7.342e22,
  rotationPeriodS: 27.321661 * DAY,
  axialTiltRad: deg(6.68),
  elements: {
    semiMajorAxisM: 3.84399e8,
    eccentricity: 0.0549,
    inclinationRad: deg(5.145),
    ascendingNodeRad: deg(125.08),
    argumentOfPeriapsisRad: deg(318.15),
    meanAnomalyAtEpochRad: deg(135.27),
    // Two-body GM of the Earth-Moon system, not Earth alone. The Moon is 1.2% of Earth's
    // mass, enough to shift the sidereal period by a quarter of a day.
    gravitationalParameter: GRAVITATIONAL_CONSTANT * (5.97237e24 + 7.342e22),
  },
  bondAlbedo: 0.11,
  surfaceTemperatureK: 250,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x9a958d,
  blurb: "Tidally locked, airless, saturated with impact craters.",
};

export const MARS: SolarBody = {
  id: "mars",
  name: "Mars",
  kind: "planet",
  parentId: "sun",
  radiusM: 3.3895e6,
  massKg: 6.4171e23,
  rotationPeriodS: 1.02595676 * DAY,
  axialTiltRad: deg(25.19),
  elements: heliocentric(
    1.52371034, 0.0933941, 1.84969142, 49.55953891, -23.94362959, -4.55343205, 6.4171e23,
  ),
  bondAlbedo: 0.25,
  surfaceTemperatureK: 210,
  surfacePressurePa: 636, // ~6.36 mbar - thin, but enough for the largest dune fields known.
  hydrosphereFraction: 0,
  stableLiquid: "none", // Liquid water is not stable at 6 mbar; it boils or freezes.
  hasStableIce: true,
  tidallyLocked: false,
  tintHex: 0xb5643c,
  blurb: "6 mbar of CO2, vast dune fields, ancient valley networks, no liquid today.",
};

export const JUPITER: SolarBody = {
  id: "jupiter",
  name: "Jupiter",
  kind: "planet",
  parentId: "sun",
  radiusM: 7.1492e7,
  massKg: 1.8982e27,
  rotationPeriodS: 0.41354 * DAY,
  axialTiltRad: deg(3.13),
  elements: heliocentric(
    5.202887, 0.04838624, 1.30439695, 100.47390909, 14.72847983, 34.39644051, 1.8982e27,
  ),
  bondAlbedo: 0.503,
  surfaceTemperatureK: 165, // At the 1 bar level; there is no surface.
  surfacePressurePa: 1e5,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: false,
  tintHex: 0xc9a882,
  blurb: "No solid surface. An H/He envelope you fall through.",
};

export const SATURN: SolarBody = {
  id: "saturn",
  name: "Saturn",
  kind: "planet",
  parentId: "sun",
  radiusM: 6.0268e7,
  massKg: 5.6834e26,
  rotationPeriodS: 0.44401 * DAY,
  axialTiltRad: deg(26.73),
  elements: heliocentric(
    9.53667594, 0.05386179, 2.48599187, 113.66242448, 92.59887831, 49.95424423, 5.6834e26,
  ),
  bondAlbedo: 0.342,
  surfaceTemperatureK: 134,
  surfacePressurePa: 1e5,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: false,
  tintHex: 0xe0c9a0,
  blurb: "Lowest mean density of any planet - less dense than water.",
};

export const URANUS: SolarBody = {
  id: "uranus",
  name: "Uranus",
  kind: "planet",
  parentId: "sun",
  radiusM: 2.5559e7,
  massKg: 8.681e25,
  rotationPeriodS: -0.71833 * DAY,
  axialTiltRad: deg(97.77), // Rolls along its orbit.
  elements: heliocentric(
    19.18916464, 0.04725744, 0.77263783, 74.01692503, 170.9542763, 313.23810451, 8.681e25,
  ),
  bondAlbedo: 0.3,
  surfaceTemperatureK: 76,
  surfacePressurePa: 1e5,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: false,
  tintHex: 0xa5d8de,
  blurb: "Axial tilt of 98 degrees: it orbits on its side.",
};

export const NEPTUNE: SolarBody = {
  id: "neptune",
  name: "Neptune",
  kind: "planet",
  parentId: "sun",
  radiusM: 2.4764e7,
  massKg: 1.02413e26,
  rotationPeriodS: 0.67125 * DAY,
  axialTiltRad: deg(28.32),
  elements: heliocentric(
    30.06992276, 0.00859048, 1.77004347, 131.78422574, 44.96476227, -55.12002969, 1.02413e26,
  ),
  bondAlbedo: 0.29,
  surfaceTemperatureK: 72,
  surfacePressurePa: 1e5,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: false,
  tintHex: 0x3f6cbf,
  blurb: "Fastest winds in the Solar System, over 500 m/s.",
};

export const SOLAR_SYSTEM: readonly SolarBody[] = [
  SUN,
  MERCURY,
  VENUS,
  EARTH,
  MOON,
  MARS,
  JUPITER,
  SATURN,
  URANUS,
  NEPTUNE,
];

export function getBody(id: string): SolarBody | undefined {
  return SOLAR_SYSTEM.find((b) => b.id === id);
}

/** Bodies with a solid surface worth generating terrain for. */
export function terrestrialBodies(): readonly SolarBody[] {
  return SOLAR_SYSTEM.filter(
    (b) => b.kind !== "star" && b.massKg / ((4 / 3) * Math.PI * b.radiusM ** 3) > 1500,
  );
}

/** Sidereal year in seconds, for reference in tests and the UI. */
export const SIDEREAL_YEAR_S = JULIAN_YEAR * 1.0000174;
