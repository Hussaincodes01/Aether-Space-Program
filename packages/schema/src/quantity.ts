/**
 * ScientificQuantity — the atom of the whole system.
 *
 * No bare scalar exists anywhere in Aether. Every number carries its unit, its uncertainty,
 * how it was obtained, and where it came from. This is what makes the provenance inspector
 * possible, and it is the single rule that must never be relaxed for convenience.
 */

import { z } from "zod";

/**
 * How a value was obtained. These four are the *scientific* methods — they may appear in
 * ScienceSpec or InferenceSpec. Display-level evidence classes are broader (see
 * `EvidenceClass`) because they also cover things that never touch the science layers.
 */
export const MethodSchema = z.enum([
  /** Direct catalog or spectral measurement. */
  "measured",
  /** Deterministic equation applied to measured inputs. */
  "derived",
  /** Posterior distribution inferred from a spectrum. */
  "retrieved",
  /** Statistical or geophysical range consistent with the evidence. */
  "prior",
]);
export type Method = z.infer<typeof MethodSchema>;

/**
 * The full set of labels a rendered feature can carry. Extends `Method` with the two
 * classes that exist only downstream of inference.
 */
export const EvidenceClassSchema = z.enum([
  "measured",
  "derived",
  "retrieved",
  "constrained_prior",
  /** One deterministic terrain instantiation sampled from a constrained prior. */
  "procedural_realization",
  /** Purely visual detail that cannot affect scientific interpretation. */
  "decorative",
]);
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

export const UncertaintySchema = z.object({
  minus: z.number(),
  plus: z.number(),
  /** e.g. "normal", "lognormal", "uniform". Absent means unstated, not symmetric-normal. */
  distribution: z.string().optional(),
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const ScientificQuantitySchema = z.object({
  /**
   * The value in SI base units, or null when genuinely unknown.
   *
   * `null` is a first-class state and must survive all the way to the UI. It must never be
   * quietly replaced by a population default — that is what InferenceSpec is for.
   */
  valueSI: z.number().nullable(),
  unit: z.string(),
  uncertainty: UncertaintySchema.optional(),
  method: MethodSchema,
  /** Must resolve in the ingested source registry. An unresolvable id is rejected. */
  sourceId: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  retrievedAt: z.string().datetime(),
  /** Calibrated where possible; 0..1. */
  confidence: z.number().min(0).max(1).optional(),
});
export type ScientificQuantity = z.infer<typeof ScientificQuantitySchema>;

/** A quantity whose value is genuinely unknown, with the reason recorded. */
export function unknownQuantity(unit: string, reason: string): ScientificQuantity {
  return {
    valueSI: null,
    unit,
    method: "prior",
    sourceId: `unknown:${reason}`,
    retrievedAt: new Date(0).toISOString(),
    confidence: 0,
  };
}

export function isKnown(q: ScientificQuantity | undefined): q is ScientificQuantity {
  return q !== undefined && q.valueSI !== null;
}

/**
 * A posterior or prior distribution, kept as quantiles rather than collapsed to a scalar.
 *
 * Collapsing a distribution to `median + generic confidence` throws away exactly the
 * information the product exists to communicate, so the pipeline carries quantiles as far
 * as it can and only reduces at the render boundary.
 */
export const DistributionSchema = z.object({
  median: z.number(),
  p16: z.number(),
  p84: z.number(),
  p02_5: z.number().optional(),
  p97_5: z.number().optional(),
  unit: z.string(),
  method: z.enum(["retrieved", "prior", "sampled_prior", "imputed"]),
  /** Must resolve in the model/prior registry. */
  modelId: z.string().min(1),
  /** Seed used if a single realization was drawn from this distribution. */
  seed: z.string().optional(),
  /** Set when the input fell outside the model's training domain. */
  oodFlag: z.boolean().optional(),
});
export type Distribution = z.infer<typeof DistributionSchema>;
