/**
 * BaseTruthSpec — immutable ingested measurements.
 *
 * Nothing downstream may rewrite these. A user may branch them in a clearly labelled
 * sandbox, which produces a new spec with `sandboxOf` set; it never mutates the original.
 */

import { z } from "zod";
import { ScientificQuantitySchema } from "./quantity.js";

export const DataReferenceSchema = z.object({
  id: z.string().min(1),
  uri: z.string(),
  instrument: z.string().optional(),
  programId: z.string().optional(),
  referenceDoi: z.string().optional(),
});
export type DataReference = z.infer<typeof DataReferenceSchema>;

export const SpectrumReferenceSchema = DataReferenceSchema.extend({
  kind: z.enum(["transmission", "emission", "reflection"]),
  wavelengthRangeUm: z.tuple([z.number(), z.number()]).optional(),
  resolvingPower: z.number().optional(),
});
export type SpectrumReference = z.infer<typeof SpectrumReferenceSchema>;

/**
 * Sky position. The frame and epoch are mandatory, not decorative — a position without
 * them is not a position, and proper motion over a decade is larger than the precision we
 * claim.
 */
export const SkyPositionSchema = z.object({
  rightAscensionRad: ScientificQuantitySchema,
  declinationRad: ScientificQuantitySchema,
  /** Null distance is legal and renders as a direction or an uncertainty interval. */
  distanceM: ScientificQuantitySchema,
  properMotionRaMasPerYr: ScientificQuantitySchema.optional(),
  properMotionDecMasPerYr: ScientificQuantitySchema.optional(),
  radialVelocityMPerS: ScientificQuantitySchema.optional(),
  frame: z.enum(["ICRS", "FK5", "galactic"]),
  epoch: z.string(),
});
export type SkyPosition = z.infer<typeof SkyPositionSchema>;

export const HostStarSchema = z.object({
  massKg: ScientificQuantitySchema,
  radiusM: ScientificQuantitySchema,
  luminosityW: ScientificQuantitySchema,
  effectiveTemperatureK: ScientificQuantitySchema,
  ageS: ScientificQuantitySchema.optional(),
  metallicityDex: ScientificQuantitySchema.optional(),
  /** Element → abundance. Feeds the interior/mineralogy prior. */
  elementalAbundances: z.record(z.string(), ScientificQuantitySchema).optional(),
  position: SkyPositionSchema,
});
export type HostStar = z.infer<typeof HostStarSchema>;

export const PlanetOrbitSchema = z.object({
  orbitalPeriodS: ScientificQuantitySchema,
  semimajorAxisM: ScientificQuantitySchema,
  eccentricity: ScientificQuantitySchema,
  inclinationRad: ScientificQuantitySchema.optional(),
  /**
   * Unknown orientation angles stay unknown. A display convention may be chosen in
   * VisualSpec with confidence zero and a visible label — never silently filled here.
   */
  argumentOfPeriapsisRad: ScientificQuantitySchema.optional(),
  longitudeOfAscendingNodeRad: ScientificQuantitySchema.optional(),
});
export type PlanetOrbit = z.infer<typeof PlanetOrbitSchema>;

export const PlanetBulkSchema = z.object({
  massKg: ScientificQuantitySchema,
  radiusM: ScientificQuantitySchema,
  bondAlbedo: ScientificQuantitySchema.optional(),
});
export type PlanetBulk = z.infer<typeof PlanetBulkSchema>;

export const BaseTruthSpecSchema = z.object({
  objectId: z.string().min(1),
  aliases: z.array(z.string()),
  /** Identifies the exact ingest snapshot. Part of every downstream cache key. */
  dataSnapshotId: z.string().min(1),
  /** Set only on a user sandbox branch; absent on canonical specs. */
  sandboxOf: z.string().optional(),

  host: HostStarSchema,
  planet: PlanetBulkSchema.extend({ orbit: PlanetOrbitSchema }),

  observations: z.object({
    spectra: z.array(SpectrumReferenceSchema),
    lightCurves: z.array(DataReferenceSchema),
    phaseCurves: z.array(DataReferenceSchema),
  }),
});
export type BaseTruthSpec = z.infer<typeof BaseTruthSpecSchema>;

/**
 * Precedence when the same field is available from several places.
 *
 * Lower index wins. Combining values from different references is legal only when the
 * composition is recorded explicitly — see `compositeNote` on the resulting quantity.
 */
export const PRECEDENCE = [
  "published_measurement",
  "self_consistent_catalog_solution",
  "deterministic_derivation",
  "calibrated_retrieval_posterior",
  "population_prior",
  "default_prior",
] as const;

export type PrecedenceLevel = (typeof PRECEDENCE)[number];

export function precedenceRank(level: PrecedenceLevel): number {
  return PRECEDENCE.indexOf(level);
}

/** True when `a` should win over `b`. */
export function outranks(a: PrecedenceLevel, b: PrecedenceLevel): boolean {
  return precedenceRank(a) < precedenceRank(b);
}
