/**
 * Terrain program compilation.
 *
 * Takes the physical facts about a world plus a set of proposed parameters — from the AI
 * composer, or from the deterministic fallback — and produces a bounded, ordered program
 * the renderer can execute.
 *
 * The compiler is where the guarantee lives. A proposal cannot enable an inadmissible
 * operator, and it cannot push a parameter outside the range physics allows: both are
 * silently corrected and loudly recorded. That is the difference between a prompt asking
 * a model to behave and a system that does not care whether it does.
 *
 * ## One entry point, and it always validates
 *
 * Proposal validation used to live in a separate exported `validateProposal()`. That made
 * the guarantee opt-in: every caller had to remember to call it, and a caller that forgot
 * got a program compiled from a proposal naming operators that do not exist, with no
 * indication anything had been ignored. A safety check you can skip is a safety check that
 * will be skipped.
 *
 * So validation is now part of `compileTerrainProgram()` and cannot be bypassed. Unknown
 * operators, unknown parameters and proposals aimed at inadmissible operators are all
 * recorded in `warnings`. In `strict` mode they throw `TerrainProposalError` instead --
 * appropriate for ingestion and tests, where a malformed proposal is a bug rather than a
 * model being imprecise.
 */

import { getOperator, listOperators } from "./registry.js";
import { TERRAIN_VERSION } from "./types.js";
import type {
  CompileWarning,
  CompiledOperator,
  CompiledTerrainProgram,
  ParameterSpec,
  PlanetContext,
} from "./types.js";

/**
 * The physics-driven fallback value for a parameter.
 *
 * Modulates the operator's typical value by how strongly the gate says this process
 * operated on this particular world. At intensity 0.5 the result is exactly the default;
 * a weakly-gated process is scaled down to a quarter, a strongly-gated one up to 1.75x.
 *
 * Without this, every world sharing an operator set compiles identically.
 */
function fallbackValue(spec: ParameterSpec, intensity: number): number {
  if (spec.scalesWithIntensity === false) return spec.default;
  const scaled = spec.default * (0.25 + 1.5 * intensity);
  return Math.min(Math.max(scaled, spec.min), spec.max);
}

/** What a composer may propose: operator id → parameter values. All optional. */
export type OperatorProposal = Record<string, Record<string, number>>;

/**
 * A proposal was malformed and the compiler was told not to tolerate it.
 *
 * Carries the warnings that caused the failure, so a caller can report precisely what was
 * wrong instead of "invalid proposal".
 */
export class TerrainProposalError extends Error {
  override readonly name = "TerrainProposalError";
  readonly warnings: readonly CompileWarning[];

  constructor(warnings: readonly CompileWarning[]) {
    super(
      `Terrain proposal rejected in strict mode: ${warnings.map(describeWarning).join("; ")}`,
    );
    this.warnings = warnings;
  }
}

/** One line per warning, for error messages and the provenance inspector alike. */
export function describeWarning(w: CompileWarning): string {
  switch (w.kind) {
    case "clamped":
      return `${w.op}.${w.parameter} clamped from ${w.requested} to ${w.clamped} (${w.bound} bound)`;
    case "unknown_operator":
      return `unknown operator "${w.op}"`;
    case "unknown_parameter":
      return `unknown parameter "${w.parameter}" on operator "${w.op}"`;
    case "proposal_for_inadmissible_operator":
      return `proposal for "${w.op}", which this world's physics rules out`;
  }
}

export interface CompileOptions {
  context: PlanetContext;
  seed: string;
  /** Composer proposals. Anything absent falls back to the operator's defaults. */
  proposal?: OperatorProposal;
  /**
   * Throw `TerrainProposalError` on any structural problem rather than recording it.
   *
   * Off by default because at runtime a slightly wrong proposal should degrade to physics
   * defaults rather than blank the screen. On in ingestion and in tests, where the same
   * proposal is a defect that should stop the build.
   *
   * Clamping is never fatal in either mode: a clamp is the gate doing its job, not a
   * malformed proposal.
   */
  strict?: boolean;
}

