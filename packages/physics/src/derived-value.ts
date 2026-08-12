/**
 * DerivedValue — what every physics function returns instead of a bare number.
 *
 * The `formulaId` maps to a LaTeX string in the registry, which is how the provenance
 * inspector is built for free: click a rendered feature, walk back through `inputsUsed` to
 * the measurements that produced it, and render the formula that connected them.
 *
 * `assumptions` is not documentation. An equilibrium temperature computed with an assumed
 * Bond albedo of 0.3 is a different claim from one computed with a measured albedo, and
 * the UI has to be able to say so.
 */

export interface Assumption {
  /** The parameter that was assumed rather than measured. */
  parameter: string;
  value: number;
  unit: string;
  rationale: string;
  /** True when the user can change this in the assumption sandbox. */
  userAdjustable: boolean;
}

export interface DerivedValue {
  value: number;
  unit: string;
  /** Propagated symmetric or asymmetric uncertainty, where inputs carried any. */
  uncertainty?: { minus: number; plus: number };
  /** Field paths of the inputs consumed, for the inspector's inference chain. */
  inputsUsed: readonly string[];
  formulaId: string;
  assumptions: readonly Assumption[];
  /**
   * Confidence is the *minimum* over inputs, never an average.
   *
   * A derivation cannot be more certain than its least certain input, and averaging would
   * let one well-measured value launder a badly-constrained one.
   */
  confidence: number;
}

/** Build a DerivedValue, deriving confidence correctly from the inputs. */
export function derived(params: {
  value: number;
  unit: string;
  formulaId: string;
  inputsUsed: readonly string[];
  inputConfidences: readonly number[];
  uncertainty?: { minus: number; plus: number };
  assumptions?: readonly Assumption[];
}): DerivedValue {
  const assumptions = params.assumptions ?? [];
  const confidences = [...params.inputConfidences];

  // An assumed input caps confidence hard. This is what makes a world built on assumptions
  // *look* uncertain rather than merely being uncertain in a tooltip.
  if (assumptions.length > 0) confidences.push(0.5);

  const confidence = confidences.length > 0 ? Math.min(...confidences) : 0;

  return {
    value: params.value,
    unit: params.unit,
    uncertainty: params.uncertainty,
    inputsUsed: params.inputsUsed,
    formulaId: params.formulaId,
    assumptions,
    confidence,
  };
}

/**
 * First-order uncertainty propagation for a product/quotient of powers:
 *   f = A^a · B^b · …  ⇒  (σf/f)² = (a·σA/A)² + (b·σB/B)² + …
 *
 * Adequate for the closed-form derivations here. Anything with correlated inputs or a
 * strongly non-linear response must go through the Monte Carlo path instead — see the
 * acceptance criterion requiring propagation to be validated against a MC reference.
 */
export function propagatePowerLaw(
  value: number,
  terms: readonly { value: number; sigma: number; exponent: number }[],
): { minus: number; plus: number } {
  let sumSq = 0;
  for (const t of terms) {
    if (t.value === 0) continue;
    const rel = (t.exponent * t.sigma) / t.value;
    sumSq += rel * rel;
  }
  const sigma = Math.abs(value) * Math.sqrt(sumSq);
  return { minus: sigma, plus: sigma };
}

/** Mean of asymmetric error bars, for feeding into the propagator above. */
export function symmetrise(u: { minus: number; plus: number } | undefined): number {
  if (!u) return 0;
  return (Math.abs(u.minus) + Math.abs(u.plus)) / 2;
}
