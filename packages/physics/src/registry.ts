/**
 * The formula registry.
 *
 * A building block: adding a physics formula means creating one file in `formulas/` and
 * exporting it from `formulas/index.ts`. Nothing else changes — no switch statement to
 * extend, no dispatch table to keep in sync.
 *
 * Registration is checked: a duplicate id throws at module load rather than silently
 * shadowing, because two formulas answering to one id would make provenance ambiguous.
 */

import type { DerivedValue } from "./derived-value.js";

export interface FormulaDefinition<Inputs> {
  /** Stable id, referenced from every DerivedValue and rendered in the inspector. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** KaTeX source, displayed in the "Why this?" panel. */
  latex: string;
  /** One sentence on what it computes and when it applies. */
  description: string;
  /** Bibcodes or DOIs. Empty only for textbook identities. */
  references: readonly string[];
  /** SI unit of the result. */
  unit: string;
  /**
   * Conditions under which the formula is invalid. Checked before use; a formula applied
   * outside its domain is a bug that should surface loudly, not a slightly wrong number.
   */
  domain?: (inputs: Inputs) => string | null;
  compute: (inputs: Inputs) => DerivedValue;
}

// The registry stores heterogeneous formulas; `unknown` is the honest element type and
// callers recover the concrete type through the exported const, not through the map.
const registry = new Map<string, FormulaDefinition<never>>();

export function defineFormula<Inputs>(
  def: FormulaDefinition<Inputs>,
): FormulaDefinition<Inputs> {
  if (registry.has(def.id)) {
    throw new Error(
      `Formula id "${def.id}" is already registered. Ids appear in provenance records, so ` +
        `they must be unique and stable.`,
    );
  }
  registry.set(def.id, def as FormulaDefinition<never>);
  return def;
}

export function getFormula(id: string): FormulaDefinition<never> | undefined {
  return registry.get(id);
}

export function listFormulas(): readonly FormulaDefinition<never>[] {
  return [...registry.values()];
}

export function formulaIds(): readonly string[] {
  return [...registry.keys()].sort();
}

/**
 * Run a formula with its domain check enforced.
 *
 * Prefer this over calling `compute` directly anywhere the inputs are not already known
 * to be in range.
 */
export function evaluate<Inputs>(def: FormulaDefinition<Inputs>, inputs: Inputs): DerivedValue {
  const violation = def.domain?.(inputs);
  if (violation) {
    throw new DomainError(def.id, violation);
  }
  return def.compute(inputs);
}

export class DomainError extends Error {
  constructor(
    readonly formulaId: string,
    readonly violation: string,
  ) {
    super(`Formula "${formulaId}" applied outside its domain: ${violation}`);
    this.name = "DomainError";
  }
}

/** Version stamp for the whole physics layer, recorded in every EnvironmentSpec. */
export const PHYSICS_VERSION = "0.1.0" as const;
