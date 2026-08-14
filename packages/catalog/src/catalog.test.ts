/**
 * Catalog and PlanetModel tests.
 *
 * The organising idea: Earth is in this catalog for the sole purpose of being checkable.
 * Every derived quantity has a published right answer, so if the pipeline computes Earth's
 * density as anything other than 5514 kg/m3 it is broken — and no amount of care applied to
 * TRAPPIST-1 e would have revealed that, because nobody can check TRAPPIST-1 e.
 */

import { describe, expect, it } from "vitest";
import { EARTH_MASS, EARTH_RADIUS, SOLAR_MASS, SOLAR_RADIUS } from "@aether/units";
import { allMissionsSelection, buildEvidenceProfile, createSelection } from "@aether/missions";
import {
  InvalidCatalogDataError,
  UnknownCatalogEntryError,
  UnresolvedRequiredFieldError,
  buildPlanetModel,
  getPlanet,
  getSystem,
  listSources,
  listSystems,
  massRadiusPrior,
  planetSeedString,
  requireValue,
  siUnitFor,
  sourceExists,
  stableSeed,
  toSI,
  toScientificQuantity,
  validateSystemSeed,
} from "./index.js";

const everything = buildEvidenceProfile(allMissionsSelection());
const transitOnly = buildEvidenceProfile(createSelection(["tess"]));

describe("ingestion validates rather than trusts", () => {
  it("loads the seed systems", () => {
    const ids = listSystems().map((s) => s.id);
    expect(ids).toContain("sol");
    expect(ids).toContain("trappist-1");
    expect(ids).toContain("proxima-centauri");
  });

  it("rejects an entry whose sourceId does not resolve", () => {
    // The provenance promise is only structural if this fails loudly.
    const broken = structuredClone(getSystem("trappist-1")) as Record<string, unknown>;
    (broken.star as { radius: { sourceId: string } }).radius.sourceId = "nonexistent-paper";

    expect(() => validateSystemSeed(broken)).toThrow(InvalidCatalogDataError);
  });

  it("names the offending field in the error", () => {
    const broken = structuredClone(getSystem("trappist-1")) as Record<string, unknown>;
    (broken.star as { radius: { sourceId: string } }).radius.sourceId = "nope";
    try {
      validateSystemSeed(broken);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCatalogDataError);
      expect((error as InvalidCatalogDataError).issues.join(" ")).toContain("star.radius");
    }
  });

  it("rejects a system with duplicate planet ids", () => {
    const broken = structuredClone(getSystem("trappist-1"));
    broken.planets.push(structuredClone(broken.planets[0]!));
    expect(() => validateSystemSeed(broken)).toThrow(InvalidCatalogDataError);
  });

  it("rejects a malformed value outright", () => {
    const broken = structuredClone(getSystem("sol")) as Record<string, unknown>;
    (broken.star as { radius: unknown }).radius = { value: "one", unit: "R_sun" };
    expect(() => validateSystemSeed(broken)).toThrow(InvalidCatalogDataError);
  });

  it("throws a typed error for an unknown id, listing what does exist", () => {
    expect(() => getSystem("kepler-nonexistent")).toThrow(UnknownCatalogEntryError);
    expect(() => getPlanet("trappist-1", "z")).toThrow(UnknownCatalogEntryError);
  });

  it("gives every source a citation", () => {
    for (const source of listSources()) {
      expect(source.citation.length, source.id).toBeGreaterThan(0);
    }
    expect(sourceExists("unmeasured")).toBe(true);
  });
});

