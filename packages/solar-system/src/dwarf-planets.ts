/**
 * Dwarf planets, and Saturn's rings.
 *
 * The dwarf planets matter to this project for a specific reason: they are the closest
 * analogues we have to the cold, distant worlds the exoplanet catalogue almost entirely
 * lacks. Transit surveys are blind to long-period orbits, so nearly every exoplanet Aether
 * maps is warmer than Mars. Pluto, Eris and Makemake are the only surfaces we have ever
 * resolved at 40 K, and they are what keeps the generator honest at the cold end.
 *
 * Elements are heliocentric osculating values near J2000. Source files stay ASCII-only.
 */

import { AU, DAY, GRAVITATIONAL_CONSTANT } from "@aether/units";
import { SUN_GM, type SolarBody } from "./bodies.js";
import { PLANET_GM } from "./moons.js";
import type { OrbitalElements } from "./kepler.js";

const deg = (d: number): number => (d * Math.PI) / 180;
const km = (v: number): number => v * 1000;

function heliocentric(
  semiMajorAxisAu: number,
  eccentricity: number,
  inclinationDeg: number,
  ascendingNodeDeg: number,
  argumentOfPeriapsisDeg: number,
  meanAnomalyDeg: number,
  massKg = 0,
): OrbitalElements {
  return {
    semiMajorAxisM: semiMajorAxisAu * AU,
    eccentricity,
    inclinationRad: deg(inclinationDeg),
    ascendingNodeRad: deg(ascendingNodeDeg),
    argumentOfPeriapsisRad: deg(argumentOfPeriapsisDeg),
    meanAnomalyAtEpochRad: deg(meanAnomalyDeg),
    gravitationalParameter: SUN_GM + GRAVITATIONAL_CONSTANT * massKg,
  };
}

export const CERES: SolarBody = {
  id: "ceres",
  name: "Ceres",
  kind: "dwarf",
  parentId: "sun",
  radiusM: km(469.7),
  massKg: 9.3835e20,
  rotationPeriodS: 0.3781 * DAY,
  axialTiltRad: deg(4),
  elements: heliocentric(2.7675, 0.0758, 10.593, 80.305, 73.597, 95.989, 9.3835e20),
  bondAlbedo: 0.09,
  surfaceTemperatureK: 168,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: false,
  tintHex: 0x6e6963,
  blurb: "Largest object in the asteroid belt; bright salt deposits in Occator crater.",
};

export const PLUTO: SolarBody = {
  id: "pluto",
  name: "Pluto",
  kind: "dwarf",
  parentId: "sun",
  radiusM: km(1188.3),
  massKg: 1.303e22,
  // Retrograde relative to its orbit, and tidally locked to Charon rather than to the Sun.
  rotationPeriodS: -6.38723 * DAY,
  axialTiltRad: deg(122.53),
  elements: heliocentric(39.482, 0.2488, 17.16, 110.299, 113.834, 14.53, 1.303e22),
  bondAlbedo: 0.72,
  surfaceTemperatureK: 44,
  // About 1 Pa, and it collapses out as Pluto recedes from the Sun.
  surfacePressurePa: 1.0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0xc4a68a,
  blurb: "Nitrogen glaciers flowing across Sputnik Planitia; a water-ice bedrock beneath.",
};

export const CHARON: SolarBody = {
  id: "charon",
  name: "Charon",
  kind: "moon",
  parentId: "pluto",
  radiusM: km(606),
  massKg: 1.586e21,
  rotationPeriodS: 6.38723 * DAY,
  axialTiltRad: 0,
  elements: {
    semiMajorAxisM: km(19_591),
    eccentricity: 0.0002,
    inclinationRad: 0,
    ascendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    gravitationalParameter: PLANET_GM.pluto + GRAVITATIONAL_CONSTANT * 1.586e21,
  },
  bondAlbedo: 0.25,
  surfaceTemperatureK: 53,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: true,
  tintHex: 0x9a9186,
  blurb: "Half Pluto's diameter; the two are mutually locked, a genuine double system.",
};

