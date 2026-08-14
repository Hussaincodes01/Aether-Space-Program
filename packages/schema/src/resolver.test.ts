/**
 * Resolver safety tests.
 *
 * These are containment tests, not behaviour tests. Each one describes a specific way a
 * wrong number could reach the renderer wearing a credible provenance record, and asserts
 * that it cannot. The failure mode they guard against is not a crash — it is a planet that
 * looks fine and is silently built from the wrong quantity.
 */

import { describe, expect, it } from "vitest";
import {
  checkDomain,
  dimensionOf,
  isKnownUnit,
  normaliseFieldName,
  rejectionReason,
  resolveMissingValue,
  unitsCompatible,
  type Distribution,
  type ResolutionRequest,
  type ScientificQuantity,
} from "./index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z").toISOString();

function measured(valueSI: number | null, unit: string): ScientificQuantity {
  return {
    valueSI,
    unit,
    method: "measured",
    sourceId: "test:catalog",
    retrievedAt: NOW,
    confidence: 0.9,
  };
}

function distribution(
  median: number,
  unit: string,
  over: Partial<Distribution> = {},
): Distribution {
  return {
    median,
    p16: median * 0.9,
    p84: median * 1.1,
    unit,
    method: "prior",
    modelId: "test:prior",
    ...over,
  };
}

function request(over: Partial<ResolutionRequest> = {}): ResolutionRequest {
  return {
    field: "planet_radius",
    unit: "m",
    science: {},
    inference: {},
    seed: "sha256:test",
    ...over,
  };
}

describe("unit dimensions", () => {
  it("recognises the units the codebase actually uses", () => {
    for (const unit of ["m", "kg", "s", "K", "Pa", "W/m^2", "kg/m^3", "m/s", "m/s^2", "1"]) {
      expect(isKnownUnit(unit), unit).toBe(true);
      expect(dimensionOf(unit), unit).not.toBeNull();
    }
  });

  it("treats an unrecognised unit as incompatible with everything, including itself", () => {
    // "We have never seen this unit" and "this unit is fine" are different statements, and
    // only one of them is safe to act on.
    expect(unitsCompatible("furlongs", "m")).toBe(false);
    expect(unitsCompatible("furlongs", "furlongs")).toBe(false);
  });

  it("accepts the spelling variants ingestion sees in the wild", () => {
    expect(unitsCompatible("kg/m3", "kg/m^3")).toBe(true);
    expect(unitsCompatible("W/m2", "W/m^2")).toBe(true);
  });

  it("keeps angles apart from plain ratios despite both being dimensionless", () => {
    // Formally radians are dimensionless. Allowing the interchange would let an orbital
    // inclination satisfy a request for a Bond albedo, which is structurally valid and
    // physically nonsense.
    expect(unitsCompatible("rad", "1")).toBe(false);
    expect(unitsCompatible("rad", "deg")).toBe(true);
  });

  it("separates quantities that differ only by a time exponent", () => {
    expect(unitsCompatible("m/s", "m/s^2")).toBe(false);
    expect(unitsCompatible("m", "m^2")).toBe(false);
  });
});

describe("physical domains", () => {
  it("rejects a temperature below absolute zero", () => {
    expect(checkDomain(-1, "K", "equilibrium_temperature")).not.toBeNull();
    expect(checkDomain(0, "K", "equilibrium_temperature")).toBeNull();
  });

  it("rejects a negative mass and a negative pressure", () => {
    expect(checkDomain(-1, "kg", "planet_mass")).not.toBeNull();
    expect(checkDomain(-1, "Pa", "surface_pressure")).not.toBeNull();
  });

  it("rejects a zero density, which means no body rather than a small one", () => {
    expect(checkDomain(0, "kg/m^3", "bulk_density")).not.toBeNull();
  });

  it("rejects an albedo above one under every naming convention", () => {
    for (const field of ["bond_albedo", "bondAlbedo", "bond-albedo", "BondAlbedo"]) {
      expect(checkDomain(1.4, "1", field), field).not.toBeNull();
      expect(checkDomain(0.3, "1", field), field).toBeNull();
    }
  });

  it("rejects a non-finite value", () => {
    expect(checkDomain(Number.NaN, "m", "planet_radius")).not.toBeNull();
    expect(checkDomain(Number.POSITIVE_INFINITY, "m", "planet_radius")).not.toBeNull();
  });

  it("normalises field names the same way the LLM boundary scanner does", () => {
    expect(normaliseFieldName("planet_radius")).toBe("planet radius");
    expect(normaliseFieldName("planetRadius")).toBe("planet radius");
    expect(normaliseFieldName("planet-radius")).toBe("planet radius");
  });
});

