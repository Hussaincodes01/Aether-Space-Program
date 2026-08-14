/**
 * The evidence badge vocabulary.
 *
 * Six words that carry the product's entire honesty claim. Every number and every visible
 * feature in the UI wears exactly one of them, and the distinctions are not stylistic:
 *
 *   MEASURED     Somebody observed this. It has a paper.
 *   DERIVED      A named formula computed it from measurements. Deterministic, no free
 *                parameters beyond stated assumptions.
 *   INFERRED     A model produced a distribution. Real uncertainty, calibrated where the
 *                model was calibrated.
 *   HYPOTHESIS   One admissible realisation among many. Terrain lives here. It is
 *                consistent with the physics; it is not a prediction.
 *   PLACEHOLDER  Drawn so the scene is not broken. Cannot affect any calculation.
 *   UNKNOWN      Nobody knows, including us. The most important badge in the set, because
 *                the temptation is always to show something instead.
 *
 * Kept in its own module with no DOM dependency so the classification logic can be tested
 * directly. A rule this load-bearing should not only be reachable through a rendered panel.
 */

import type { PlanetModel } from "@aether/catalog";

export type Badge =
  "MEASURED" | "DERIVED" | "INFERRED" | "HYPOTHESIS" | "PLACEHOLDER" | "UNKNOWN";

export const BADGE_ORDER: readonly Badge[] = [
  "MEASURED",
  "DERIVED",
  "INFERRED",
  "HYPOTHESIS",
  "PLACEHOLDER",
  "UNKNOWN",
];

/** One sentence per badge, shown on hover and in the inspector legend. */
export const BADGE_DESCRIPTION: Readonly<Record<Badge, string>> = {
  MEASURED: "Observed and published. Traceable to a specific paper or archive row.",
  DERIVED: "Computed from measurements by a named formula, with its assumptions listed.",
  INFERRED: "A model's distribution, not a point value. The interval is the honest part.",
  HYPOTHESIS:
    "One physically admissible possibility among many. Consistent with the data; not a prediction of the real surface.",
  PLACEHOLDER: "Shown so the scene renders. Marked as unable to affect any calculation.",
  UNKNOWN: "No measurement, no derivation, no model. Nobody knows this yet.",
};

/** CSS class per badge. Kept here so the colour and the word cannot drift apart. */
export const BADGE_CLASS: Readonly<Record<Badge, string>> = {
  MEASURED: "badge-measured",
  DERIVED: "badge-derived",
  INFERRED: "badge-inferred",
  HYPOTHESIS: "badge-hypothesis",
  PLACEHOLDER: "badge-placeholder",
  UNKNOWN: "badge-unknown",
};

export interface FieldEvidence {
  field: string;
  badge: Badge;
  /** SI value, or null when unknown. */
  valueSI: number | null;
  unit: string;
  /** 0..1 where the layer supplies one. */
  confidence: number | null;
  /** Symmetric or asymmetric uncertainty, where any exists. */
  uncertainty?: { minus: number; plus: number };
  /** Distribution quantiles, for INFERRED fields. */
  interval?: { p16: number; p84: number };
  /** Paper, archive, formula id or model id. */
  source: string;
  sourceUrl?: string;
  /** Formula or model detail, where there is one. */
  detail?: string;
  /** Assumptions the value rests on. Empty for a pure measurement. */
  assumptions: readonly string[];
  /** Why this is unknown or withheld, where applicable. */
  note?: string;
}

/**
 * Classify every field of a planet model into badges.
 *
 * Precedence matters and matches the resolver's: a measurement beats a derivation beats a
 * distribution beats nothing. A field that appears in more than one layer is reported at
 * its strongest, because that is the claim actually being made on screen.
 *
 * Withheld fields are reported as UNKNOWN with the reason, not omitted. A user who has
 * deselected Gaia should see *why* the radius went away — that is the whole point of being
 * allowed to deselect it.
 */
