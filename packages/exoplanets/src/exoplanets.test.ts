import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARSEC } from "@aether/units";
import {
  ExoplanetFormatError,
  densityFromMassRadius,
  equilibriumTemperature,
  massFromRadius,
  parsePlanets,
  parseSystems,
  planetsOfSystem,
  radiusFromMass,
  resolvePlanet,
  semiMajorAxisFromPeriod,
  speculationFraction,
  systemPositionMetres,
  type CatalogNames,
} from "./index.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const ab = (name: string): ArrayBuffer => {
  const b = readFileSync(join(DATA, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const systems = parseSystems(ab("systems.bin"));
const planets = parsePlanets(ab("planets.bin"));
const names: CatalogNames = JSON.parse(readFileSync(join(DATA, "names.json"), "utf8"));

const systemIndex = (name: string): number => names.systems.indexOf(name);

describe("the map", () => {
  it("carries every confirmed system that can be positioned", () => {
    expect(systems.count).toBeGreaterThan(4_000);
    expect(planets.count).toBeGreaterThan(6_000);
    expect(names.systems).toHaveLength(systems.count);
    expect(names.planets).toHaveLength(planets.count);
  });

  it("is ordered by distance, nearest first", () => {
    for (let i = 1; i < systems.count; i++) {
      expect(systems.distancesPc[i]!).toBeGreaterThanOrEqual(systems.distancesPc[i - 1]!);
    }
  });

  it("puts Proxima Centauri nearest, at 1.30 pc", () => {
    // The true nearest system. Getting this wrong would mean the ordering or the parse is
    // broken, and it is also the row that exposed the TOP+ORDER BY trap in the archive's
    // TAP service.
    expect(names.systems[0]).toBe("Proxima Cen");
    expect(systems.distancesPc[0]!).toBeCloseTo(1.301, 2);
  });

  it("places systems at their true distance from the origin", () => {
    for (let i = 0; i < systems.count; i += 97) {
      const p = systemPositionMetres(systems, i);
      const r = Math.hypot(p.x, p.y, p.z) / PARSEC;
      expect(r).toBeCloseTo(systems.distancesPc[i]!, 1);
    }
  });

  it("spans the real range of known systems", () => {
    expect(systems.distancesPc[0]!).toBeLessThan(2);
    expect(systems.distancesPc[systems.count - 1]!).toBeGreaterThan(1_000);
  });

  it("groups each system's planets contiguously", () => {
    for (let i = 0; i < systems.count; i += 53) {
      const indices = planetsOfSystem(systems, i);
      expect(indices).toHaveLength(systems.planetCount[i]!);
      for (const p of indices) expect(p).toBeLessThan(planets.count);
    }
  });

  it("finds TRAPPIST-1 with seven planets", () => {
    const i = systemIndex("TRAPPIST-1");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(systems.planetCount[i]!).toBe(7);
    expect(systems.distancesPc[i]!).toBeCloseTo(12.47, 0);
  });

  it("keeps unmeasured values as NaN rather than zero", () => {
    // Zero is a legitimate eccentricity and a plausible temperature. NaN is not a
    // legitimate anything, which is exactly why it is the right sentinel: it cannot be
    // mistaken for a measurement.
    const missing = Array.from(planets.inclinationsDeg).filter((v) => Number.isNaN(v));
    expect(missing.length).toBeGreaterThan(1_000);
  });
});

describe("format errors fail loudly", () => {
  it("rejects wrong magic", () => {
    expect(() => parseSystems(new Uint8Array(64).buffer)).toThrow(ExoplanetFormatError);
  });

  it("rejects a planets buffer handed to the systems parser", () => {
    expect(() => parseSystems(ab("planets.bin"))).toThrow(/Bad magic/);
  });

  it("rejects truncation", () => {
    expect(() => parseSystems(ab("systems.bin").slice(0, 400))).toThrow(/declares/);
  });
});

describe("priors — filling what was never measured", () => {
  it("reproduces Earth from the Forecaster relation", () => {
    expect(radiusFromMass(1).value).toBeCloseTo(1.0, 1);
  });

  it("makes Jovian radius almost independent of mass", () => {
    // The Jovian exponent is negative: adding mass to a Jupiter makes it slightly smaller,
    // because it is supported by electron degeneracy rather than thermal pressure.
    const jupiter = radiusFromMass(317.8).value;
    const heavier = radiusFromMass(600).value;
    expect(heavier).toBeLessThan(jupiter);
    expect(heavier / jupiter).toBeGreaterThan(0.95);
  });

  it("rates mass-from-radius as less reliable than radius-from-mass", () => {
    // Inverting a nearly flat relation amplifies error enormously, and the confidence must
    // say so rather than treating the two directions as equivalent.
    expect(massFromRadius(11.2).confidence).toBeLessThan(radiusFromMass(317.8).confidence);
  });

  it("never labels a prior as a measurement", () => {
    for (const v of [radiusFromMass(5), massFromRadius(2)]) {
      expect(v.method).toBe("population_prior");
      expect(v.confidence).toBeLessThan(0.5);
      expect(v.scatterFactor).toBeGreaterThan(1);
    }
  });

  it("recovers Earth's orbit from Kepler's third law", () => {
    expect(semiMajorAxisFromPeriod(365.25, 1.0).value).toBeCloseTo(1.0, 3);
  });

  it("recovers Earth's equilibrium temperature", () => {
    // Sun is log10(L/Lsun) = 0. Published T_eq for Earth at A=0.3 is 254 K.
    expect(equilibriumTemperature(0, 1.0, 0.3).value).toBeCloseTo(254, -1);
  });

  it("treats stellar luminosity as a logarithm, not a ratio", () => {
    // The archive stores log10(L/Lsun). Reading it as linear would make the Sun a
    // zero-luminosity star and every temperature absolute zero — a mistake that fails
    // silently because the result is merely wrong, not absurd.
    expect(equilibriumTemperature(0, 1.0).value).toBeGreaterThan(200);
    expect(equilibriumTemperature(1, 1.0).value).toBeGreaterThan(
      equilibriumTemperature(0, 1.0).value,
    );
  });

  it("recovers Earth's bulk density", () => {
    expect(densityFromMassRadius(1, 1).value).toBeCloseTo(5.51, 1);
  });

  it("treats a transiting planet's inclination as an inference, not a guess", () => {
    const transit = resolvePlanet(
      { radiusEarth: 1, massEarth: 1, periodDays: 365, semiMajorAu: 1,
        eccentricity: 0.01, inclinationDeg: NaN, eqTempK: 288, densityGcc: 5.5,
        discoveredByTransit: true },
      { teff: 5772, radiusSun: 1, massSun: 1, logLuminosity: 0 },
    );
    // It transits, so it must be near edge-on. That is real information.
    expect(transit.inclinationDeg.method).toBe("derived");
    expect(transit.inclinationDeg.confidence).toBeGreaterThan(0.5);

    const rv = resolvePlanet(
      { radiusEarth: 1, massEarth: 1, periodDays: 365, semiMajorAu: 1,
        eccentricity: 0.01, inclinationDeg: NaN, eqTempK: 288, densityGcc: 5.5,
        discoveredByTransit: false },
      { teff: 5772, radiusSun: 1, massSun: 1, logLuminosity: 0 },
    );
    // Radial velocity measures M·sin(i) and cannot separate the two. Confidence zero.
    expect(rv.inclinationDeg.method).toBe("default_prior");
    expect(rv.inclinationDeg.confidence).toBe(0);
  });
});

describe("the resolver never overwrites a measurement", () => {
  const star = { teff: 5772, radiusSun: 1, massSun: 1, logLuminosity: 0 };

  it("keeps every measured field measured", () => {
    const r = resolvePlanet(
      { radiusEarth: 2.1, massEarth: 6.4, periodDays: 12.3, semiMajorAu: 0.1,
        eccentricity: 0.05, inclinationDeg: 88, eqTempK: 500, densityGcc: 3.8,
        discoveredByTransit: true },
      star,
    );
    expect(r.completeness).toBe(1);
    for (const f of [r.radiusEarth, r.massEarth, r.periodDays, r.eqTempK]) {
      expect(f.method).toBe("measured");
    }
    expect(r.radiusEarth.value).toBe(2.1);
  });

  it("fills a missing radius from mass, and marks it", () => {
    const r = resolvePlanet(
      { radiusEarth: NaN, massEarth: 5, periodDays: 20, semiMajorAu: NaN,
        eccentricity: NaN, inclinationDeg: NaN, eqTempK: NaN, densityGcc: NaN,
        discoveredByTransit: false },
      star,
    );
    expect(r.radiusEarth.method).toBe("population_prior");
    expect(Number.isFinite(r.radiusEarth.value)).toBe(true);
    // Everything downstream inherits the uncertainty.
    expect(r.completeness).toBeLessThan(0.3);
  });

  it("chains derivations: period -> axis -> temperature", () => {
    const r = resolvePlanet(
      { radiusEarth: 1, massEarth: 1, periodDays: 365.25, semiMajorAu: NaN,
        eccentricity: NaN, inclinationDeg: NaN, eqTempK: NaN, densityGcc: NaN,
        discoveredByTransit: true },
      star,
    );
    expect(r.semiMajorAu.method).toBe("derived");
    expect(r.semiMajorAu.value).toBeCloseTo(1.0, 2);
    expect(r.eqTempK.method).toBe("derived");
    expect(r.eqTempK.value).toBeCloseTo(254, -1);
  });

  it("admits ignorance rather than inventing", () => {
    const r = resolvePlanet(
      { radiusEarth: NaN, massEarth: NaN, periodDays: NaN, semiMajorAu: NaN,
        eccentricity: NaN, inclinationDeg: NaN, eqTempK: NaN, densityGcc: NaN,
        discoveredByTransit: false },
      { teff: NaN, radiusSun: NaN, massSun: NaN, logLuminosity: NaN },
    );
    expect(Number.isNaN(r.radiusEarth.value)).toBe(true);
    expect(r.radiusEarth.method).toBe("default_prior");
    expect(r.completeness).toBe(0);
  });
});

describe("speculation tracks the evidence", () => {
  const star = { teff: 5772, radiusSun: 1, massSun: 1, logLuminosity: 0 };

  it("is low for a fully measured planet and high for a bare one", () => {
    const measured = speculationFraction(
      resolvePlanet(
        { radiusEarth: 1, massEarth: 1, periodDays: 365, semiMajorAu: 1,
          eccentricity: 0.02, inclinationDeg: 89, eqTempK: 254, densityGcc: 5.5,
          discoveredByTransit: true },
        star,
      ),
    );
    const bare = speculationFraction(
      resolvePlanet(
        { radiusEarth: NaN, massEarth: 5, periodDays: NaN, semiMajorAu: NaN,
          eccentricity: NaN, inclinationDeg: NaN, eqTempK: NaN, densityGcc: NaN,
          discoveredByTransit: false },
        star,
      ),
    );
    expect(bare).toBeGreaterThan(measured);
  });

  it("never reaches zero, because no exoplanet surface has been resolved", () => {
    const perfect = speculationFraction(
      resolvePlanet(
        { radiusEarth: 1, massEarth: 1, periodDays: 365, semiMajorAu: 1,
          eccentricity: 0.02, inclinationDeg: 89, eqTempK: 254, densityGcc: 5.5,
          discoveredByTransit: true },
        star,
      ),
    );
    expect(perfect).toBeGreaterThanOrEqual(0.15);
  });
});

describe("real systems resolve sensibly", () => {
  it("resolves every planet in the catalogue without throwing", () => {
    let resolved = 0;
    let fullyMeasured = 0;

    for (let s = 0; s < systems.count; s++) {
      const star = {
        teff: systems.effectiveTemperatures[s]!,
        radiusSun: systems.stellarRadiiSun[s]!,
        massSun: systems.stellarMassesSun[s]!,
        logLuminosity: systems.logLuminosities[s]!,
      };
      for (const p of planetsOfSystem(systems, s)) {
        const r = resolvePlanet(
          {
            radiusEarth: planets.radiiEarth[p]!,
            massEarth: planets.massesEarth[p]!,
            periodDays: planets.periodsDays[p]!,
            semiMajorAu: planets.semiMajorAxesAu[p]!,
            eccentricity: planets.eccentricities[p]!,
            inclinationDeg: planets.inclinationsDeg[p]!,
            eqTempK: planets.equilibriumTemperatures[p]!,
            densityGcc: planets.densitiesGcc[p]!,
            discoveredByTransit: planets.discoveryMethods[p] === 0,
          },
          star,
        );
        resolved++;
        if (r.completeness === 1) fullyMeasured++;
      }
    }

    expect(resolved).toBe(planets.count);
    // A meaningful fraction of the catalogue is fully measured; most is not, which is the
    // entire reason the prior chain exists.
    expect(fullyMeasured).toBeGreaterThan(500);
    expect(fullyMeasured).toBeLessThan(planets.count);
  });
});