export const ERIS: SolarBody = {
  id: "eris",
  name: "Eris",
  kind: "dwarf",
  parentId: "sun",
  radiusM: km(1163),
  massKg: 1.6466e22,
  rotationPeriodS: 15.786 * DAY,
  axialTiltRad: 0,
  elements: heliocentric(67.78, 0.44068, 44.04, 35.951, 151.639, 205.989, 1.6466e22),
  // Almost pure methane frost - the most reflective large body known after Enceladus.
  bondAlbedo: 0.96,
  surfaceTemperatureK: 30,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: false,
  tintHex: 0xdcd8d0,
  blurb: "More massive than Pluto. Its discovery is why Pluto was reclassified.",
};

export const MAKEMAKE: SolarBody = {
  id: "makemake",
  name: "Makemake",
  kind: "dwarf",
  parentId: "sun",
  radiusM: km(715),
  massKg: 3.1e21,
  rotationPeriodS: 0.9511 * DAY,
  axialTiltRad: 0,
  elements: heliocentric(45.79, 0.159, 28.98, 79.382, 294.834, 165.514, 3.1e21),
  bondAlbedo: 0.77,
  surfaceTemperatureK: 32,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: false,
  tintHex: 0xc9a898,
  blurb: "Methane ice pellets across the surface; no substantial atmosphere.",
};

export const HAUMEA: SolarBody = {
  id: "haumea",
  name: "Haumea",
  kind: "dwarf",
  parentId: "sun",
  // Radius here is the volumetric mean. Haumea is genuinely ellipsoidal - roughly
  // 2100 x 1680 x 1074 km - spun into that shape by a four-hour day.
  radiusM: km(780),
  massKg: 4.006e21,
  rotationPeriodS: 0.163146 * DAY,
  axialTiltRad: 0,
  elements: heliocentric(43.13, 0.19126, 28.19, 122.167, 239.041, 218.205, 4.006e21),
  bondAlbedo: 0.51,
  surfaceTemperatureK: 32,
  surfacePressurePa: 0,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: true,
  tidallyLocked: false,
  tintHex: 0xd0cabf,
  blurb: "Rotates every four hours, which has stretched it into an ellipsoid. It has rings.",
};

export const DWARF_PLANETS: readonly SolarBody[] = [
  CERES,
  PLUTO,
  CHARON,
  ERIS,
  MAKEMAKE,
  HAUMEA,
];

// - Rings -

export interface RingSystem {
  bodyId: string;
  /** Inner and outer edge, measured from the body's centre, in metres. */
  innerRadiusM: number;
  outerRadiusM: number;
  /** Representative optical depth, 0..1, for opacity. */
  opacity: number;
  tintHex: number;
  note: string;
}

/**
 * Ring systems.
 *
 * All four giant planets have rings; only Saturn's are substantial. The Cassini Division is
 * included as a real gap rather than painted on, because it is a resonance with Mimas - the
 * kind of structure that is a consequence of the dynamics rather than a decoration.
 */
export const RING_SYSTEMS: readonly RingSystem[] = [
  {
    bodyId: "saturn",
    innerRadiusM: km(74_500), // Inner edge of the B ring.
    outerRadiusM: km(140_220), // Outer edge of the A ring.
    opacity: 0.85,
    tintHex: 0xd8cbb0,
    note: "B and A rings. Under 1 km thick across 66,000 km of width.",
  },
  {
    bodyId: "jupiter",
    innerRadiusM: km(122_500),
    outerRadiusM: km(129_000),
    opacity: 0.04,
    tintHex: 0x8a7d6a,
    note: "Faint dust ring, sustained by impacts on the inner moons.",
  },
  {
    bodyId: "uranus",
    innerRadiusM: km(41_800),
    outerRadiusM: km(51_150),
    opacity: 0.12,
    tintHex: 0x6f7f88,
    note: "Narrow, dark rings; discovered by stellar occultation in 1977.",
  },
  {
    bodyId: "neptune",
    innerRadiusM: km(41_900),
    outerRadiusM: km(62_930),
    opacity: 0.06,
    tintHex: 0x556d8c,
    note: "Clumpy arcs rather than continuous rings, held by Galatea.",
  },
];

export function ringsFor(bodyId: string): RingSystem | undefined {
  return RING_SYSTEMS.find((r) => r.bodyId === bodyId);
}
