/**
 * Deterministic missing-value resolver.
 *
 * When a value the renderer needs is absent, this is the only sanctioned way to obtain
 * one. It is a strategy chain, tried strictly in precedence order; the first strategy that
 * can answer, answers. Whatever it returns is labelled with how it was obtained, and a
 * render-only placeholder is marked `affectsPhysics: false` so it can never be mistaken
 * for evidence.
 *
 * Adding a strategy means adding an entry to `DEFAULT_STRATEGIES` — no other file changes.
 */

import type { Distribution, ScientificQuantity } from "./quantity.js";
import type { VisualValue } from "./layers.js";

export interface ResolutionRequest {
  field: string;
  unit: string;
  /** Everything already known about this planet, for strategies that derive or condition. */
  science: Readonly<Record<string, ScientificQuantity>>;
  inference: Readonly<Record<string, Distribution>>;
  /** Stable seed for any strategy that draws a sample. */
  seed: string;
}

export type Resolution =
  | { kind: "measurement"; quantity: ScientificQuantity }
  | { kind: "derivation"; quantity: ScientificQuantity }
  | { kind: "posterior"; distribution: Distribution }
  | { kind: "prior"; distribution: Distribution }
  | { kind: "placeholder"; visual: VisualValue }
  | { kind: "unresolved"; reason: string };

export interface ResolutionStrategy {
  readonly id: string;
  readonly description: string;
  /** Return `null` to defer to the next strategy. */
  resolve(request: ResolutionRequest): Resolution | null;
}

/** A compatible published measurement already present in the science layer. */
export const publishedMeasurement: ResolutionStrategy = {
  id: "published_measurement",
  description: "Use a measured value already present in ScienceSpec.",
  resolve({ field, science }) {
    const q = science[field];
    if (q && q.valueSI !== null && q.method === "measured") {
      return { kind: "measurement", quantity: q };
    }
    return null;
  },
};

/** A deterministic derivation the physics layer has already computed. */
export const deterministicDerivation: ResolutionStrategy = {
  id: "deterministic_derivation",
  description: "Use a value derived from measurements by an allowlisted formula.",
  resolve({ field, science }) {
    const q = science[field];
    if (q && q.valueSI !== null && q.method === "derived") {
      return { kind: "derivation", quantity: q };
    }
    return null;
  },
};

/** A calibrated retrieval posterior. */
export const retrievalPosterior: ResolutionStrategy = {
  id: "calibrated_retrieval_posterior",
  description: "Use a calibrated posterior from a retrieval model, if not out-of-distribution.",
  resolve({ field, inference }) {
    const d = inference[field];
    if (d && d.method === "retrieved" && d.oodFlag !== true) {
      return { kind: "posterior", distribution: d };
    }
    return null;
  },
};

/** A cited conditional population prior. */
export const populationPrior: ResolutionStrategy = {
  id: "population_prior",
  description: "Use a cited conditional population prior with full uncertainty.",
  resolve({ field, inference }) {
    const d = inference[field];
    if (d && (d.method === "prior" || d.method === "sampled_prior" || d.method === "imputed")) {
      return { kind: "prior", distribution: d };
    }
    return null;
  },
};

/**
 * Last resort: a render-only placeholder.
 *
 * Reached only when nothing above could answer. The renderer draws *something* so the user
 * is not staring at a broken scene, but the value is flagged, badged in the UI, and cannot
 * enter any calculation.
 */
export const renderPlaceholder: ResolutionStrategy = {
  id: "render_placeholder",
  description: "Emit a render-only placeholder marked affectsPhysics: false.",
  resolve({ field, inference }) {
    const d = inference[field];
    if (!d) return null;
    return {
      kind: "placeholder",
      visual: {
        value: d.median,
        method: "visual_placeholder",
        sourceField: `inference.${field}`,
        affectsPhysics: false,
        note: `Placeholder drawn from the ${d.method} distribution; not a measurement.`,
      },
    };
  },
};

/** Precedence order. Do not reorder without updating the PRD — this *is* the precedence rule. */
export const DEFAULT_STRATEGIES: readonly ResolutionStrategy[] = [
  publishedMeasurement,
  deterministicDerivation,
  retrievalPosterior,
  populationPrior,
  renderPlaceholder,
];

export function resolveMissingValue(
  request: ResolutionRequest,
  strategies: readonly ResolutionStrategy[] = DEFAULT_STRATEGIES,
): Resolution {
  for (const strategy of strategies) {
    const result = strategy.resolve(request);
    if (result) return result;
  }
  return {
    kind: "unresolved",
    reason:
      `No strategy could resolve "${request.field}". The renderer must show an explicit ` +
      `unknown marker rather than any number.`,
  };
}