export function compileTerrainProgram(options: CompileOptions): CompiledTerrainProgram {
  const { context, seed, proposal = {}, strict = false } = options;

  const operators: CompiledOperator[] = [];
  const rejected: CompiledTerrainProgram["rejected"] = [];
  const warnings: CompileWarning[] = [];

  // Structural validation first, so an unknown operator is reported even when the gates
  // would have excluded everything anyway.
  const admissibility = new Map<string, boolean>();
  for (const op of listOperators()) admissibility.set(op.id, op.gate(context).admissible);

  // Sorted so warning order is a function of the proposal's content rather than of
  // JavaScript's object key ordering. Determinism has to hold for the diagnostics too, or a
  // snapshot test passes locally and fails in CI for a reason nobody can see.
  for (const opId of Object.keys(proposal).sort()) {
    const definition = getOperator(opId);

    if (definition === undefined) {
      warnings.push({
        kind: "unknown_operator",
        op: opId,
        message:
          `"${opId}" is not a registered terrain operator. A proposal naming it is ` +
          `describing a geological process this system does not model.`,
      });
      continue;
    }

    for (const parameter of Object.keys(proposal[opId] ?? {}).sort()) {
      if (parameter in definition.parameters) continue;
      warnings.push({
        kind: "unknown_parameter",
        op: opId,
        parameter,
        message:
          `Operator "${opId}" defines no parameter "${parameter}". It was ignored; the ` +
          `operator's own parameters kept their physics-driven values.`,
      });
    }

    if (admissibility.get(opId) === false) {
      warnings.push({
        kind: "proposal_for_inadmissible_operator",
        op: opId,
        message:
          `"${opId}" was proposed but this world's physics rules it out, so the proposal ` +
          `had no effect.`,
      });
    }
  }

  if (strict) {
    const fatal = warnings.filter((w) => w.kind !== "clamped");
    if (fatal.length > 0) throw new TerrainProposalError(fatal);
  }

  for (const op of listOperators()) {
    const gate = op.gate(context);

    if (!gate.admissible) {
      // Rejections are kept, not discarded. "There are no dunes here, because the surface
      // pressure cannot move sediment" is exactly as informative as the features present.
      rejected.push({ op: op.id, reason: gate.reason, gatedBy: gate.gatedBy });
      continue;
    }

    const proposed = proposal[op.id] ?? {};
    const params: Record<string, number> = {};
    const gateIntensity = (gate.intensityRange[0] + gate.intensityRange[1]) / 2;

    for (const [name, spec] of Object.entries(op.parameters)) {
      const requested = proposed[name] ?? fallbackValue(spec, gateIntensity);
      const clamped = Math.min(Math.max(requested, spec.min), spec.max);
      if (clamped !== requested) {
        warnings.push({
          kind: "clamped",
          op: op.id,
          parameter: name,
          requested,
          clamped,
          bound: clamped === spec.min ? "min" : "max",
        });
      }
      params[name] = clamped;
    }

    // The gate's intensity range binds any parameter literally named intensity, and
    // additionally scales coverage-like parameters that represent how much of the surface
    // the process touched.
    const [lo, hi] = gate.intensityRange;
    for (const name of ["coverage", "density", "networkDensity", "capExtent"]) {
      const value = params[name];
      if (value === undefined) continue;
      const bounded = Math.min(Math.max(value, lo), hi);
      if (bounded !== value) {
        warnings.push({
          kind: "clamped",
          op: op.id,
          parameter: name,
          requested: value,
          clamped: bounded,
          bound: bounded === lo ? "min" : "max",
        });
        params[name] = bounded;
      }
    }

    operators.push({
      op: op.id,
      params,
      gatedBy: gate.gatedBy,
      reason: gate.reason,
      confidence: gate.confidence,
    });
  }

  return { version: TERRAIN_VERSION, seed, operators, rejected, warnings };
}

/**
 * Operator ids in a proposal that are not in the registry.
 *
 * Informational only. `compileTerrainProgram()` performs this check itself and records the
 * result in `warnings`, so nothing needs to call this first -- it exists for callers that
 * want to inspect a proposal before compiling, and for tests. It is deliberately no longer
 * the safety mechanism, because the safety mechanism cannot be something a caller has to
 * remember to invoke.
 */
export function unknownOperatorIds(proposal: OperatorProposal): string[] {
  return Object.keys(proposal)
    .filter((id) => getOperator(id) === undefined)
    .sort();
}

/**
 * A diversity fingerprint for a compiled program.
 *
 * One component per (operator, parameter) pair across the whole registry, so the vector
 * has a fixed layout regardless of which operators a given world admits. An operator that
 * did not run contributes zeros — which is itself meaningful, since "this world has no
 * rivers" is a large difference from "this world has rivers".
 *
 * Deliberately *not* averaged per operator: collapsing an operator's parameters to their
 * mean hides exactly the differences the gate exists to detect. Two temperate worlds that
 * differ in gravity, hydrosphere fraction and tidal locking should be far apart, and they
 * only are if each parameter contributes its own axis.
 */
export function diversityFingerprint(program: CompiledTerrainProgram): number[] {
  const components: number[] = [];
  for (const op of listOperators()) {
    const compiled = program.operators.find((c) => c.op === op.id);
    for (const [name, spec] of Object.entries(op.parameters)) {
      if (!compiled) {
        components.push(0);
        continue;
      }
      const value = compiled.params[name] ?? spec.default;
      const span = spec.max - spec.min;
      components.push(span > 0 ? (value - spec.min) / span : 0);
    }
  }
  return components;
}

/** Euclidean distance between two fingerprints. Used by the catalog diversity gate. */
export function fingerprintDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
