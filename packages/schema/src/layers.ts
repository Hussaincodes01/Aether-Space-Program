/**
 * The three-layer model.
 *
 * Observational truth, inference and display choices are separated so that a visually
 * useful fallback can never become a measurement by accident. The separation is enforced
 * by types here and by credentials at the service boundary — see `llm-boundary.ts`.
 *
 *   ScienceSpec    written by ingestion + allowlisted physics    affects science: yes
 *   InferenceSpec  written by versioned models + prior resolver  affects science: yes, with uncertainty
 *   VisualSpec     written by composer / LLM / texture pipeline  affects science: NO
 */

import { z } from "zod";
import { BaseTruthSpecSchema } from "./base-truth.js";
import { DistributionSchema, ScientificQuantitySchema } from "./quantity.js";

// ── Layer 1: Science ────────────────────────────────────────────────────────────────────

export const ScienceSpecSchema = z.object({
  base: BaseTruthSpecSchema,
  /**
   * Deterministic derivations only. Every entry names the formula that produced it, and
   * every formula id must resolve in the physics registry.
   */
  derived: z.record(z.string(), ScientificQuantitySchema),
  physicsVersion: z.string(),
  constantsVersion: z.string(),
});
export type ScienceSpec = z.infer<typeof ScienceSpecSchema>;

// ── Layer 2: Inference ──────────────────────────────────────────────────────────────────

export const InferenceSpecSchema = z.object({
  /** Field name → distribution. Never a bare scalar. */
  distributions: z.record(z.string(), DistributionSchema),
  /** Class name → probability. Must sum to ~1. */
  classProbabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
  modelVersions: z.record(z.string(), z.string()),
  /** True when any input fell outside a model's training domain. Forces physics-only. */
  anyOutOfDistribution: z.boolean(),
});
export type InferenceSpec = z.infer<typeof InferenceSpecSchema>;

// ── Layer 3: Visual ─────────────────────────────────────────────────────────────────────

/**
 * A render-only value.
 *
 * `affectsPhysics` is always false by construction. `sourceField` points back at the
 * science or inference field it was derived from, so the inspector can always explain
 * where a placeholder came from.
 */
export const VisualValueSchema = z.object({
  value: z.number(),
  method: z.enum(["visual_placeholder", "visual_convention", "display_scale"]),
  sourceField: z.string().optional(),
  affectsPhysics: z.literal(false),
  /** Shown in the HUD whenever this value is exaggerated for visibility. */
  note: z.string().optional(),
});
export type VisualValue = z.infer<typeof VisualValueSchema>;

export const ScaleModeSchema = z.enum(["scientific", "visibility_enhanced"]);
export type ScaleMode = z.infer<typeof ScaleModeSchema>;

export const VisualScaleSchema = z.object({
  mode: ScaleModeSchema,
  /** Always 1.0 — distances are never exaggerated, in either mode. */
  distanceScale: z.literal(1),
  planetRadiusScale: z.number().positive(),
  atmosphereThicknessScale: z.number().positive(),
  orbitLineMode: z.enum(["true_width", "minimum_screen_pixels"]),
});
export type VisualScale = z.infer<typeof VisualScaleSchema>;

export const SCIENTIFIC_SCALE: VisualScale = {
  mode: "scientific",
  distanceScale: 1,
  planetRadiusScale: 1,
  atmosphereThicknessScale: 1,
  orbitLineMode: "minimum_screen_pixels",
};

export const TextureAssetSchema = z.object({
  assetHash: z.string(),
  uri: z.string(),
  channel: z.enum(["albedo", "normal", "roughness", "emissive"]),
  method: z.enum(["ai_generated_visual", "procedural_fallback"]),
  affectsScience: z.literal(false),
  generator: z
    .object({
      model: z.string(),
      modelVersion: z.string(),
      prompt: z.string(),
      negativeConstraints: z.array(z.string()),
      seed: z.string().optional(),
      constraintMapHashes: z.array(z.string()),
      postprocessVersion: z.string(),
    })
    .optional(),
  hypothesisId: z.string(),
});
export type TextureAsset = z.infer<typeof TextureAssetSchema>;

export const VisualSpecSchema = z.object({
  scale: VisualScaleSchema,
  placeholders: z.record(z.string(), VisualValueSchema),
  textures: z.array(TextureAssetSchema),
  /** Chosen orbital orientation when the true one is unknown. Confidence is always 0. */
  conventions: z.record(z.string(), VisualValueSchema),
});
export type VisualSpec = z.infer<typeof VisualSpecSchema>;

// ── Composite ───────────────────────────────────────────────────────────────────────────

export const PlanetModelSchema = z.object({
  science: ScienceSpecSchema,
  inference: InferenceSpecSchema,
  visual: VisualSpecSchema,
});
export type PlanetModel = z.infer<typeof PlanetModelSchema>;

/**
 * Compile-time marker for which layer a writer is permitted to touch.
 *
 * Services declare their capability and the composer refuses writes that exceed it. This
 * is belt-and-braces alongside the credential separation: a bug in the composer should
 * fail a type check before it reaches a permission check.
 */
export type LayerCapability = "science" | "inference" | "visual";

export interface LayerWriter<C extends LayerCapability> {
  readonly capability: C;
  readonly writerId: string;
}

/** The LLM service is constructed with this and nothing else. */
export type VisualOnlyWriter = LayerWriter<"visual">;
