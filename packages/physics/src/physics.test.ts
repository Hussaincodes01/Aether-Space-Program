import { describe, expect, it } from "vitest";
import {
  astronomicalUnits,
  earthMasses,
  earthRadii,
  solarRadii,
  toGramsPerCubicCentimetre,
} from "@aether/units";
import {
  DEFAULT_BOND_ALBEDO,
  DomainError,
  FULL_REDISTRIBUTION,
  bulkDensity,
  equilibriumTemperature,
  escapeVelocity,
  evaluate,
  formulaIds,
  habitableZone,
  habitableZoneBounds,
  habitableZonePosition,
  jeansParameter,
  retentionVerdict,
  stellarColor,
  surfaceGravity,
} from "./index.js";

/** TRAPPIST-1 e, from the published parameters the MVP catalog will ingest. */
const T1e = {
  starTeff: 2566,
  starRadius: solarRadii(0.1192),
  starLuminositySolar: 0.000553,
  axis: astronomicalUnits(0.02925),
  mass: earthMasses(0.692),
  radius: earthRadii(0.92),
};

const confident = { massConfidence: 0.9, radiusConfidence: 0.9 };

describe("agreement with published values", () => {
  it("reproduces TRAPPIST-1e equilibrium temperature", () => {
    // Published zero-albedo T_eq for TRAPPIST-1e is ~249 K.
    const result = evaluate(equilibriumTemperature, {
      starEffectiveTemperatureK: T1e.starTeff,
      starRadiusM: T1e.starRadius,
      semimajorAxisM: T1e.axis,
      bondAlbedo: 0,
      bondAlbedoIsMeasured: false,
      redistributionFactor: FULL_REDISTRIBUTION,
      starTempConfidence: 0.95,
      starRadiusConfidence: 0.94,
      axisConfidence: 0.93,
    });
    expect(result.value).toBeGreaterThan(245);
    expect(result.value).toBeLessThan(255);
  });

  it("reproduces TRAPPIST-1e surface gravity", () => {
    // Published ~8.0 m/s^2.
    const g = evaluate(surfaceGravity, { massKg: T1e.mass, radiusM: T1e.radius, ...confident });
    expect(g.value).toBeCloseTo(8.0, 1);
  });

  it("computes a rocky bulk density", () => {
    const rho = evaluate(bulkDensity, { massKg: T1e.mass, radiusM: T1e.radius, ...confident });
    const gcc = toGramsPerCubicCentimetre(rho.value);
    // Rocky, comparable to Earth's 5.51 g/cm^3.
    expect(gcc).toBeGreaterThan(4);
    expect(gcc).toBeLessThan(6);
  });

  it("puts TRAPPIST-1e in the conservative habitable zone", () => {
    const bounds = habitableZoneBounds({
      luminositySolar: T1e.starLuminositySolar,
      effectiveTemperatureK: T1e.starTeff,
      luminosityConfidence: 0.9,
      temperatureConfidence: 0.95,
    });
    expect(habitableZonePosition(T1e.axis, bounds)).toBe("conservative");
    // The optimistic zone must always enclose the conservative one.
    expect(bounds.recentVenusM).toBeLessThan(bounds.runawayGreenhouseM);
    expect(bounds.earlyMarsM).toBeGreaterThan(bounds.maximumGreenhouseM);
  });
});

describe("property tests (PRD §9)", () => {
  const teqAt = (axisAu: number): number =>
    evaluate(equilibriumTemperature, {
      starEffectiveTemperatureK: T1e.starTeff,
      starRadiusM: T1e.starRadius,
      semimajorAxisM: astronomicalUnits(axisAu),
      bondAlbedo: DEFAULT_BOND_ALBEDO,
      bondAlbedoIsMeasured: false,
      redistributionFactor: FULL_REDISTRIBUTION,
      starTempConfidence: 1,
      starRadiusConfidence: 1,
      axisConfidence: 1,
    }).value;

  it("equilibrium temperature decreases monotonically with semimajor axis", () => {
    const axes = [0.01, 0.02, 0.05, 0.1, 0.5, 1, 2, 5];
    const temps = axes.map(teqAt);
    for (let i = 1; i < temps.length; i++) {
      expect(temps[i]!).toBeLessThan(temps[i - 1]!);
    }
  });

  it("equilibrium temperature falls as albedo rises", () => {
    const at = (albedo: number): number =>
      evaluate(equilibriumTemperature, {
        starEffectiveTemperatureK: 5772,
        starRadiusM: solarRadii(1),
        semimajorAxisM: astronomicalUnits(1),
        bondAlbedo: albedo,
        bondAlbedoIsMeasured: false,
        redistributionFactor: FULL_REDISTRIBUTION,
        starTempConfidence: 1,
        starRadiusConfidence: 1,
        axisConfidence: 1,
      }).value;
    expect(at(0.6)).toBeLessThan(at(0.3));
    expect(at(0.3)).toBeLessThan(at(0));
  });

  it("escape velocity rises with mass and falls with radius", () => {
    const base = evaluate(escapeVelocity, {
      massKg: earthMasses(1),
      radiusM: earthRadii(1),
      ...confident,
    }).value;
    // Earth's escape velocity is 11.19 km/s — a useful sanity anchor.
    expect(base / 1000).toBeCloseTo(11.19, 1);

    const heavier = evaluate(escapeVelocity, {
      massKg: earthMasses(2),
      radiusM: earthRadii(1),
      ...confident,
    }).value;
    const larger = evaluate(escapeVelocity, {
      massKg: earthMasses(1),
      radiusM: earthRadii(2),
      ...confident,
    }).value;
    expect(heavier).toBeGreaterThan(base);
    expect(larger).toBeLessThan(base);
  });
});

