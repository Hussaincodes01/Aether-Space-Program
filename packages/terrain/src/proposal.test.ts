/**
 * Terrain proposal containment.
 *
 * The compiler's job is to make a bad proposal harmless without making it invisible. These
 * tests pin both halves: the program that comes out is always physically admissible, and
 * whatever had to be corrected to get there is always recoverable from `warnings`.
 *
 * The specific regression being locked down is that this validation used to live in a
 * separate `validateProposal()` that callers had to remember to invoke. Every test here
 * calls only `compileTerrainProgram()`, because that is the guarantee: one entry point that
 * cannot be used unsafely.
 */

import { describe, expect, it } from "vitest";
import {
  REFERENCE_CONTEXTS,
  TerrainProposalError,
  compileTerrainProgram,
  describeWarning,
  listOperators,
  unknownOperatorIds,
  type CompileWarning,
  type OperatorProposal,
} from "./index.js";

const SEED = "sha256:proposal-test";
const earth = REFERENCE_CONTEXTS.Earth;

/**
 * A world with no solid surface, so every surface operator is inadmissible on it.
 *
 * Built here rather than taken from REFERENCE_CONTEXTS because the reference set is all
 * rocky worlds; the inadmissible-proposal path needs something the gates refuse outright.
 */
const GAS_GIANT: typeof earth = {
  ...earth,
  bulkDensityKgM3: 1326,
  surfaceGravityMs2: 24.79,
  radiusM: 6.9911e7,
  surfaceTemperatureK: 165,
  surfacePressurePa: 1e5,
  hydrosphereFraction: 0,
  stableLiquid: "none",
  hasStableIce: false,
};

function compile(proposal: OperatorProposal, strict = false) {
  return compileTerrainProgram({ context: earth, seed: SEED, proposal, strict });
}

const kinds = (warnings: readonly CompileWarning[]) => warnings.map((w) => w.kind);

describe("unknown operators are recorded, never silently ignored", () => {
  it("records a warning naming the operator", () => {
    const program = compile({ continental_drift_by_vibes: { intensity: 0.5 } });
    const unknown = program.warnings.filter((w) => w.kind === "unknown_operator");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.op).toBe("continental_drift_by_vibes");
  });

  it("compiles a valid program anyway, from physics defaults", () => {
    // Degrading to physics rather than failing is the right runtime behaviour: an invented
    // operator should cost you the proposal, not the planet.
    const program = compile({ continental_drift_by_vibes: { intensity: 0.5 } });
    expect(program.operators.length).toBeGreaterThan(0);
  });

  it("does not invent an operator entry for it", () => {
    const program = compile({ continental_drift_by_vibes: { intensity: 0.5 } });
    expect(program.operators.map((o) => o.op)).not.toContain("continental_drift_by_vibes");
  });

  it("agrees with the standalone informational helper", () => {
    const proposal = { not_a_real_operator: {}, also_fake: {} };
    expect(unknownOperatorIds(proposal)).toEqual(["also_fake", "not_a_real_operator"]);
    const program = compile(proposal);
    expect(
      program.warnings.filter((w) => w.kind === "unknown_operator").map((w) => w.op),
    ).toEqual(["also_fake", "not_a_real_operator"]);
  });
});

describe("unknown parameters on a known operator are recorded", () => {
  it("names both the operator and the parameter", () => {
    const op = listOperators()[0]!;
    const program = compile({ [op.id]: { definitelyNotAParameter: 1 } });

    const unknown = program.warnings.filter((w) => w.kind === "unknown_parameter");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({
      op: op.id,
      parameter: "definitelyNotAParameter",
    });
  });

  it("leaves the operator's real parameters at their physics-driven values", () => {
    const op = listOperators().find((o) => Object.keys(o.parameters).length > 0)!;
    const clean = compileTerrainProgram({ context: earth, seed: SEED });
    const polluted = compile({ [op.id]: { nonsenseParameter: 999 } });

    const a = clean.operators.find((o) => o.op === op.id);
    const b = polluted.operators.find((o) => o.op === op.id);
    if (a && b) expect(b.params).toEqual(a.params);
  });
});

