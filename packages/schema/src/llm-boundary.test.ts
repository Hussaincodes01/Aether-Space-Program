import { describe, expect, it } from "vitest";
import {
  VisualProposalSchema,
  scanForForbiddenFields,
  validateVisualProposal,
  type ValidationContext,
} from "./llm-boundary.js";

const context: ValidationContext = {
  knownSourceIds: new Set(["2021A&A...656A..57A", "2023Natur.614..649L"]),
  knownHypothesisIds: new Set(["H01", "H03"]),
};

const validProposal = {
  hypothesisId: "H03",
  palette: {
    dominantMineralFamily: "silicate_basaltic",
    weatheringIntensity: 0.4,
  },
  narrative: "A basaltic surface, lightly weathered, consistent with a stagnant-lid regime.",
  citedSourceIds: ["2021A&A...656A..57A"],
};

describe("PRD §19.1 — the LLM cannot write to the scientific record", () => {
  it("accepts a well-formed visual proposal", () => {
    const result = validateVisualProposal(validProposal, context);
    expect(result.ok).toBe(true);
  });

  // The headline acceptance criterion. Each of these is a value the LLM must never set.
  const forbidden: Array<[string, unknown]> = [
    ["mass", { ...validProposal, mass_earth: 1.6 }],
    ["radius", { ...validProposal, radius_earth: 1.18 }],
    ["distance", { ...validProposal, distance_pc: 12.4 }],
    ["orbital period", { ...validProposal, orbital_period_days: 6.1 }],
    ["abundance", { ...validProposal, h2o_abundance: 0.04 }],
    ["surface pressure", { ...validProposal, surface_pressure_bar: 1.0 }],
    ["gravity", { ...validProposal, gravity: 9.4 }],
  ];

  for (const [label, payload] of forbidden) {
    it(`rejects an attempt to write ${label}`, () => {
      const result = validateVisualProposal(payload, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.length).toBeGreaterThan(0);
      }
    });
  }

  it("catches a forbidden field nested inside an allowed object", () => {
    // A strict top-level schema alone would not see this; the deep scan does.
    const violations = scanForForbiddenFields({
      hypothesisId: "H03",
      palette: { dominantMineralFamily: "basalt", extra: { planet_radius: 1.2 } },
    });
    expect(violations.some((v) => v.kind === "forbidden_field")).toBe(true);
    expect(violations[0]?.path).toContain("planet_radius");
  });

  // Regression: `\b` treats `_` as a word character, so `/\bradius\b/` does not match
  // `planet_radius` — the naming style a model is most likely to produce. The scan
  // normalises keys before matching; these cases lock that in.
  const namingStyles = [
    "planet_radius",
    "planetRadius",
    "planet-radius",
    "PLANET_RADIUS",
    "stellar_mass",
    "orbitalPeriod",
    "h2o_abundance",
    "surface-pressure",
  ];

  for (const key of namingStyles) {
    it(`catches "${key}" regardless of naming convention`, () => {
      const violations = scanForForbiddenFields({ nested: { [key]: 1 } });
      expect(violations.some((v) => v.kind === "forbidden_field")).toBe(true);
    });
  }

  it("does not fire on innocuous keys", () => {
    // A scanner that flags everything gets switched off, so false positives matter.
    const violations = scanForForbiddenFields({
      hypothesisId: "H03",
      dominantMineralFamily: "silicate_basaltic",
      weatheringIntensity: 0.4,
      microdetailScale: "fine",
      narrative: "text",
    });
    expect(violations).toHaveLength(0);
  });

  it("rejects unknown top-level keys rather than ignoring them", () => {
    const result = validateVisualProposal(
      { ...validProposal, somethingNew: "surprise" },
      context,
    );
    expect(result.ok).toBe(false);
  });
});

describe("citations must resolve", () => {
  it("rejects a source id that is not in the ingested registry", () => {
    // A hallucinated bibcode looks exactly like a real one. Only the registry can tell.
    const result = validateVisualProposal(
      { ...validProposal, citedSourceIds: ["2024ApJ...999..123X"] },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.kind === "unresolved_source")).toBe(true);
    }
  });

  it("rejects a proposal attached to a hypothesis that was never produced", () => {
    const result = validateVisualProposal({ ...validProposal, hypothesisId: "H99" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.kind === "unknown_hypothesis")).toBe(true);
    }
  });
});

describe("narrative claims", () => {
  it("warns, without blocking, when narrative reads as a measurement", () => {
    // Narrative cannot contaminate the science layers, so this is a misinformation
    // concern rather than a data-integrity one — warn, do not reject.
    const result = validateVisualProposal(
      { ...validProposal, narrative: "This world is 1.6 Earth radii across." },
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.kind === "numeric_claim_in_narrative")).toBe(true);
    }
  });
});

describe("the proposal schema's shape is itself the safety property", () => {
  it("exposes only visual keys", () => {
    // If this test needs updating because a physical field was added, that change requires
    // a PRD amendment — it would break containment.
    const keys = Object.keys(VisualProposalSchema.shape).sort();
    expect(keys).toEqual([
      "camera",
      "citedSourceIds",
      "hypothesisId",
      "narrative",
      "palette",
      "texture",
    ]);
  });
});
