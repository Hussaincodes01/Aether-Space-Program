/**
 * Catalog units to SI, exactly once.
 *
 * This is the only place in the project where a published number in Earth radii or solar
 * masses becomes a number in metres or kilograms. Everything downstream is SI, so a bug here
 * is a bug everywhere — which is the argument for it being one small table with its own
 * tests rather than a conversion inlined at each call site.
 *
 * Factors come from IAU 2015 Resolution B3 nominal values, via `@aether/units`. Using the
 * nominal constants matters: the IAU nominal solar radius is a *defined* value chosen so
 * that published stellar radii are comparable, and substituting a "better" measured solar
 * radius would silently shift every stellar radius in the catalog.
 */

import {
  AU,
  DAY,
  EARTH_MASS,
  EARTH_RADIUS,
  JULIAN_YEAR,
  JUPITER_MASS,
  JUPITER_RADIUS,
  LIGHT_YEAR,
  PARSEC,
  SOLAR_LUMINOSITY,
  SOLAR_MASS,
  SOLAR_RADIUS,
} from "@aether/units";
import type { ScientificQuantity } from "@aether/schema";
import { UnitMismatchError } from "./errors.js";
import { getSource } from "./sources.js";
import type { CatalogUnit, CatalogValue } from "./schema.js";

/** Multiply a value in this catalog unit by the factor to get SI, and the SI unit tag. */
interface Conversion {
  factor: number;
  si: string;
}

const CONVERSIONS: Readonly<Record<CatalogUnit, Conversion>> = {
  // Length
  m: { factor: 1, si: "m" },
  km: { factor: 1e3, si: "m" },
  R_earth: { factor: EARTH_RADIUS, si: "m" },
  R_jup: { factor: JUPITER_RADIUS, si: "m" },
  R_sun: { factor: SOLAR_RADIUS, si: "m" },
  AU: { factor: AU, si: "m" },
  pc: { factor: PARSEC, si: "m" },
  ly: { factor: LIGHT_YEAR, si: "m" },

  // Mass
  kg: { factor: 1, si: "kg" },
  M_earth: { factor: EARTH_MASS, si: "kg" },
  M_jup: { factor: JUPITER_MASS, si: "kg" },
  M_sun: { factor: SOLAR_MASS, si: "kg" },

  // Time
  s: { factor: 1, si: "s" },
  day: { factor: DAY, si: "s" },
  yr: { factor: JULIAN_YEAR, si: "s" },

  // Temperature. Kelvin only — a catalog in Celsius would need an offset, not a factor,
  // and the right response to encountering one is to convert at the source rather than
  // to complicate this table.
  K: { factor: 1, si: "K" },

  // Pressure
  Pa: { factor: 1, si: "Pa" },
  bar: { factor: 1e5, si: "Pa" },

  // Power
  W: { factor: 1, si: "W" },
  L_sun: { factor: SOLAR_LUMINOSITY, si: "W" },

  // Angle
  deg: { factor: Math.PI / 180, si: "rad" },
  rad: { factor: 1, si: "rad" },

  // Dimensionless
  "1": { factor: 1, si: "1" },
};

export function conversionFor(unit: CatalogUnit): Conversion {
  const conversion = CONVERSIONS[unit];
  if (!conversion) {
    throw new UnitMismatchError("(unit table)", unit, "a known catalog unit");
  }
  return conversion;
}

/** The SI unit a catalog unit converts into. */
export function siUnitFor(unit: CatalogUnit): string {
  return conversionFor(unit).si;
}

export function toSI(value: number, unit: CatalogUnit): number {
  return value * conversionFor(unit).factor;
}

/**
 * Turn one catalog value into a `ScientificQuantity`.
 *
 * Uncertainties are scaled by the same factor as the value, which is correct because every
 * conversion here is a pure multiplication. If an offset unit is ever added, this function
 * has to change with it — hence the comment on kelvin above.
 *
 * `confidence` is not invented. A measured value with a published uncertainty is treated as
 * well constrained; one without is marked lower, because an unstated uncertainty is not the
 * same as a small one.
 */
export function toScientificQuantity(
  value: CatalogValue,
  expectedSiUnit?: string,
): ScientificQuantity {
  const { factor, si } = conversionFor(value.unit);

  if (expectedSiUnit !== undefined && si !== expectedSiUnit) {
    throw new UnitMismatchError("catalog value", value.unit, expectedSiUnit);
  }

  const source = getSource(value.sourceId);

  return {
    valueSI: value.value === null ? null : value.value * factor,
    unit: si,
    uncertainty: value.uncertainty
      ? { minus: value.uncertainty.minus * factor, plus: value.uncertainty.plus * factor }
      : undefined,
    method: value.method,
    sourceId: value.sourceId,
    sourceUrl: source?.url,
    retrievedAt: source?.retrievedAt ?? new Date(0).toISOString(),
    confidence: confidenceFor(value),
  };
}

/**
 * Confidence for a published value.
 *
 * Deliberately coarse. A finer scale would imply a calibration nobody has performed, and
 * the number's job here is to order values by trustworthiness for the resolver and to drive
 * the speculation styling — not to be a probability.
 */
function confidenceFor(value: CatalogValue): number {
  if (value.value === null) return 0;
  if (value.method === "derived") return value.uncertainty ? 0.7 : 0.55;
  return value.uncertainty ? 0.9 : 0.75;
}
