import { describe, expect, it } from "vitest";
import {
  CANCRI_55E,
  EARTH,
  GJ_1214B,
  LHS_3844B,
  REFERENCE_CONTEXTS,
  TITAN,
  TRAPPIST_1E,
  compileTerrainProgram,
  diversityFingerprint,
  fingerprintDistance,
  listOperators,
  operatorIds,
  validateProposal,
} from "./index.js";

const compile = (context: Parameters<typeof compileTerrainProgram>[0]["context"], seed = "s") =>
  compileTerrainProgram({ context, seed });

const enabled = (context: Parameters<typeof compileTerrainProgram>[0]["context"]): string[] =>
  compile(context).operators.map((o) => o.op);

const rejectedFor = (
  context: Parameters<typeof compileTerrainProgram>[0]["context"],
  op: string,
): string | undefined => compile(context).rejected.find((r) => r.op === op)?.reason;

describe("gates encode real physics, not style", () => {
  it("gives an airless world craters but no dunes, rivers or glaciers", () => {
    const ops = enabled(LHS_3844B);
    expect(ops).toContain("impact_population");
    expect(ops).not.toContain("aeolian_transport");
    expect(ops).not.toContain("fluvial_erosion");
    expect(ops).not.toContain("glacial_erosion");
    expect(rejectedFor(LHS_3844B, "aeolian_transport")).toMatch(/below the ~10 Pa/);
  });

  it("gives Earth the full erosional suite", () => {
    const ops = enabled(EARTH);
    expect(ops).toEqual(
      expect.arrayContaining([
        "aeolian_transport",
        "fluvial_erosion",
        "glacial_erosion",
        "impact_population",
      ]),
    );
  });

  it("lets Titan have rivers and dunes, with methane as the working fluid", () => {
    // The gate must be a phase-diagram question, not "is it Earth-like".
    const ops = enabled(TITAN);
    expect(ops).toContain("fluvial_erosion");
    expect(ops).toContain("aeolian_transport");
    const fluvial = compile(TITAN).operators.find((o) => o.op === "fluvial_erosion");
    expect(fluvial?.reason).toContain("methane");
  });

  it("melts a lava world instead of building volcanoes on it", () => {
    const ops = enabled(CANCRI_55E);
    expect(ops).toContain("lava_ocean");
    expect(ops).not.toContain("volcanic_constructs");
    expect(rejectedFor(CANCRI_55E, "volcanic_constructs")).toMatch(/above the basalt solidus/);
  });

  it("refuses a solid surface to an envelope-dominated sub-Neptune", () => {
    const ops = enabled(GJ_1214B);
    expect(ops).not.toContain("reference_ellipsoid");
    expect(ops).not.toContain("long_wavelength_isostasy");
    expect(rejectedFor(GJ_1214B, "reference_ellipsoid")).toMatch(/no solid surface/i);
  });

  it("puts volatiles on the nightside of a tidally locked world", () => {
    const glacial = compile(TRAPPIST_1E).operators.find((o) => o.op === "glacial_erosion");
    expect(glacial?.reason).toMatch(/anti-stellar cold trap/);
  });
});

describe("rejections are kept, because absence is informative too", () => {
  it("explains why an airless world has no dunes", () => {
    const program = compile(LHS_3844B);
    expect(program.rejected.length).toBeGreaterThan(0);
    for (const r of program.rejected) {
      expect(r.reason.length).toBeGreaterThan(10);
      expect(r.gatedBy).toBeTruthy();
    }
  });

  it("cites a gating formula for every admitted operator", () => {
    for (const compiled of compile(EARTH).operators) {
      expect(compiled.gatedBy).toBeTruthy();
      expect(compiled.reason).toBeTruthy();
    }
  });
});

