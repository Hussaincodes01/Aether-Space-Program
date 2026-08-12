/**
 * The LLM containment boundary.
 *
 * The safety property is implemented in schemas, permissions and code — never in a system
 * prompt. A prompt is a request; this file is the enforcement.
 *
 *   LLM response
 *     -> VisualProposal (strict schema, unknown keys rejected)
 *     -> forbidden-field scan (defence in depth, catches nesting)
 *     -> source registry check (a citation that does not resolve is not a citation)
 *     -> deterministic missing-value resolver
 *     -> EnvironmentSpec composer
 *
 * The LLM schema *structurally omits* mass, radius, distance, orbital period and
 * atmospheric abundance. There is no field for the model to put them in. The scan below
 * exists because a strict schema alone does not stop a value being smuggled inside a
 * nested free-form object, and because we want the violation recorded rather than merely
 * dropped.
 */

import { z } from "zod";

// ── What the LLM is allowed to say ──────────────────────────────────────────────────────

export const PaletteIntentSchema = z
  .object({
    /** Must name a mineral family present in the analog library. */
    dominantMineralFamily: z.string().min(1),
    secondaryMineralFamily: z.string().min(1).optional(),
    /** 0..1 within the range the hypothesis permits; clamped by the validator regardless. */
    weatheringIntensity: z.number().min(0).max(1),
    iceCoverageHint: z.number().min(0).max(1).optional(),
  })
  .strict();
export type PaletteIntent = z.infer<typeof PaletteIntentSchema>;

export const TextureIntentSchema = z
  .object({
    /** Art direction for the generative texture model. Never executable code. */
    prompt: z.string().min(1).max(2000),
    negativeConstraints: z.array(z.string().max(200)).max(32),
    microdetailScale: z.enum(["fine", "medium", "coarse"]),
  })
  .strict();
export type TextureIntent = z.infer<typeof TextureIntentSchema>;

export const CameraSuggestionSchema = z
  .object({
    framing: z.enum(["terminator", "substellar", "polar", "limb", "orbit_wide"]),
    altitudeHint: z.enum(["surface", "low_orbit", "high_orbit", "system"]),
  })
  .strict();
export type CameraSuggestion = z.infer<typeof CameraSuggestionSchema>;

/**
 * The complete surface of what an LLM may propose.
 *
 * Note what is absent: every canonical physical quantity. Adding one here is the single
 * change that would break containment, which is why `llm-boundary.test.ts` asserts the
 * key set directly.
 */
export const VisualProposalSchema = z
  .object({
    /** Must reference a hypothesis the inference layer already produced. */
    hypothesisId: z.string().min(1),
    palette: PaletteIntentSchema.optional(),
    texture: TextureIntentSchema.optional(),
    camera: CameraSuggestionSchema.optional(),
    /**
     * Plain-language explanation, displayed as model-written and never parsed into values.
     * Scanned for numeric claims so we can flag a narrative that sounds like a measurement.
     */
    narrative: z.string().max(4000).optional(),
    /** Source ids the model wishes to cite. Each must already exist in the registry. */
    citedSourceIds: z.array(z.string()).max(32).optional(),
  })
  .strict();
export type VisualProposal = z.infer<typeof VisualProposalSchema>;

// ── Forbidden fields, for defence in depth ──────────────────────────────────────────────

/**
 * Key patterns that must never appear anywhere in an LLM payload.
 *
 * The strict schema already rejects unknown top-level keys; this catches a value nested
 * inside an allowed string field's JSON, a future schema relaxation, or a proposal routed
 * from somewhere unexpected.
 */
export const FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [
  /\bmass\b/i,
  /\bradius\b/i,
  /\bradii\b/i,
  /\bdistance\b/i,
  /\bparallax\b/i,
  /\bperiod\b/i,
  /semimajor/i,
  /eccentricit/i,
  /inclination/i,
  /luminosit/i,
  /\bteff\b/i,
  // Keys are normalised to space-separated tokens before matching (see `normaliseKey`),
  // so multi-word patterns accept a space or an underscore rather than assuming either.
  /effective[\s_]?temperature/i,
  /abundance/i,
  /\bvmr\b/i,
  /mixing[\s_]?ratio/i,
  /metallicit/i,
  /\bgravity\b/i,
  /surface[\s_]?pressure/i,
  /\bdensity\b/i,
];

export interface ProvenanceViolation {
  kind:
    | "forbidden_field"
    | "unknown_key"
    | "unresolved_source"
    | "unknown_hypothesis"
    | "numeric_claim_in_narrative";
  path: string;
  detail: string;
}

