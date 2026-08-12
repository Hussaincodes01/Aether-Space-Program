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

export interface CompileOptions {
  context: PlanetContext;
  seed: string;
  /** Composer proposals. Anything absent falls back to the operator's defaults. */
  proposal?: OperatorProposal;
}

export function compileTerrainProgram(options: CompileOptions): CompiledTerrainProgram {
  const { context, seed, proposal = {} } = options;

  const operators: CompiledOperator[] = [];
  const rejected: CompiledTerrainProgram["rejected"] = [];
  const warnings: CompileWarning[] = [];

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
 * Reject a proposal that names an operator that does not exist.
 *
 * Separate from clamping because an unknown operator id is a different failure: clamping
 * means a model overreached, an unknown id means it invented a geological process.
 */
export function validateProposal(proposal: OperatorProposal): string[] {
  return Object.keys(proposal).filter((id) => getOperator(id) === undefined);
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