export function classifyFields(model: PlanetModel): readonly FieldEvidence[] {
  const out: FieldEvidence[] = [];
  const seen = new Set<string>();

  for (const [field, q] of Object.entries(model.science)) {
    seen.add(field);
    out.push({
      field,
      badge: q.method === "derived" ? "DERIVED" : "MEASURED",
      valueSI: q.valueSI,
      unit: q.unit,
      confidence: q.confidence ?? null,
      uncertainty: q.uncertainty,
      source: q.sourceId,
      sourceUrl: q.sourceUrl,
      assumptions: [],
    });
  }

  for (const [field, entry] of Object.entries(model.derived)) {
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      badge: "DERIVED",
      valueSI: entry.derivation.value,
      unit: entry.derivation.unit,
      confidence: entry.derivation.confidence,
      uncertainty: entry.derivation.uncertainty,
      source: entry.derivation.formulaId,
      detail: entry.derivation.inputsUsed.join(", "),
      assumptions: entry.derivation.assumptions.map(
        (a) => `${a.parameter} = ${a.value} ${a.unit} — ${a.rationale}`,
      ),
    });
  }

  for (const [field, d] of Object.entries(model.inference)) {
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      badge: "INFERRED",
      valueSI: d.median,
      unit: d.unit,
      confidence: null,
      interval: { p16: d.p16, p84: d.p84 },
      source: d.modelId,
      assumptions: d.oodFlag
        ? ["Inputs fall outside the model's fitted domain; treat as indicative only."]
        : [],
    });
  }

  for (const field of model.withheld) {
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      badge: "UNKNOWN",
      valueSI: null,
      unit: "",
      confidence: null,
      source: "withheld-by-evidence-profile",
      assumptions: [],
      note:
        "A published value exists, but no mission in the current selection could have " +
        "obtained it. Add the mission that measures it to reveal the value.",
    });
  }

  for (const [field, reason] of Object.entries(model.unknown)) {
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      badge: "UNKNOWN",
      valueSI: null,
      unit: "",
      confidence: null,
      source: "unmeasured",
      assumptions: [],
      note: reason,
    });
  }

  // Stable order: strongest evidence first, then alphabetically inside each band. The user
  // should see what is actually known before what is guessed.
  return out.sort((a, b) => {
    const byBadge = BADGE_ORDER.indexOf(a.badge) - BADGE_ORDER.indexOf(b.badge);
    return byBadge !== 0 ? byBadge : a.field.localeCompare(b.field);
  });
}

/** How many fields carry each badge. Drives the inspector's summary line. */
export function badgeCounts(fields: readonly FieldEvidence[]): Record<Badge, number> {
  const counts = Object.fromEntries(BADGE_ORDER.map((b) => [b, 0])) as Record<Badge, number>;
  for (const field of fields) counts[field.badge] += 1;
  return counts;
}

/**
 * Human-readable field names.
 *
 * Falls back to de-snake-casing an unrecognised field rather than showing a raw identifier,
 * so adding a formula does not require touching this table to keep the UI legible.
 */
const LABELS: Readonly<Record<string, string>> = {
  planet_radius: "Planet radius",
  planet_mass: "Planet mass",
  orbital_period: "Orbital period",
  semi_major_axis: "Semi-major axis",
  eccentricity: "Eccentricity",
  bond_albedo: "Bond albedo",
  stellar_radius: "Stellar radius",
  stellar_mass: "Stellar mass",
  stellar_effective_temperature: "Stellar temperature",
  stellar_distance: "Distance",
  bulk_density: "Bulk density",
  surface_gravity: "Surface gravity",
  escape_velocity: "Escape velocity",
  insolation: "Insolation",
  equilibrium_temperature: "Equilibrium temperature",
  scale_height: "Atmospheric scale height",
  surface_pressure: "Surface pressure",
};

export function fieldLabel(field: string): string {
  const known = LABELS[field];
  if (known) return known;
  const spaced = field.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
