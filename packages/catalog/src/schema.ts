/**
 * Catalog seed schemas.
 *
 * Seed data is written in *catalog units* — Earth radii, solar masses, days — because that
 * is how the literature reports it, and retyping published numbers into SI by hand is how
 * transcription errors get in. Conversion happens once, in `convert.ts`, under test.
 *
 * Three rules are enforced here rather than by convention:
 *
 *   1. **Every value names its unit.** There are no bare numbers in seed data.
 *   2. **Every value names its source.** `sourceId` must resolve in the source registry, so
 *      a value can always be traced to a paper or an archive row.
 *   3. **Unknown is spelled out.** A quantity nobody has measured is written with
 *      `value: null`, never omitted and never filled with a population median. Omission and
 *      "we know this is unknown" are different facts, and only the second one is honest.
 */

import { z } from "zod";

/** Units seed data may be written in. Closed set; conversion is defined for each. */
export const CatalogUnitSchema = z.enum([
  // Length
  "m",
  "km",
  "R_earth",
  "R_jup",
  "R_sun",
  "AU",
  "pc",
  "ly",
  // Mass
  "kg",
  "M_earth",
  "M_jup",
  "M_sun",
  // Time
  "s",
  "day",
  "yr",
  // Temperature
  "K",
  // Pressure
  "Pa",
  "bar",
  // Luminosity
  "W",
  "L_sun",
  // Angle
  "deg",
  "rad",
  // Dimensionless
  "1",
]);
export type CatalogUnit = z.infer<typeof CatalogUnitSchema>;

export const CatalogUncertaintySchema = z.object({
  minus: z.number().nonnegative(),
  plus: z.number().nonnegative(),
});

/**
 * One published quantity.
 *
 * `value: null` means measured-to-be-unknown. It survives ingestion, survives the science
 * layer, and is what triggers the inference resolver downstream.
 */
export const CatalogValueSchema = z.object({
  value: z.number().nullable(),
  unit: CatalogUnitSchema,
  uncertainty: CatalogUncertaintySchema.optional(),
  /** Must resolve in the source registry; an unresolvable id fails ingestion. */
  sourceId: z.string().min(1),
  /**
   * How this number was obtained *by the people who published it*.
   *
   * "derived" here means the source derived it (a mass from an RV semi-amplitude, say), not
   * that Aether derived it. Aether's own derivations are produced downstream and labelled
   * separately, so the two can never be confused in the inspector.
   */
  method: z.enum(["measured", "derived"]).default("measured"),
  /** Free text shown in the inspector, e.g. "TTV mass, model-dependent". */
  note: z.string().optional(),
});
export type CatalogValue = z.infer<typeof CatalogValueSchema>;

export const SourceSchema = z.object({
  id: z.string().min(1),
  /** Human-readable citation. */
  citation: z.string().min(1),
  url: z.string().url().optional(),
  bibcode: z.string().optional(),
  /** ISO 8601. When this value was taken from the source. */
  retrievedAt: z.string().datetime(),
});
export type Source = z.infer<typeof SourceSchema>;

export const StarSeedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Spectral type as published, e.g. "M8V". Display only; nothing derives from it. */
  spectralType: z.string().optional(),

  distance: CatalogValueSchema,
  effectiveTemperature: CatalogValueSchema,
  radius: CatalogValueSchema,
  mass: CatalogValueSchema,
  /** Optional: derived from radius and Teff when absent. */
  luminosity: CatalogValueSchema.optional(),
  metallicity: CatalogValueSchema.optional(),
});
export type StarSeed = z.infer<typeof StarSeedSchema>;

export const PlanetSeedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),

  radius: CatalogValueSchema,
  mass: CatalogValueSchema,
  orbitalPeriod: CatalogValueSchema,
  semiMajorAxis: CatalogValueSchema,
  eccentricity: CatalogValueSchema,
  inclination: CatalogValueSchema.optional(),

  /**
   * Bond albedo, almost always unknown.
   *
   * Present in the schema precisely so it can be written as `value: null` for nearly every
   * planet. Equilibrium temperature depends on it strongly, and the pipeline must be able
   * to say "assumed 0.3" rather than quietly using 0.3 as though it were known.
   */
  bondAlbedo: CatalogValueSchema.optional(),

  /** Measured surface or 1-bar pressure. Essentially never available for an exoplanet. */
  surfacePressure: CatalogValueSchema.optional(),

  /** Free text describing what is actually known about the atmosphere. */
  atmosphereNote: z.string().optional(),
});
export type PlanetSeed = z.infer<typeof PlanetSeedSchema>;

export const SystemSeedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  star: StarSeedSchema,
  planets: z.array(PlanetSeedSchema).min(1),
  /** One line for the UI. */
  blurb: z.string().min(1),
  /**
   * Missions whose data actually contributed to this system's entry.
   *
   * Used to bound what the evidence model may claim: selecting JWST does not conjure a JWST
   * spectrum for a planet JWST has never observed.
   */
  observedBy: z.array(z.string()).default([]),
});
export type SystemSeed = z.infer<typeof SystemSeedSchema>;