describe("unit conversion", () => {
  it("converts catalog units to SI exactly", () => {
    expect(toSI(1, "R_earth")).toBeCloseTo(EARTH_RADIUS, 0);
    expect(toSI(1, "M_earth")).toBeCloseTo(EARTH_MASS, -18);
    expect(toSI(1, "R_sun")).toBeCloseTo(SOLAR_RADIUS, 0);
    expect(toSI(1, "M_sun")).toBeCloseTo(SOLAR_MASS, -24);
    expect(toSI(1, "day")).toBe(86_400);
    expect(toSI(1, "bar")).toBe(1e5);
    expect(toSI(180, "deg")).toBeCloseTo(Math.PI, 10);
  });

  it("reports the SI unit each catalog unit lands in", () => {
    expect(siUnitFor("R_earth")).toBe("m");
    expect(siUnitFor("M_jup")).toBe("kg");
    expect(siUnitFor("day")).toBe("s");
    expect(siUnitFor("bar")).toBe("Pa");
    expect(siUnitFor("deg")).toBe("rad");
  });

  it("scales uncertainty by the same factor as the value", () => {
    const q = toScientificQuantity({
      value: 2,
      unit: "R_earth",
      uncertainty: { minus: 0.1, plus: 0.2 },
      sourceId: "iau2015-b3",
      method: "measured",
    });
    expect(q.valueSI! / q.uncertainty!.minus).toBeCloseTo(2 / 0.1, 6);
    expect(q.unit).toBe("m");
  });

  it("carries null through as null rather than zero", () => {
    // The difference between "unknown" and "zero" is the difference between an honest
    // model and a wrong one.
    const q = toScientificQuantity({
      value: null,
      unit: "1",
      sourceId: "unmeasured",
      method: "measured",
    });
    expect(q.valueSI).toBeNull();
    expect(q.confidence).toBe(0);
  });

  it("gives a value with a published uncertainty more confidence than one without", () => {
    const base = {
      value: 1,
      unit: "R_earth",
      sourceId: "iau2015-b3",
      method: "measured",
    } as const;
    const withBars = toScientificQuantity({ ...base, uncertainty: { minus: 0.1, plus: 0.1 } });
    expect(withBars.confidence!).toBeGreaterThan(toScientificQuantity(base).confidence!);
  });
});

describe("Earth is the pipeline's own unit test", () => {
  const earth = buildPlanetModel("sol", "earth", everything);

  it("computes Earth's bulk density as 5514 kg/m3", () => {
    expect(earth.derived.bulk_density!.derivation.value).toBeCloseTo(5514, -2);
  });

  it("computes Earth's surface gravity as 9.80 m/s2", () => {
    expect(earth.derived.surface_gravity!.derivation.value).toBeCloseTo(9.8, 1);
  });

  it("computes Earth's escape velocity as 11.2 km/s", () => {
    expect(earth.derived.escape_velocity!.derivation.value).toBeCloseTo(11_186, -2);
  });

  it("computes Earth's insolation as the solar constant", () => {
    expect(earth.derived.insolation!.derivation.value).toBeCloseTo(1361, -2);
  });

  it("computes Earth's equilibrium temperature as 254 K, not 288 K", () => {
    // 288 K is the *surface* temperature and includes 33 K of greenhouse warming.
    // Equilibrium temperature deliberately excludes it, and conflating the two is the most
    // common error in exoplanet popular writing.
    expect(earth.derived.equilibrium_temperature!.derivation.value).toBeCloseTo(254, 0);
  });

  it("labels every derivation with the formula that produced it", () => {
    for (const [field, entry] of Object.entries(earth.derived)) {
      expect(entry.quantity.method, field).toBe("derived");
      expect(entry.quantity.sourceId, field).toContain("formula:");
      expect(entry.derivation.formulaId.length, field).toBeGreaterThan(0);
    }
  });

  it("uses Earth's measured albedo rather than the 0.3 assumption", () => {
    const eq = earth.derived.equilibrium_temperature!.derivation;
    expect(eq.assumptions.some((a) => a.parameter.toLowerCase().includes("albedo"))).toBe(
      false,
    );
  });
});

describe("TRAPPIST-1 e", () => {
  const model = buildPlanetModel("trappist-1", "e", everything);

  it("has a measured radius and mass in SI", () => {
    expect(model.science.planet_radius!.valueSI).toBeCloseTo(0.92 * EARTH_RADIUS, -3);
    expect(model.science.planet_radius!.unit).toBe("m");
    expect(model.science.planet_mass!.unit).toBe("kg");
  });

  it("records the Bond albedo as unknown, not as 0.3", () => {
    expect(model.science.bond_albedo).toBeUndefined();
    expect(model.unknown.bond_albedo).toBeDefined();
  });

  it("flags the albedo assumption on the equilibrium temperature it forced", () => {
    const eq = model.derived.equilibrium_temperature!.derivation;
    expect(eq.assumptions.length).toBeGreaterThan(0);
    // An assumption caps confidence, which is what makes the world *look* uncertain rather
    // than merely being uncertain in a tooltip.
    expect(eq.confidence).toBeLessThanOrEqual(0.5);
  });

  it("lands in the temperate range its habitability claim rests on", () => {
    const teq = model.derived.equilibrium_temperature!.derivation.value;
    expect(teq).toBeGreaterThan(200);
    expect(teq).toBeLessThan(260);
  });

  it("records that no surface pressure has ever been measured", () => {
    expect(model.unknown.surface_pressure).toBeDefined();
  });

  it("never claims certainty about the surface", () => {
    // The floor exists because no exoplanet surface has been resolved. Ever.
    expect(model.speculation).toBeGreaterThan(0);
  });
});

