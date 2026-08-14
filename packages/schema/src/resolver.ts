/**
 * Deterministic missing-value resolver.
 *
 * When a value the renderer needs is absent, this is the only sanctioned way to obtain one.
 * It is a strategy chain, tried strictly in precedence order; the first strategy that can
 * answer, answers. Whatever it returns is labelled with how it was obtained, and a
 * render-only placeholder is marked `affectsPhysics: false` so it can never be mistaken for
 * evidence.
 *
 * ## Every answer is checked before it is returned
 *
 * A request names the unit it wants. The original version of this file accepted that unit
 * and never looked at it, which is worse than not asking — every call site read as though a
 * contract were being enforced while nothing was. A distribution stored in kelvin could
 * satisfy a request for metres, and the only symptom would be a planet the wrong size with
 * a confident provenance record attached.
 *
 * So `guard()` sits between every strategy and its caller. A candidate must clear three
 * things or the chain moves on as though the strategy had declined:
 *
 *   1. the stored unit must be dimensionally compatible with the requested one,
 *   2. the value must be physically admissible for that quantity,
 *   3. it must be finite.
 *
 * Rejections are collected and returned on the `unresolved` result, because "we had a value
 * and threw it away because it was in the wrong unit" is a bug report, and silently
 * returning `unresolved` would hide it.
 *
 * Adding a strategy means adding an entry to `DEFAULT_STRATEGIES` — no other file changes.
 */

import { checkDomain, unitsCompatible } from "./dimension.js";
import type { Distribution, ScientificQuantity } from "./quantity.js";
import type { VisualValue } from "./layers.js";

export interface ResolutionRequest {
  field: string;
  /** The SI unit the caller needs. Enforced, not decorative. */
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
  | { kind: "unresolved"; reason: string; rejections: readonly RejectedCandidate[] };

/** A candidate a strategy produced and the guard refused, with the reason. */
export interface RejectedCandidate {
  strategyId: string;
  reason: string;
}

export interface ResolutionStrategy {
  readonly id: string;
  readonly description: string;
  /** Return `null` to defer to the next strategy. */
  resolve(request: ResolutionRequest): Resolution | null;
}

/**
 * Why a candidate resolution is unusable, or `null` if it is fine.
 *
 * Exported because the guard is the safety property this module exists to provide, and a
 * property that can only be tested through the full chain is a property that will eventually
 * be tested badly.
 */
export function rejectionReason(
  resolution: Resolution,
  request: ResolutionRequest,
): string | null {
  const check = (value: number, unit: string): string | null => {
    if (!unitsCompatible(unit, request.unit)) {
      return (
        `unit "${unit}" cannot answer a request for "${request.unit}" ` +
        `(incompatible dimensions, or an unrecognised unit)`
      );
    }
    const violation = checkDomain(value, unit, request.field);
    return violation ? violation.reason : null;
  };

  switch (resolution.kind) {
    case "measurement":
    case "derivation": {
      const q = resolution.quantity;
      // A null value is a legitimate "genuinely unknown" and must never be dressed up as a
      // number, so it is refused here and the chain falls through to inference.
      if (q.valueSI === null) return "value is null (genuinely unknown)";
      return check(q.valueSI, q.unit);
    }
    case "posterior":
    case "prior":
      return distributionProblem(resolution.distribution, request);
    case "placeholder":
      return check(resolution.visual.value, request.unit);
    case "unresolved":
      return null;
  }
}

/**
 * Why a distribution is unusable, or `null` if it is sound.
 *
 * Shared between the posterior/prior guard and the placeholder strategy. Keeping one
 * implementation is not tidiness: the first version of this file validated distributions in
 * the guard only, so a distribution rejected for inverted quantiles fell through to the
 * placeholder strategy, which re-read the same median and emitted it anyway. The value was
 * refused and then used, which is the exact laundering this module exists to prevent.
 */
export function distributionProblem(
  d: Distribution,
  request: Pick<ResolutionRequest, "field" | "unit">,
): string | null {
  if (!unitsCompatible(d.unit, request.unit)) {
    return (
      `unit "${d.unit}" cannot answer a request for "${request.unit}" ` +
      `(incompatible dimensions, or an unrecognised unit)`
    );
  }

  const violation = checkDomain(d.median, d.unit, request.field);
  if (violation) return violation.reason;

  // An inverted interval means the quantiles were assembled wrongly upstream. It would
  // render as a plausible median with a nonsense envelope, which is the worst case: wrong,
  // and wrong in the direction of looking more certain than it is.
  if (d.p16 > d.p84) {
    return `distribution has p16 (${d.p16}) above p84 (${d.p84})`;
  }

  return null;
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

/**
 * A calibrated retrieval posterior.
 *
 * `oodFlag` is refused here rather than downgraded. A retrieval whose inputs fell outside
 * the model's training domain is not a weaker measurement — it is a model being asked a
 * question it was never fitted to answer, and the calibration that makes a posterior
 * meaningful does not survive extrapolation. It may still be usable as a prior, which is
 * exactly what the next strategy down decides.
 */
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
 *
 * The unit check still applies. A placeholder is render-only, not exempt: drawing a planet
 * whose radius came from a pressure distribution would be visibly wrong on screen, and the
 * `affectsPhysics: false` flag protects the science layer, not the geometry.
 */
export const renderPlaceholder: ResolutionStrategy = {
  id: "render_placeholder",
  description: "Emit a render-only placeholder marked affectsPhysics: false.",
  resolve({ field, inference, unit }) {
    const d = inference[field];
    if (!d) return null;
    // The full check, not just the unit. A distribution the guard already refused must not
    // reappear here wearing a placeholder label.
    if (distributionProblem(d, { field, unit }) !== null) return null;
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
  const rejections: RejectedCandidate[] = [];

  for (const strategy of strategies) {
    const candidate = strategy.resolve(request);
    if (!candidate) continue;

    const reason = rejectionReason(candidate, request);
    if (reason === null) return candidate;

    // Recorded, not swallowed. A value that existed and was refused is a data problem
    // upstream, and it must be visible somewhere or it will never be fixed.
    rejections.push({ strategyId: strategy.id, reason });
  }

  const detail =
    rejections.length > 0
      ? ` Rejected: ${rejections.map((r) => `${r.strategyId} (${r.reason})`).join("; ")}.`
      : "";

  return {
    kind: "unresolved",
    reason:
      `No strategy could resolve "${request.field}" in ${request.unit}. The renderer must ` +
      `show an explicit unknown marker rather than any number.${detail}`,
    rejections,
  };
}
