/**
 * EnvironmentSpec — the single interface between science and rendering.
 *
 * Everything upstream exists to produce this document; everything downstream consumes only
 * this document. That decoupling is why the renderer has been changed twice without the
 * science layer needing rework, and it is the line to hold when it is changed again.
 */

import { z } from "zod";
import { HypothesisEnsembleSchema } from "./hypothesis.js";
import { InferenceSpecSchema, ScienceSpecSchema, VisualSpecSchema } from "./layers.js";

export const ENVSPEC_VERSION = "2.1.0" as const;

/**
 * Versions of everything that shaped this spec.
 *
 * `opacities` is not optional decoration: the MALBEC intercomparison found optical/UV
 * disagreement between radiative-transfer codes large enough to matter, driven largely by
 * linelist choice. "Retrieved with petitRADTRANS 3.3.3, H2O__ExoMol, CO__HITEMP" is a
 * provenance claim; "retrieved with ML" is not.
 */
export const ModelVersionsSchema = z.object({
  physics: z.string(),
  constants: z.string(),
  terrain: z.string(),
  opacities: z.string().optional(),
  retrieval: z.string().optional(),
  classifier: z.string().optional(),
  imputer: z.string().optional(),
  composer: z.string().optional(),
  textureGenerator: z.string().optional(),
});
export type ModelVersions = z.infer<typeof ModelVersionsSchema>;

export const EnvironmentSpecSchema = z.object({
  envspecVersion: z.literal(ENVSPEC_VERSION),
  planetId: z.string().min(1),

  dataSnapshotId: z.string().min(1),
  modelVersions: ModelVersionsSchema,
  /** Present from v1.1; part of the cache key so gameplay re-composition stays deterministic. */
  observationState: z.string().optional(),
  seed: z.string(),

  science: ScienceSpecSchema,
  inference: InferenceSpecSchema,
  visual: VisualSpecSchema,
  surfaceHypotheses: HypothesisEnsembleSchema,

  caveats: z.array(z.string()),
  references: z.array(z.string()),

  /** SHA-256 over the canonical JSON, so an exported spec can be verified. */
  checksum: z.string().optional(),
});
export type EnvironmentSpec = z.infer<typeof EnvironmentSpecSchema>;

/**
 * Canonical JSON: sorted keys, no insignificant whitespace.
 *
 * Two runs with the same inputs must produce byte-identical output here — this is the part
 * of determinism that *is* promised absolutely, and the golden-file tests assert it.
 */
export function canonicalJson(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canon);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = canon((v as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(canon(value));
}

/** Every export and screenshot carries this. Burned in at the framebuffer, not the DOM. */
export const WATERMARK_TEXT =
  "Data-grounded artistic reconstruction. Geography is procedurally generated and is not an observation.";