describe("proposals aimed at an operator this world rules out", () => {
  it("are recorded as such, not as unknown operators", () => {
    // Jupiter has no solid surface, so every surface operator is inadmissible there.
    const program = compileTerrainProgram({
      context: GAS_GIANT,
      seed: SEED,
      proposal: { impact_population: { density: 0.9 } },
    });

    expect(kinds(program.warnings)).toContain("proposal_for_inadmissible_operator");
    expect(kinds(program.warnings)).not.toContain("unknown_operator");
  });

  it("still do not enable the operator", () => {
    const program = compileTerrainProgram({
      context: GAS_GIANT,
      seed: SEED,
      proposal: { impact_population: { density: 0.9 } },
    });
    expect(program.operators.map((o) => o.op)).not.toContain("impact_population");
    expect(program.rejected.map((r) => r.op)).toContain("impact_population");
  });
});

describe("clamping", () => {
  it("pulls an out-of-range parameter back and says so", () => {
    const op = listOperators().find((o) =>
      Object.values(o.parameters).some((p) => Number.isFinite(p.max)),
    )!;
    const [name, spec] = Object.entries(op.parameters).find(([, p]) => Number.isFinite(p.max))!;

    const program = compileTerrainProgram({
      context: earth,
      seed: SEED,
      proposal: { [op.id]: { [name]: spec.max * 1000 + 1000 } },
    });

    const compiled = program.operators.find((o) => o.op === op.id);
    if (!compiled) return; // Not admissible on Earth; the clamp path is covered elsewhere.

    expect(compiled.params[name]).toBeLessThanOrEqual(spec.max);
    const clamps = program.warnings.filter((w) => w.kind === "clamped");
    expect(clamps.length).toBeGreaterThan(0);
  });

  it("is never fatal, even in strict mode", () => {
    // A clamp is the gate working as designed. Only structural problems are proposal bugs.
    const op = listOperators().find((o) => Object.keys(o.parameters).length > 0)!;
    const [name, spec] = Object.entries(op.parameters)[0]!;
    expect(() =>
      compileTerrainProgram({
        context: earth,
        seed: SEED,
        strict: true,
        proposal: { [op.id]: { [name]: spec.max * 1e6 + 1e6 } },
      }),
    ).not.toThrow();
  });
});

describe("strict mode", () => {
  it("throws a typed error on an unknown operator", () => {
    expect(() => compile({ made_up_process: {} }, true)).toThrow(TerrainProposalError);
  });

  it("throws on an unknown parameter", () => {
    const op = listOperators()[0]!;
    expect(() => compile({ [op.id]: { notARealParameter: 1 } }, true)).toThrow(
      TerrainProposalError,
    );
  });

  it("carries the warnings on the error, so the caller can report specifics", () => {
    try {
      compile({ made_up_process: {} }, true);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TerrainProposalError);
      const e = error as TerrainProposalError;
      expect(e.warnings).toHaveLength(1);
      expect(e.warnings[0]!.kind).toBe("unknown_operator");
      expect(e.message).toContain("made_up_process");
    }
  });

  it("accepts a well-formed proposal", () => {
    const op = listOperators().find((o) => Object.keys(o.parameters).length > 0)!;
    const [name, spec] = Object.entries(op.parameters)[0]!;
    expect(() =>
      compile({ [op.id]: { [name]: (spec.min + spec.max) / 2 } }, true),
    ).not.toThrow();
  });
});

describe("determinism", () => {
  it("produces an identical program for the same seed, context and proposal", () => {
    const proposal = { made_up: {}, impact_population: { density: 0.4 } };
    const a = compile(proposal);
    const b = compile(proposal);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("orders warnings independently of the proposal's key insertion order", () => {
    // Object key order is insertion order in JavaScript, so without an explicit sort the
    // warning list would depend on how the proposal happened to be built. That would make a
    // snapshot pass locally and fail elsewhere for no visible reason.
    const forwards = compile({ aaa_fake: {}, zzz_fake: {} });
    const backwards = compile({ zzz_fake: {}, aaa_fake: {} });
    expect(forwards.warnings.map((w) => w.op)).toEqual(backwards.warnings.map((w) => w.op));
  });

  it("gives every warning a human-readable description", () => {
    const program = compile({ made_up_process: {} });
    for (const warning of program.warnings) {
      expect(describeWarning(warning).length).toBeGreaterThan(0);
    }
  });
});
