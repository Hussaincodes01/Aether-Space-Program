/**
 * The major moons.
 *
 * Twenty bodies that matter either because they are large, because they are geologically
 * active, or because they are the calibration targets that make the terrain generator
 * testable. Io is the only body in the Solar System with tidal heating high enough to repave
 * itself; Europa and Enceladus have ice shells over liquid water; Titan has a thick
 * atmosphere and methane rivers; Callisto is a dead cratered surface four billion years old.
 *
 * That spread is the point. Between them they exercise every terrain operator gate the
 * generator has, against surfaces we have actually photographed.
 *
 * Elements are osculating values near J2000 referred to each planet's equator, and physical
 * parameters come from JPL fact sheets. Source files stay ASCII-only.
 */

import { DAY, GRAVITATIONAL_CONSTANT } from "@aether/units";
import type { SolarBody } from "./bodies.js";
import type { OrbitalElements } from "./kepler.js";

const deg = (d: number): number => (d * Math.PI) / 180;
const km = (v: number): number => v * 1000;

/**
 * Planetary GM values, m^3/s^2.
 *
 * Taken as GM rather than mass because the product is measured directly from spacecraft
 * tracking and is known far more precisely than either factor alone.
 */
export const PLANET_GM = {
  mars: 4.282837e13,
  jupiter: 1.26686534e17,
  saturn: 3.7931187e16,
  uranus: 5.793939e15,
  neptune: 6.836529e15,
  pluto: 8.71e11,
} as const;

function satellite(
  semiMajorAxisKm: number,
  eccentricity: number,
  inclinationDeg: number,
  parentGM: number,
  satelliteMassKg = 0,
): OrbitalElements {
  return {
    semiMajorAxisM: km(semiMajorAxisKm),
    eccentricity,
    inclinationRad: deg(inclinationDeg),
    // Node and periapsis for satellites precess quickly and are not tabulated usefully at a
    // single epoch; zero is a display convention here, not a measurement.
    ascendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    gravitationalParameter: parentGM + GRAVITATIONAL_CONSTANT * satelliteMassKg,
  };
}

// - Mars -

export const PHOBOS: SolarBody = {
  id: "phobos",
  name: "Phobos",
  kind: "moon",
  parentId: "mars",
  radiusM: km(11.27),
  massKg: 1.0659e16,
  rotationPeriodS: 0.31891 * DAY,
  axialTiltRad: 0,
  elements: satellite(9376, 0.0151, 1.093, PLANET_GM.mars, 1.0659e16),
  bondAlbedo: 0.071,
  surfaceTemperatureK: 233,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: true,
  tintHex: 0x7a6f63,
  blurb: "Spiralling inward; will break up or hit Mars within 50 million years.",
};

export const DEIMOS: SolarBody = {
  id: "deimos",
  name: "Deimos",
  kind: "moon",
  parentId: "mars",
  radiusM: km(6.2),
  massKg: 1.4762e15,
  rotationPeriodS: 1.263 * DAY,
  axialTiltRad: 0,
  elements: satellite(23_463, 0.00033, 0.93, PLANET_GM.mars, 1.4762e15),
  bondAlbedo: 0.068,
  surfaceTemperatureK: 233,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: true,
  tintHex: 0x8a7d6f,
  blurb: "Smaller and smoother than Phobos; regolith fills its craters.",
};

// - Jupiter: the Galilean moons -

export const IO: SolarBody = {
  id: "io",
  name: "Io",
  kind: "moon",
  parentId: "jupiter",
  radiusM: km(1821.6),
  massKg: 8.931938e22,
  rotationPeriodS: 1.769138 * DAY,
  axialTiltRad: 0,
  elements: satellite(421_800, 0.0041, 0.036, PLANET_GM.jupiter, 8.931938e22),
  bondAlbedo: 0.63,
  surfaceTemperatureK: 110,
  surfacePressurePa: 1e-9,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
  tidallyLocked: true,
  tintHex: 0xd8c060,
  blurb: "The most volcanically active body known. Tidal heating repaves it continuously.",
};

export const EUROPA: SolarBody = {
  id: "europa",
  name: "Europa",
  kind: "moon",
  parentId: "jupiter",
  radiusM: km(1560.8),
  massKg: 4.799844e22,
  rotationPeriodS: 3.551181 * DAY,
  axialTiltRad: 0,
  elements: satellite(671_100, 0.0094, 0.466, PLANET_GM.jupiter, 4.799844e22),
  bondAlbedo: 0.67,
  surfaceTemperatureK: 102,
  surfacePressurePa: 1e-6,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xd9cbb0,
  blurb: "Ice shell over a liquid water ocean; laced with tidal fracture lineae.",
};