/**
 * Normalise a key so word-boundary patterns actually fire.
 *
 * JavaScript treats `_` as a word character, so `/\bradius\b/` does **not** match
 * `planet_radius` — the exact naming style a model is most likely to emit. Splitting
 * snake_case, kebab-case and camelCase into space-separated tokens first is what makes the
 * boundary assertions mean what they look like they mean.
 */
export function normaliseKey(key: string): string {
  return key
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

/** Deep-walk an arbitrary payload looking for keys that must never be present. */
export function scanForForbiddenFields(payload: unknown, path = "$"): ProvenanceViolation[] {
  const violations: ProvenanceViolation[] = [];

  const walk = (node: unknown, at: string): void => {
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${at}[${i}]`));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const here = `${at}.${key}`;
      const normalised = normaliseKey(key);
      const matched = FORBIDDEN_FIELD_PATTERNS.find((p) => p.test(normalised));
      if (matched) {
        violations.push({
          kind: "forbidden_field",
          path: here,
          detail:
            `Key "${key}" matches ${matched} — canonical physical quantities may only be ` +
            `written by ingestion or the inference resolver.`,
        });
      }
      walk(value, here);
    }
  };

  walk(payload, path);
  return violations;
}

/**
 * Flag narrative text that reads like a measurement.
 *
 * This does not block the proposal — narrative cannot contaminate the science layers. It
 * surfaces the case where a model writes "the planet is 1.6 Earth radii" in prose that a
 * user might screenshot as fact, which is a real misinformation risk even though it is not
 * a data-integrity one.
 */
const NUMERIC_CLAIM = /\b\d+(?:\.\d+)?\s*(?:earth|jupiter|solar)?\s*(?:radii|masses|bar|K|kelvin|g\/cm|AU|pc|parsec)/i;

export function scanNarrativeForNumericClaims(narrative: string | undefined): ProvenanceViolation[] {
  if (!narrative) return [];
  const match = NUMERIC_CLAIM.exec(narrative);
  if (!match) return [];
  return [
    {
      kind: "numeric_claim_in_narrative",
      path: "$.narrative",
      detail:
        `Narrative contains what reads as a quantitative claim ("${match[0].trim()}"). ` +
        `Narrative is displayed as model-written and is not authoritative; consider ` +
        `routing the number through the provenance inspector instead.`,
    },
  ];
}

// ── The validator ───────────────────────────────────────────────────────────────────────

export interface ValidationContext {
  /** Source ids that exist in the ingested registry. A citation outside this set is invalid. */
  knownSourceIds: ReadonlySet<string>;
  /** Hypothesis ids the inference layer produced for this planet. */
  knownHypothesisIds: ReadonlySet<string>;
}

export type ValidationResult =
  | { ok: true; proposal: VisualProposal; warnings: ProvenanceViolation[] }
  | { ok: false; violations: ProvenanceViolation[] };

/**
 * Validate an LLM payload.
 *
 * Rejection is not a failure state for the product: per the PRD, the renderer continues
 * with the deterministic fallback and a visible badge. What must never happen is a
 * forbidden value reaching ScienceSpec, and that is what this function guarantees.
 */
export function validateVisualProposal(
  raw: unknown,
  context: ValidationContext,
): ValidationResult {
  const violations: ProvenanceViolation[] = [];

  // 1. Forbidden fields first, so we record *what* was attempted even when the strict
  //    schema would have rejected the payload for a different reason.
  violations.push(...scanForForbiddenFields(raw));

  // 2. Strict schema. Unknown keys are errors, not extras.
  const parsed = VisualProposalSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push({
        kind: issue.code === "unrecognized_keys" ? "unknown_key" : "forbidden_field",
        path: `$.${issue.path.join(".")}`,
        detail: issue.message,
      });
    }
    return { ok: false, violations };
  }

  const proposal = parsed.data;

  // 3. A citation that does not resolve is not a citation. Hallucinated bibliography text
  //    establishes no provenance whatsoever.
  for (const sourceId of proposal.citedSourceIds ?? []) {
    if (!context.knownSourceIds.has(sourceId)) {
      violations.push({
        kind: "unresolved_source",
        path: "$.citedSourceIds",
        detail:
          `Source id "${sourceId}" is not in the ingested source registry. Only sources ` +
          `Aether has actually ingested can be cited.`,
      });
    }
  }

  // 4. The proposal must attach to a hypothesis that really exists.
  if (!context.knownHypothesisIds.has(proposal.hypothesisId)) {
    violations.push({
      kind: "unknown_hypothesis",
      path: "$.hypothesisId",
      detail: `Hypothesis "${proposal.hypothesisId}" was not produced by the inference layer.`,
    });
  }

  if (violations.length > 0) return { ok: false, violations };

  // Warnings do not block; they are recorded for observability and shown to reviewers.
  return {
    ok: true,
    proposal,
    warnings: scanNarrativeForNumericClaims(proposal.narrative),
  };
}