describe("provenance discipline", () => {
  it("caps confidence at the weakest input, never the average", () => {
    const result = evaluate(bulkDensity, {
      massKg: T1e.mass,
      radiusM: T1e.radius,
      massConfidence: 0.3,
      radiusConfidence: 0.95,
    });
    // Averaging would give 0.62 and let a well-measured radius launder a poor mass.
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it("records an assumption when Bond albedo is not measured", () => {
    const result = evaluate(equilibriumTemperature, {
      starEffectiveTemperatureK: T1e.starTeff,
      starRadiusM: T1e.starRadius,
      semimajorAxisM: T1e.axis,
      bondAlbedo: DEFAULT_BOND_ALBEDO,
      bondAlbedoIsMeasured: false,
      redistributionFactor: FULL_REDISTRIBUTION,
      starTempConfidence: 1,
      starRadiusConfidence: 1,
      axisConfidence: 1,
    });
    const albedo = result.assumptions.find((a) => a.parameter === "bondAlbedo");
    expect(albedo).toBeDefined();
    expect(albedo?.userAdjustable).toBe(true);
    // An assumed input must drag confidence down even when every measurement is excellent.
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it("names its inputs so the inspector can walk the chain", () => {
    const g = evaluate(surfaceGravity, { massKg: T1e.mass, radiusM: T1e.radius, ...confident });
    expect(g.inputsUsed).toContain("planet.massKg");
    expect(g.formulaId).toBe("surface_gravity");
  });
});

describe("domain enforcement", () => {
  it("refuses the habitable zone parameterisation outside its fitted range", () => {
    // Kopparapu was fitted over 2600-7200 K. A 2000 K brown dwarf is out of domain, and a
    // quietly extrapolated answer would be worse than no answer.
    expect(() =>
      evaluate(habitableZone, {
        luminositySolar: 0.0001,
        effectiveTemperatureK: 2000,
        luminosityConfidence: 1,
        temperatureConfidence: 1,
      }),
    ).toThrow(DomainError);
  });

  it("refuses a Bond albedo of 1", () => {
    expect(() =>
      evaluate(equilibriumTemperature, {
        starEffectiveTemperatureK: 5772,
        starRadiusM: solarRadii(1),
        semimajorAxisM: astronomicalUnits(1),
        bondAlbedo: 1,
        bondAlbedoIsMeasured: false,
        redistributionFactor: FULL_REDISTRIBUTION,
        starTempConfidence: 1,
        starRadiusConfidence: 1,
        axisConfidence: 1,
      }),
    ).toThrow(DomainError);
  });
});

describe("atmospheric retention", () => {
  it("lets a hot small body lose hydrogen while a cold large one keeps it", () => {
    const lambda = (massEarth: number, radiusEarth: number, tExo: number): number =>
      evaluate(jeansParameter, {
        massKg: earthMasses(massEarth),
        radiusM: earthRadii(radiusEarth),
        exobaseTemperatureK: tExo,
        speciesMassAmu: 2.016,
        exobaseTemperatureIsMeasured: false,
        ...confident,
      }).value;

    expect(retentionVerdict(lambda(0.1, 0.5, 1500))).toBe("escapes");
    expect(retentionVerdict(lambda(5, 1.5, 300))).toBe("retained");
  });
});

describe("stellar colour", () => {
  it("makes an M-dwarf red and a hot star blue", () => {
    const mDwarf = stellarColor(2566).linear;
    const hot = stellarColor(12000).linear;
    expect(mDwarf.r).toBeGreaterThan(mDwarf.b);
    expect(hot.b).toBeGreaterThan(hot.r);
  });

  it("keeps the Sun near-white", () => {
    const sun = stellarColor(5772).linear;
    expect(Math.abs(sun.r - sun.b)).toBeLessThan(0.35);
  });

  it("stays in gamut", () => {
    for (const t of [1700, 2566, 3500, 5772, 9000, 20000]) {
      const { linear } = stellarColor(t);
      for (const channel of [linear.r, linear.g, linear.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("registry", () => {
  it("registers every formula under a unique id", () => {
    const ids = formulaIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("equilibrium_temperature");
    expect(ids).toContain("blackbody_to_srgb");
  });
});