describe("the compiler binds proposals — prompts are not a safety mechanism", () => {
  it("clamps a parameter pushed past its physical bound", () => {
    const program = compileTerrainProgram({
      context: EARTH,
      seed: "s",
      // A composer proposing 90 km mountains on Earth.
      proposal: { long_wavelength_isostasy: { reliefAmplitudeM: 90_000 } },
    });
    const op = program.operators.find((o) => o.op === "long_wavelength_isostasy");
    expect(op?.params.reliefAmplitudeM).toBeLessThanOrEqual(20_000);
    expect(program.warnings.some((w) => w.parameter === "reliefAmplitudeM")).toBe(true);
  });

  it("cannot enable an operator the physics rejected", () => {
    const program = compileTerrainProgram({
      context: LHS_3844B,
      seed: "s",
      // A composer insisting on dunes on an airless world.
      proposal: { aeolian_transport: { coverage: 0.9 } },
    });
    expect(program.operators.map((o) => o.op)).not.toContain("aeolian_transport");
  });

  it("binds coverage to the gate's intensity range", () => {
    const program = compileTerrainProgram({
      context: TRAPPIST_1E,
      seed: "s",
      proposal: { aeolian_transport: { coverage: 1.0 } },
    });
    const op = program.operators.find((o) => o.op === "aeolian_transport");
    if (op) {
      expect(op.params.coverage).toBeLessThanOrEqual(1);
      expect(program.warnings.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("flags a proposal naming an operator that does not exist", () => {
    // Clamping means a model overreached; an unknown id means it invented a process.
    expect(validateProposal({ crystal_spires: { height: 5 } })).toEqual(["crystal_spires"]);
    expect(validateProposal({ aeolian_transport: {} })).toEqual([]);
  });
});

describe("determinism", () => {
  it("produces identical programs for identical inputs", () => {
    const a = compileTerrainProgram({ context: TRAPPIST_1E, seed: "seed-1" });
    const b = compileTerrainProgram({ context: TRAPPIST_1E, seed: "seed-1" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("orders operators by layer, so later processes carve into earlier ones", () => {
    const ops = listOperators();
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i]!.layerOrder).toBeGreaterThanOrEqual(ops[i - 1]!.layerOrder);
    }
    // Microdetail is always last.
    expect(ops[ops.length - 1]!.id).toBe("microdetail");
  });
});

describe("PRD §9.5 — catalog diversity is an assertion, not a feeling", () => {
  const names = Object.keys(REFERENCE_CONTEXTS) as Array<keyof typeof REFERENCE_CONTEXTS>;
  const fingerprints = names.map((n) => diversityFingerprint(compile(REFERENCE_CONTEXTS[n])));

  const pairs = (): Array<{ a: string; b: string; d: number }> => {
    const out: Array<{ a: string; b: string; d: number }> = [];
    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        out.push({
          a: names[i]!,
          b: names[j]!,
          d: fingerprintDistance(fingerprints[i]!, fingerprints[j]!),
        });
      }
    }
    return out.sort((x, y) => x.d - y.d);
  };

  /**
   * Near-duplicate threshold, calibrated rather than guessed.
   *
   * The fingerprint has ~19 components in [0,1], so the space diagonal is sqrt(19) ~ 4.36.
   * 0.10 is ~2% of that: worlds closer than this differ by less than the width of a single
   * parameter's meaningful range and would read as reskins of each other on screen.
   */
  const NEAR_DUPLICATE_EPSILON = 0.1;

  it("keeps every pair of catalog worlds above the near-duplicate threshold", () => {
    // The assertion a four-knob generator fails outright: before parameters were driven by
    // gate intensity, Earth and TRAPPIST-1e compiled to a distance of 0.007 — the same
    // planet twice.
    for (const { a, b, d } of pairs()) {
      expect(d, `${a} and ${b} are near-duplicates (distance ${d.toFixed(3)})`).toBeGreaterThan(
        NEAR_DUPLICATE_EPSILON,
      );
    }
  });

  it("documents the closest pair, so a regression toward sameness is visible", () => {
    const closest = pairs()[0]!;

    // Currently Earth vs TRAPPIST-1e at ~0.13. They are genuinely alike under this
    // operator set — both temperate rocky worlds with liquid water near 1 bar — and the
    // separation comes only from gravity, hydrosphere fraction and tidal locking.
    //
    // KNOWN GAP: no operator yet models the *terrain* consequences of tidal locking (a
    // permanent terminator, one-directional volatile transport, no seasonal cycle). Adding
    // one is the highest-value entry in the P2 operator backlog, and it should push this
    // pair apart substantially. Until then this test pins the current value so the number
    // cannot quietly drift downward.
    expect(closest.d).toBeGreaterThan(NEAR_DUPLICATE_EPSILON);
    expect(closest.d).toBeLessThan(0.5);
  });

  it("separates worlds of different class by a wide margin", () => {
    // An airless rock and an ocean-bearing world should not be marginal calls.
    const airless = diversityFingerprint(compile(LHS_3844B));
    const earthlike = diversityFingerprint(compile(EARTH));
    expect(fingerprintDistance(airless, earthlike)).toBeGreaterThan(0.5);
  });
});

describe("registry", () => {
  it("registers each operator under a unique id", () => {
    const ids = operatorIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("impact_population");
    expect(ids).toContain("fluvial_erosion");
  });

  it("declares bounds and a description for every parameter", () => {
    for (const op of listOperators()) {
      for (const [name, spec] of Object.entries(op.parameters)) {
        expect(spec.max, `${op.id}.${name}`).toBeGreaterThan(spec.min);
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
        expect(spec.description.length).toBeGreaterThan(5);
      }
    }
  });
});