describe("mission selection withholds measurements and never invents them", () => {
  const rich = buildPlanetModel("trappist-1", "e", everything);
  const poor = buildPlanetModel("trappist-1", "e", transitOnly);

  it("hides a measurement the selected missions could not have obtained", () => {
    expect(poor.withheld.length).toBeGreaterThan(0);
    expect(Object.keys(poor.science).length).toBeLessThan(Object.keys(rich.science).length);
  });

  it("never produces a science field that the rich profile lacks", () => {
    // The one-way property: less evidence can only remove measurements, never add them.
    for (const field of Object.keys(poor.science)) {
      expect(
        rich.science[field],
        `${field} appeared only under the poorer profile`,
      ).toBeDefined();
    }
  });

  it("gives identical values for any field both profiles do expose", () => {
    for (const field of Object.keys(poor.science)) {
      expect(poor.science[field]!.valueSI, field).toBe(rich.science[field]!.valueSI);
    }
  });

  it("widens the speculation with less evidence", () => {
    expect(poor.speculation).toBeGreaterThan(rich.speculation);
  });

  it("keeps a withheld value out of the science layer entirely", () => {
    for (const field of poor.withheld) {
      expect(poor.science[field], field).toBeUndefined();
    }
  });
});

describe("inference fills gaps with distributions, not scalars", () => {
  const proxima = buildPlanetModel("proxima-centauri", "b", everything);

  it("has no measured radius, because Proxima b does not transit", () => {
    expect(proxima.science.planet_radius).toBeUndefined();
  });

  it("infers one from the mass-radius relation, labelled as a prior", () => {
    const radius = proxima.inference.planet_radius;
    expect(radius).toBeDefined();
    expect(radius!.method).toBe("prior");
    expect(radius!.modelId).toContain("chen-kipping");
    expect(radius!.unit).toBe("m");
  });

  it("keeps the full width of the relation rather than collapsing to a median", () => {
    const radius = proxima.inference.planet_radius!;
    expect(radius.p84).toBeGreaterThan(radius.median);
    expect(radius.p16).toBeLessThan(radius.median);
  });

  it("puts a 1.07 Earth-mass planet near one Earth radius", () => {
    const radius = proxima.inference.planet_radius!;
    expect(radius.median / EARTH_RADIUS).toBeGreaterThan(0.9);
    expect(radius.median / EARTH_RADIUS).toBeLessThan(1.3);
  });
});

describe("the mass-radius prior", () => {
  it("returns one Earth radius for one Earth mass", () => {
    expect(massRadiusPrior(EARTH_MASS).median / EARTH_RADIUS).toBeCloseTo(1, 3);
  });

  it("is monotonic across the Terran and Neptunian regimes", () => {
    let previous = 0;
    for (const massEarth of [0.1, 0.5, 1, 2, 5, 20, 100]) {
      const r = massRadiusPrior(massEarth * EARTH_MASS).median;
      expect(r, `${massEarth} M_earth`).toBeGreaterThan(previous);
      previous = r;
    }
  });

  it("is continuous across the 2.04 Earth-mass break", () => {
    const below = massRadiusPrior(2.03 * EARTH_MASS).median;
    const above = massRadiusPrior(2.05 * EARTH_MASS).median;
    expect(Math.abs(above - below) / below).toBeLessThan(0.01);
  });

  it("flags out-of-distribution in the Jovian regime rather than extrapolating quietly", () => {
    // Above ~130 Earth masses radius stops tracking mass, so the relation does not apply.
    expect(massRadiusPrior(500 * EARTH_MASS).oodFlag).toBe(true);
    expect(massRadiusPrior(EARTH_MASS).oodFlag).toBe(false);
  });

  it("widens the interval for Neptunians, which genuinely scatter more", () => {
    const terran = massRadiusPrior(EARTH_MASS);
    const neptunian = massRadiusPrior(20 * EARTH_MASS);
    expect(neptunian.p84 / neptunian.median).toBeGreaterThan(terran.p84 / terran.median);
  });
});