export const GANYMEDE: SolarBody = {
  id: "ganymede",
  name: "Ganymede",
  kind: "moon",
  parentId: "jupiter",
  radiusM: km(2634.1),
  massKg: 1.4819e23,
  rotationPeriodS: 7.154553 * DAY,
  axialTiltRad: 0,
  elements: satellite(1_070_400, 0.0013, 0.177, PLANET_GM.jupiter, 1.4819e23),
  bondAlbedo: 0.43,
  surfaceTemperatureK: 110,
  surfacePressurePa: 1e-6,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x9c9086,
  blurb: "Largest moon in the Solar System, and the only one with its own magnetic field.",
};

export const CALLISTO: SolarBody = {
  id: "callisto",
  name: "Callisto",
  kind: "moon",
  parentId: "jupiter",
  radiusM: km(2410.3),
  massKg: 1.075938e23,
  rotationPeriodS: 16.689 * DAY,
  axialTiltRad: 0,
  elements: satellite(1_882_700, 0.0074, 0.192, PLANET_GM.jupiter, 1.075938e23),
  bondAlbedo: 0.17,
  surfaceTemperatureK: 134,
  surfacePressurePa: 1e-7,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x6b6158,
  blurb:
    "The most heavily cratered surface known. Essentially unchanged for four billion years.",
};

// - Saturn -

export const MIMAS: SolarBody = {
  id: "mimas",
  name: "Mimas",
  kind: "moon",
  parentId: "saturn",
  radiusM: km(198.2),
  massKg: 3.749e19,
  rotationPeriodS: 0.942422 * DAY,
  axialTiltRad: 0,
  elements: satellite(185_539, 0.0196, 1.574, PLANET_GM.saturn, 3.749e19),
  bondAlbedo: 0.6,
  surfaceTemperatureK: 64,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xb8b4ae,
  blurb: "Herschel crater spans a third of its diameter; the impact nearly split it.",
};

export const ENCELADUS: SolarBody = {
  id: "enceladus",
  name: "Enceladus",
  kind: "moon",
  parentId: "saturn",
  radiusM: km(252.1),
  massKg: 1.08022e20,
  rotationPeriodS: 1.370218 * DAY,
  axialTiltRad: 0,
  elements: satellite(237_948, 0.0047, 0.009, PLANET_GM.saturn, 1.08022e20),
  // The most reflective body in the Solar System - fresh ice, constantly resurfaced.
  bondAlbedo: 0.81,
  surfaceTemperatureK: 75,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xf0f4f7,
  blurb: "Vents water from a subsurface ocean through fractures at its south pole.",
};

export const RHEA: SolarBody = {
  id: "rhea",
  name: "Rhea",
  kind: "moon",
  parentId: "saturn",
  radiusM: km(763.8),
  massKg: 2.306518e21,
  rotationPeriodS: 4.518212 * DAY,
  axialTiltRad: 0,
  elements: satellite(527_108, 0.001, 0.345, PLANET_GM.saturn, 2.306518e21),
  bondAlbedo: 0.48,
  surfaceTemperatureK: 76,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xb0aca6,
  blurb: "Second-largest Saturnian moon; an ancient, heavily cratered ice ball.",
};

export const TITAN: SolarBody = {
  id: "titan",
  name: "Titan",
  kind: "moon",
  parentId: "saturn",
  radiusM: km(2574.7),
  massKg: 1.3452e23,
  rotationPeriodS: 15.945 * DAY,
  axialTiltRad: deg(0.3),
  elements: satellite(1_221_870, 0.0288, 0.348, PLANET_GM.saturn, 1.3452e23),
  bondAlbedo: 0.22,
  surfaceTemperatureK: 94,
  // 1.45 bar - denser than Earth's, and the only moon with a substantial atmosphere.
  surfacePressurePa: 146_700,
  hydrosphereFraction: 0.02,
  // Methane is liquid at 94 K. This is the gate that proves erosion is a phase-diagram
  // question rather than "is it Earth-like".
  stableLiquid: "methane",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xd9a24c,
  blurb: "Methane rivers, lakes and dunes under a thick nitrogen atmosphere.",
};