describe("the resolver refuses values in the wrong unit", () => {
  it("does not return a measurement stored in kelvin for a request in metres", () => {
    const result = resolveMissingValue(
      request({ science: { planet_radius: measured(288, "K") } }),
    );
    expect(result.kind).toBe("unresolved");
  });

  it("records why it refused, rather than silently reporting nothing was available", () => {
    const result = resolveMissingValue(
      request({ science: { planet_radius: measured(288, "K") } }),
    );
    if (result.kind !== "unresolved") throw new Error("expected unresolved");
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]!.strategyId).toBe("published_measurement");
    expect(result.rejections[0]!.reason).toContain("K");
  });

  it("still returns a compatible measurement", () => {
    const result = resolveMissingValue(
      request({ science: { planet_radius: measured(6.371e6, "m") } }),
    );
    expect(result.kind).toBe("measurement");
  });

  it("falls through to inference when the science entry is in the wrong unit", () => {
    // The important part is the fall-through: a bad unit in one layer must not poison the
    // request, it must simply not answer it.
    const result = resolveMissingValue(
      request({
        science: { planet_radius: measured(288, "K") },
        inference: { planet_radius: distribution(6.4e6, "m") },
      }),
    );
    expect(result.kind).toBe("prior");
  });
});

describe("the resolver refuses physically impossible values", () => {
  it("does not return a negative radius", () => {
    const result = resolveMissingValue(
      request({ science: { planet_radius: measured(-6.371e6, "m") } }),
    );
    expect(result.kind).toBe("unresolved");
  });

  it("does not return an albedo above one", () => {
    const result = resolveMissingValue(
      request({
        field: "bond_albedo",
        unit: "1",
        science: { bond_albedo: measured(1.6, "1") },
      }),
    );
    expect(result.kind).toBe("unresolved");
  });

  it("does not treat a null measurement as a number", () => {
    // null is a first-class "genuinely unknown" and must survive to the UI as one.
    const result = resolveMissingValue(
      request({ science: { planet_radius: measured(null, "m") } }),
    );
    expect(result.kind).toBe("unresolved");
  });

  it("rejects a distribution whose quantiles are inverted", () => {
    const result = resolveMissingValue(
      request({
        inference: { planet_radius: distribution(6.4e6, "m", { p16: 9e6, p84: 1e6 }) },
      }),
    );
    expect(result.kind).toBe("unresolved");
  });
});

describe("out-of-distribution posteriors are not laundered into calibrated retrievals", () => {
  it("refuses to return an OOD posterior as a posterior", () => {
    const result = resolveMissingValue(
      request({
        inference: {
          planet_radius: distribution(6.4e6, "m", { method: "retrieved", oodFlag: true }),
        },
      }),
    );
    // It may fall through to a placeholder, but it must never come back as `posterior`:
    // a retrieval extrapolated outside its training domain has lost the calibration that
    // made it a posterior in the first place.
    expect(result.kind).not.toBe("posterior");
  });

  it("returns an in-domain posterior normally", () => {
    const result = resolveMissingValue(
      request({
        inference: {
          planet_radius: distribution(6.4e6, "m", { method: "retrieved", modelId: "m:1" }),
        },
      }),
    );
    expect(result.kind).toBe("posterior");
  });
});

describe("placeholders cannot enter physics", () => {
  it("marks every placeholder affectsPhysics: false", () => {
    const result = resolveMissingValue(
      request({
        inference: {
          planet_radius: distribution(6.4e6, "m", { method: "retrieved", oodFlag: true }),
        },
      }),
    );
    if (result.kind !== "placeholder")
      throw new Error(`expected placeholder, got ${result.kind}`);
    expect(result.visual.affectsPhysics).toBe(false);
    expect(result.visual.sourceField).toBe("inference.planet_radius");
  });

  it("will not emit a placeholder from a distribution in an incompatible unit", () => {
    // The placeholder is the last resort, and the last resort is exactly where a unit check
    // is most likely to be skipped "because it is only visual".
    const result = resolveMissingValue(
      request({ inference: { planet_radius: distribution(288, "K") } }),
    );
    expect(result.kind).toBe("unresolved");
  });
});

describe("rejectionReason is testable on its own", () => {
  it("passes a well-formed measurement", () => {
    expect(
      rejectionReason({ kind: "measurement", quantity: measured(6.371e6, "m") }, request()),
    ).toBeNull();
  });

  it("names the unit problem", () => {
    const reason = rejectionReason(
      { kind: "measurement", quantity: measured(6.371e6, "Pa") },
      request(),
    );
    expect(reason).toContain("Pa");
    expect(reason).toContain("m");
  });
});
