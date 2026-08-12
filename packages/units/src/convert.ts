/**
 * Explicit conversions between catalog units and SI.
 *
 * Catalogs publish radii in Earth radii, Jupiter radii or solar radii; masses in Earth or
 * Jupiter masses; distances in parsecs or AU; periods in days. Every one of those enters
 * Aether through a named function here and leaves as SI. There is no other legal entry
 * point, and there is no function that converts "a radius" without saying which radius.
 */

import { si } from "./brand.js";
import type { Kilograms, Metres, Seconds, Watts } from "./brand.js";
import {
  AU,
  DAY,
  EARTH_MASS,
  EARTH_RADIUS,
  JULIAN_YEAR,
  JUPITER_MASS,
  JUPITER_RADIUS,
  PARSEC,
  SOLAR_LUMINOSITY,
  SOLAR_MASS,
  SOLAR_RADIUS,
} from "./constants.js";

// ── Into SI ─────────────────────────────────────────────────────────────────────────────

export const earthRadii = (n: number): Metres => si<Metres>(n * EARTH_RADIUS);
export const jupiterRadii = (n: number): Metres => si<Metres>(n * JUPITER_RADIUS);
export const solarRadii = (n: number): Metres => si<Metres>(n * SOLAR_RADIUS);
export const astronomicalUnits = (n: number): Metres => si<Metres>(n * AU);
export const parsecs = (n: number): Metres => si<Metres>(n * PARSEC);
export const kilometres = (n: number): Metres => si<Metres>(n * 1000);

export const earthMasses = (n: number): Kilograms => si<Kilograms>(n * EARTH_MASS);
export const jupiterMasses = (n: number): Kilograms => si<Kilograms>(n * JUPITER_MASS);
export const solarMasses = (n: number): Kilograms => si<Kilograms>(n * SOLAR_MASS);

export const days = (n: number): Seconds => si<Seconds>(n * DAY);
export const julianYears = (n: number): Seconds => si<Seconds>(n * JULIAN_YEAR);
export const hours = (n: number): Seconds => si<Seconds>(n * 3600);

export const solarLuminosities = (n: number): Watts => si<Watts>(n * SOLAR_LUMINOSITY);

export const degrees = (n: number): number => (n * Math.PI) / 180;

/** Grams per cubic centimetre — the unit every density table uses. */
export const gramsPerCubicCentimetre = (n: number): number => n * 1000;

/** Bar, the unit every atmospheric pressure is quoted in. */
export const bar = (n: number): number => n * 1e5;

// ── Out of SI, for display only ─────────────────────────────────────────────────────────
//
// Display conversions are separated deliberately. Anything calling `toEarthRadii` is
// producing text for a human, never feeding another calculation.

export const toEarthRadii = (m: Metres): number => m / EARTH_RADIUS;
export const toJupiterRadii = (m: Metres): number => m / JUPITER_RADIUS;
export const toSolarRadii = (m: Metres): number => m / SOLAR_RADIUS;
export const toAstronomicalUnits = (m: Metres): number => m / AU;
export const toParsecs = (m: Metres): number => m / PARSEC;
export const toKilometres = (m: Metres): number => m / 1000;

export const toEarthMasses = (kg: Kilograms): number => kg / EARTH_MASS;
export const toJupiterMasses = (kg: Kilograms): number => kg / JUPITER_MASS;
export const toSolarMasses = (kg: Kilograms): number => kg / SOLAR_MASS;

export const toDays = (s: Seconds): number => s / DAY;
export const toJulianYears = (s: Seconds): number => s / JULIAN_YEAR;

export const toSolarLuminosities = (w: Watts): number => w / SOLAR_LUMINOSITY;

export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;
export const toGramsPerCubicCentimetre = (kgm3: number): number => kgm3 / 1000;
export const toBar = (pa: number): number => pa / 1e5;

/**
 * Catalog unit names as they appear in the NASA Exoplanet Archive, mapped to their SI
 * converters. Ingestion adapters look up by column unit rather than hard-coding, so an
 * upstream unit change is caught by a missing key rather than a silent factor error.
 */
export const CATALOG_UNIT_CONVERTERS = {
  earthRad: earthRadii,
  jupiterRad: jupiterRadii,
  solRad: solarRadii,
  earthMass: earthMasses,
  jupiterMass: jupiterMasses,
  solMass: solarMasses,
  au: astronomicalUnits,
  pc: parsecs,
  days: days,
  hours: hours,
  deg: degrees,
  "g/cm^3": gramsPerCubicCentimetre,
  bar: bar,
} as const satisfies Record<string, (n: number) => number>;

export type CatalogUnit = keyof typeof CATALOG_UNIT_CONVERTERS;

/**
 * Convert a catalog value to SI by its declared unit.
 *
 * Throws on an unrecognised unit rather than passing the number through. A loud failure
 * during ingestion is always cheaper than a silently wrong planet.
 */
export function fromCatalogUnit(value: number, unit: string): number {
  const converter = CATALOG_UNIT_CONVERTERS[unit as CatalogUnit];
  if (!converter) {
    throw new Error(
      `Unrecognised catalog unit "${unit}". Add it to CATALOG_UNIT_CONVERTERS rather than ` +
        `converting inline — an unlisted unit is usually an upstream schema change.`,
    );
  }
  return converter(value);
}