export const IAPETUS: SolarBody = {
  id: "iapetus",
  name: "Iapetus",
  kind: "moon",
  parentId: "saturn",
  radiusM: km(734.5),
  massKg: 1.805635e21,
  rotationPeriodS: 79.3215 * DAY,
  axialTiltRad: 0,
  elements: satellite(3_560_820, 0.0283, 15.47, PLANET_GM.saturn, 1.805635e21),
  bondAlbedo: 0.25,
  surfaceTemperatureK: 110,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x8f8578,
  blurb:
    "One hemisphere is ten times darker than the other, and an equatorial ridge circles it.",
};

// - Uranus -

export const MIRANDA: SolarBody = {
  id: "miranda",
  name: "Miranda",
  kind: "moon",
  parentId: "uranus",
  radiusM: km(235.8),
  massKg: 6.59e19,
  rotationPeriodS: 1.413479 * DAY,
  axialTiltRad: 0,
  elements: satellite(129_900, 0.0013, 4.232, PLANET_GM.uranus, 6.59e19),
  bondAlbedo: 0.32,
  surfaceTemperatureK: 60,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xa8a8a8,
  blurb: "Cliffs up to 20 km high - the tallest known anywhere.",
};

export const ARIEL: SolarBody = {
  id: "ariel",
  name: "Ariel",
  kind: "moon",
  parentId: "uranus",
  radiusM: km(578.9),
  massKg: 1.251e21,
  rotationPeriodS: 2.520379 * DAY,
  axialTiltRad: 0,
  elements: satellite(190_900, 0.0012, 0.26, PLANET_GM.uranus, 1.251e21),
  bondAlbedo: 0.53,
  surfaceTemperatureK: 60,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xb4b4b0,
  blurb: "The brightest and youngest-looking Uranian moon; extensive rift valleys.",
};

export const UMBRIEL: SolarBody = {
  id: "umbriel",
  name: "Umbriel",
  kind: "moon",
  parentId: "uranus",
  radiusM: km(584.7),
  massKg: 1.275e21,
  rotationPeriodS: 4.144177 * DAY,
  axialTiltRad: 0,
  elements: satellite(266_000, 0.0039, 0.128, PLANET_GM.uranus, 1.275e21),
  bondAlbedo: 0.26,
  surfaceTemperatureK: 61,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x6e6e6e,
  blurb: "The darkest Uranian moon, and the most uniformly ancient.",
};

export const TITANIA: SolarBody = {
  id: "titania",
  name: "Titania",
  kind: "moon",
  parentId: "uranus",
  radiusM: km(788.9),
  massKg: 3.4e21,
  rotationPeriodS: 8.705872 * DAY,
  axialTiltRad: 0,
  elements: satellite(436_300, 0.0011, 0.34, PLANET_GM.uranus, 3.4e21),
  bondAlbedo: 0.35,
  surfaceTemperatureK: 60,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x9a908a,
  blurb: "Largest Uranian moon; cut by canyons up to 1,600 km long.",
};

export const OBERON: SolarBody = {
  id: "oberon",
  name: "Oberon",
  kind: "moon",
  parentId: "uranus",
  radiusM: km(761.4),
  massKg: 3.076e21,
  rotationPeriodS: 13.463239 * DAY,
  axialTiltRad: 0,
  elements: satellite(583_520, 0.0014, 0.058, PLANET_GM.uranus, 3.076e21),
  bondAlbedo: 0.31,
  surfaceTemperatureK: 61,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x8c8078,
  blurb: "Outermost major Uranian moon; craters floored with dark material.",
};

// - Neptune -

export const TRITON: SolarBody = {
  id: "triton",
  name: "Triton",
  kind: "moon",
  parentId: "neptune",
  radiusM: km(1353.4),
  massKg: 2.1389e22,
  // Retrograde orbit: almost certainly a captured Kuiper belt object.
  rotationPeriodS: -5.876854 * DAY,
  axialTiltRad: 0,
  elements: satellite(354_759, 0.000016, 156.885, PLANET_GM.neptune, 2.1389e22),
  bondAlbedo: 0.76,
  surfaceTemperatureK: 38,
  surfacePressurePa: 1.4,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xd6c8bc,
  blurb: "Coldest measured surface in the Solar System, with active nitrogen geysers.",
};

export const MAJOR_MOONS: readonly SolarBody[] = [
  PHOBOS,
  DEIMOS,
  IO,
  EUROPA,
  GANYMEDE,
  CALLISTO,
  MIMAS,
  ENCELADUS,
  RHEA,
  TITAN,
  IAPETUS,
  MIRANDA,
  ARIEL,
  UMBRIEL,
  TITANIA,
  OBERON,
  TRITON,
];
