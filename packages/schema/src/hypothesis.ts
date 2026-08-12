/**
 * Surface hypothesis ensemble.
 *
 * Aether publishes several admissible worlds rather than one apparently certain one. The
 * user can cycle through them and watch geography change while every measured quantity
 * stays fixed — which communicates non-uniqueness far more honestly than a single
 * confidence tint ever could.
 */

import { z } from "zod";
import { DistributionSchema } from "./quantity.js";

export const SurfaceClassSchema = z.enum([
  "airless_rocky",
  "volcanic_rocky",
  "temperate_rocky",
  "ocean_world",
  "ice_dominated",
  "lava_world",
  "envelope_dominated",
]);
export type SurfaceClass = z.infer<typeof SurfaceClassSchema>;

export const TectonicRegimeSchema = z.enum([
  "stagnant_lid",
  "mobile_lid",
  "episodic",
  "unknown",
]);
export type TectonicRegime = z.infer<typeof TectonicRegimeSchema>;

/**
 * A compiled terrain program: which named operators run, in what order, with what bounded
 * parameters. The renderer executes only this — it never receives free-form code.
 */
export const TerrainProgramSchema = z.object({
  version: z.string(),
  seed: z.string(),
  operators: z.array(
    z.object({
      /** Must resolve in the terrain operator registry. */
      op: z.string().min(1),
      /** Bounded by the operator's declared parameter ranges; clamped at compile time. */
      params: z.record(z.string(), z.number()),
      /** Why this operator is admissible — the formula id that gated it. */
      gatedBy: z.string(),
    }),
  ),
});
export type TerrainProgram = z.infer<typeof TerrainProgramSchema>;

export const SurfaceHypothesisSchema = z.object({
  id: z.string().min(1),
  /** Relative weight within the ensemble; weights sum to ~1. */
  posteriorWeight: z.number().min(0).max(1),
  classProbabilities: z.record(SurfaceClassSchema, z.number().min(0).max(1)),

  interior: z.object({
    coreMassFraction: DistributionSchema.optional(),
    waterMassFraction: DistributionSchema.optional(),
    envelopeMassFraction: DistributionSchema.optional(),
  }),

  chemistry: z.object({
    /** Always states that analog data constrains the prior, never that it measures anything. */
    sourceRole: z.string(),
    mineralFamilyProbabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),

  geophysics: z.object({
    tectonicRegime: TectonicRegimeSchema,
    tectonicRegimeProbability: z.number().min(0).max(1),
    reliefRmsM: DistributionSchema.optional(),
    craterRetention: DistributionSchema.optional(),
  }),

  terrainProgram: TerrainProgramSchema,

  /** Field paths in ScienceSpec/InferenceSpec that this hypothesis was conditioned on. */
  evidence: z.array(z.string()),
  caveats: z.array(z.string()).min(1),
});
export type SurfaceHypothesis = z.infer<typeof SurfaceHypothesisSchema>;

export const HypothesisEnsembleSchema = z
  .object({
    selectedId: z.string().min(1),
    selectionSeed: z.string(),
    ensemble: z.array(SurfaceHypothesisSchema).min(1),
  })
  .refine((e) => e.ensemble.some((h) => h.id === e.selectedId), {
    message: "selectedId must name a hypothesis present in the ensemble",
  });
export type HypothesisEnsemble = z.infer<typeof HypothesisEnsembleSchema>;

/** The caveat every hypothesis must carry. Absence of this string is a validation failure. */
export const MANDATORY_CAVEAT =
  "No spatially resolved exoplanet surface observation exists. Geography is a procedural " +
  "realization and is not predicted.";

export function hasMandatoryCaveat(h: SurfaceHypothesis): boolean {
  return h.caveats.some((c) => c.includes("procedural realization"));
}

/**
 * Deterministically select an ensemble member from a seed.
 *
 * Weighted by posterior weight so the world a user sees by default is the most probable
 * one, while remaining reproducible for a given seed.
 */
export function selectHypothesis(
  ensemble: readonly SurfaceHypothesis[],
  seedHash: number,
): SurfaceHypothesis {
  const total = ensemble.reduce((s, h) => s + h.posteriorWeight, 0);
  if (total <= 0) {
    const first = ensemble[0];
    if (!first) throw new Error("Cannot select from an empty hypothesis ensemble");
    return first;
  }
  // seedHash is an unsigned 32-bit integer; map it into [0, total).
  let target = (seedHash / 0x1_0000_0000) * total;
  for (const h of ensemble) {
    target -= h.posteriorWeight;
    if (target <= 0) return h;
  }
  const last = ensemble[ensemble.length - 1];
  if (!last) throw new Error("Cannot select from an empty hypothesis ensemble");
  return last;
}