describe("deterministic seeding", () => {
  it("gives the same seed for the same planet and evidence", () => {
    const a = buildPlanetModel("trappist-1", "e", everything);
    const b = buildPlanetModel("trappist-1", "e", everything);
    expect(a.seed).toBe(b.seed);
  });

  it("gives the same terrain program for the same seed", () => {
    const a = buildPlanetModel("trappist-1", "e", everything);
    const b = buildPlanetModel("trappist-1", "e", everything);
    expect(JSON.stringify(a.terrain)).toBe(JSON.stringify(b.terrain));
  });

  it("gives different seeds to different planets", () => {
    const e = buildPlanetModel("trappist-1", "e", everything);
    const f = buildPlanetModel("trappist-1", "f", everything);
    expect(e.seed).not.toBe(f.seed);
  });

  it("changes the seed when the evidence profile changes", () => {
    // This is the mechanic: new observations can change the hypothesis, traceably.
    const rich = buildPlanetModel("trappist-1", "e", everything);
    const poor = buildPlanetModel("trappist-1", "e", transitOnly);
    expect(rich.seed).not.toBe(poor.seed);
  });

  it("does not depend on the order coverage keys were inserted", () => {
    const forwards = planetSeedString("s", "p", {
      ...everything,
      coverage: {
        planet_mass: { quality: 0.6 },
        stellar_radius: { quality: 0.9 },
      },
    });
    const backwards = planetSeedString("s", "p", {
      ...everything,
      coverage: {
        stellar_radius: { quality: 0.9 },
        planet_mass: { quality: 0.6 },
      },
    });
    expect(forwards).toBe(backwards);
  });

  it("distinguishes evidence profiles that differ only in constraint quality", () => {
    // ConstraintQuality is an object, so interpolating it straight into a template string
    // yields "[object Object]" and every quality collapses to the same seed. The whole
    // mechanic depends on better evidence being able to change the world.
    const weak = planetSeedString("s", "p", {
      ...everything,
      coverage: { planet_mass: { quality: 0.2 } },
    });
    const strong = planetSeedString("s", "p", {
      ...everything,
      coverage: { planet_mass: { quality: 0.9 } },
    });
    expect(weak).not.toBe(strong);
  });

  it("produces a stable hash across runs", () => {
    expect(stableSeed("aether:v1|a|b|")).toBe(stableSeed("aether:v1|a|b|"));
    expect(stableSeed("a")).not.toBe(stableSeed("b"));
  });
});

describe("terrain is a hypothesis attached to the model", () => {
  it("compiles a program for a planet with enough derived physics", () => {
    const model = buildPlanetModel("trappist-1", "e", everything);
    expect(model.terrain).not.toBeNull();
    expect(model.terrain!.operators.length).toBeGreaterThan(0);
  });

  it("refuses to generate a surface at all when the evidence is too thin", () => {
    // TESS alone gives a radius, a period and an orbit -- and no stellar radius, so no
    // insolation, so no equilibrium temperature, so no admissibility gate can be evaluated.
    // The honest output is no surface hypothesis rather than one built on defaults.
    const model = buildPlanetModel("trappist-1", "e", transitOnly);
    expect(model.terrain).toBeNull();
    expect(model.terrainAbsentReason).toContain("equilibrium temperature");
  });

  it("offers a surface once the evidence supports one", () => {
    const model = buildPlanetModel("trappist-1", "e", everything);
    expect(model.terrain).not.toBeNull();
    expect(model.terrainAbsentReason).toBeNull();
  });

  it("records an invented operator in warnings instead of obeying it", () => {
    const model = buildPlanetModel("trappist-1", "e", everything, {
      terrainProposal: { volcanism_by_narrative: { intensity: 1 } },
    });
    expect(model.terrain!.warnings.some((w) => w.kind === "unknown_operator")).toBe(true);
    expect(model.terrain!.operators.map((o) => o.op)).not.toContain("volcanism_by_narrative");
  });
});

describe("required fields fail loudly", () => {
  it("returns a value that exists in any layer", () => {
    const model = buildPlanetModel("trappist-1", "e", everything);
    expect(requireValue(model, "planet_radius")).toBeGreaterThan(0);
    expect(requireValue(model, "bulk_density")).toBeGreaterThan(0);
  });

  it("throws a typed error naming the field when nothing can supply it", () => {
    const model = buildPlanetModel("trappist-1", "e", everything);
    expect(() => requireValue(model, "surface_pressure")).toThrow(UnresolvedRequiredFieldError);
  });
});
