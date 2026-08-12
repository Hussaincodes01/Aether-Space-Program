import { describe, expect, it } from "vitest";
import { AU, DAY, JULIAN_YEAR, toAstronomicalUnits } from "@aether/units";
import { compileTerrainProgram, evaluateTerrain } from "@aether/terrain";
import {
  EARTH,
  JUPITER,
  MARS,
  MERCURY,
  MOON,
  NEPTUNE,
  SATURN,
  SOLAR_SYSTEM,
  SUN,
  SUN_GM,
  URANUS,
  VENUS,
  equilibriumTemperature,
  multiplyMat3,
  orbitalPeriod,
  perifocalToEcliptic,
  radiogenicHeating,
  rotationX,
  rotationZ,
  sampleOrbit,
  solveKepler,
  stateAt,
  surfaceGravity,
  terrestrialBodies,
  toPlanetContext,
  transform,
  type SolarBody,
} from "./index.js";

const days = (s: number): number => s / DAY;

describe("orbital periods match the published values", () => {
  /**
   * The most falsifiable check in the package: if the elements or the solver are wrong,
   * these fail immediately and unmistakably.
   *
   * Tolerances are relative, and looser for the giants for a real reason rather than to
   * make the test pass. Published sidereal periods are long-term means that include mutual
   * planetary perturbations; a pure two-body Kepler solution from osculating J2000 elements
   * cannot reproduce those to better than about 0.1% for the outer planets. That gap is a
   * known limit of the approximate element set, not a defect here — and the fix, if it ever
   * matters, is a real ephemeris such as SPICE rather than a tighter tolerance.
   */
  const expected: Array<[SolarBody, number, number]> = [
    [MERCURY, 87.969, 1e-4],
    [VENUS, 224.701, 1e-4],
    [EARTH, 365.256, 1e-4],
    [MARS, 686.98, 1e-4],
    [JUPITER, 4332.589, 1e-3],
    [SATURN, 10759.22, 1e-3],
    [URANUS, 30685.4, 1e-3],
    [NEPTUNE, 60189.0, 1e-3],
  ];

  for (const [body, expectedDays, relativeTolerance] of expected) {
    it(`${body.name}: ${expectedDays} days`, () => {
      const actual = days(orbitalPeriod(body.elements!));
      const error = Math.abs(actual - expectedDays) / expectedDays;
      expect(error, `${actual.toFixed(2)} d vs ${expectedDays} d`).toBeLessThan(
        relativeTolerance,
      );
    });
  }

  it("needs the planet's own mass to get Jupiter right", () => {
    // Omitting it - using GM_sun rather than G(M_sun + m) - puts Jupiter's period out by
    // about two days. This asserts the term is actually present.
    const withMass = orbitalPeriod(JUPITER.elements!);
    const withoutMass = orbitalPeriod({ ...JUPITER.elements!, gravitationalParameter: SUN_GM });
    expect(days(withoutMass) - days(withMass)).toBeGreaterThan(1.5);
  });

  it("Moon: 27.32 days sidereal", () => {
    expect(days(orbitalPeriod(MOON.elements!))).toBeCloseTo(27.32, 1);
  });

  it("Earth's year is one Julian year to within a day", () => {
    expect(Math.abs(orbitalPeriod(EARTH.elements!) - JULIAN_YEAR)).toBeLessThan(DAY);
  });
});

describe("Kepler's equation", () => {
  it("satisfies M = E - e sin E", () => {
    for (const e of [0, 0.05, 0.2, 0.5, 0.9]) {
      for (let i = 0; i < 24; i++) {
        const M = (i / 24) * 2 * Math.PI - Math.PI;
        const E = solveKepler(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 9);
      }
    }
  });

  it("is exact for a circular orbit", () => {
    expect(solveKepler(1.234, 0)).toBeCloseTo(1.234, 12);
  });

  it("converges at high eccentricity, where E ~ M diverges", () => {
    // Comets, not planets — but returning a silently unconverged answer would be worse
    // than being slow, so the fallback starting guess is worth testing.
    const E = solveKepler(0.1, 0.95);
    expect(E - 0.95 * Math.sin(E)).toBeCloseTo(0.1, 8);
  });
});

describe("rotation matrices", () => {
  const isOrthonormal = (m: readonly number[]): void => {
    // Columns must be unit length and mutually perpendicular, or the transform stretches
    // the orbit rather than merely orienting it.
    for (let c = 0; c < 3; c++) {
      const col = [m[c]!, m[3 + c]!, m[6 + c]!];
      expect(Math.hypot(...col)).toBeCloseTo(1, 12);
    }
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      const dot =
        m[a!]! * m[b!]! + m[3 + a!]! * m[3 + b!]! + m[6 + a!]! * m[6 + b!]!;
      expect(dot).toBeCloseTo(0, 12);
    }
  };

  it("Rz and Rx are orthonormal", () => {
    isOrthonormal(rotationZ(0.7));
    isOrthonormal(rotationX(-1.3));
  });

  it("stays orthonormal after composition", () => {
    isOrthonormal(multiplyMat3(rotationZ(0.4), rotationX(1.1)));
    for (const body of SOLAR_SYSTEM) {
      if (body.elements) isOrthonormal(perifocalToEcliptic(body.elements));
    }
  });

  it("rotates about the right axis", () => {
    // Rz leaves +z alone and takes +x toward +y.
    const rotated = transform(rotationZ(Math.PI / 2), { x: 1, y: 0, z: 0 });
    expect(rotated.x).toBeCloseTo(0, 12);
    expect(rotated.y).toBeCloseTo(1, 12);

    const axis = transform(rotationZ(0.9), { x: 0, y: 0, z: 1 });
    expect(axis.z).toBeCloseTo(1, 12);
  });
});

describe("positions", () => {
  it("keeps Earth between perihelion and aphelion all year", () => {
    // 0.9833 AU to 1.0167 AU.
    const elements = EARTH.elements!;
    const period = orbitalPeriod(elements);
    for (let i = 0; i < 40; i++) {
      const { position } = stateAt(elements, (i / 40) * period);
      const r = toAstronomicalUnits(Math.hypot(position.x, position.y, position.z) as never);
      expect(r).toBeGreaterThan(0.982);
      expect(r).toBeLessThan(1.018);
    }
  });

  it("reproduces each planet's perihelion and aphelion", () => {
    for (const body of SOLAR_SYSTEM) {
      if (!body.elements || body.parentId !== "sun") continue;
      const { semiMajorAxisM: a, eccentricity: e } = body.elements;
      const period = orbitalPeriod(body.elements);

      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 400; i++) {
        const { position } = stateAt(body.elements, (i / 400) * period);
        const r = Math.hypot(position.x, position.y, position.z);
        min = Math.min(min, r);
        max = Math.max(max, r);
      }

      expect(min / (a * (1 - e))).toBeCloseTo(1, 2);
      expect(max / (a * (1 + e))).toBeCloseTo(1, 2);
    }
  });

  it("returns to its starting point after one period", () => {
    const elements = MARS.elements!;
    const start = stateAt(elements, 0).position;
    const later = stateAt(elements, orbitalPeriod(elements)).position;
    const drift = Math.hypot(start.x - later.x, start.y - later.y, start.z - later.z);
    // Well under a planetary radius after a full 687-day orbit.
    expect(drift).toBeLessThan(1e6);
  });

  it("orders the planets correctly outward from the Sun", () => {
    const order = [MERCURY, VENUS, EARTH, MARS, JUPITER, SATURN, URANUS, NEPTUNE];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.elements!.semiMajorAxisM).toBeGreaterThan(
        order[i - 1]!.elements!.semiMajorAxisM,
      );
    }
  });

  it("puts the Moon at roughly 384,400 km from Earth", () => {
    const period = orbitalPeriod(MOON.elements!);
    for (let i = 0; i < 20; i++) {
      const { position } = stateAt(MOON.elements!, (i / 20) * period);
      const r = Math.hypot(position.x, position.y, position.z) / 1000;
      expect(r).toBeGreaterThan(362_000);
      expect(r).toBeLessThan(406_000);
    }
  });

  it("samples a closed orbit path", () => {
    const points = sampleOrbit(EARTH.elements!, 64);
    expect(points).toHaveLength(65);
    const first = points[0]!;
    const last = points[64]!;
    expect(Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z)).toBeLessThan(1e3);
  });
});

describe("derived physical values match measurements", () => {
  it("reproduces surface gravity", () => {
    expect(surfaceGravity(EARTH)).toBeCloseTo(9.80, 1);
    expect(surfaceGravity(MARS)).toBeCloseTo(3.72, 1);
    expect(surfaceGravity(MOON)).toBeCloseTo(1.62, 1);
  });

  it("reproduces equilibrium temperatures", () => {
    // Published: Earth 254 K, Mars 210 K, Venus 227 K.
    expect(equilibriumTemperature(EARTH)).toBeCloseTo(254, -1);
    expect(equilibriumTemperature(MARS)).toBeCloseTo(210, -1);
    expect(equilibriumTemperature(VENUS)).toBeCloseTo(228, -1);
  });

  it("shows the greenhouse effect as the gap between equilibrium and surface", () => {
    // Venus is the extreme case: 227 K equilibrium, 737 K surface. This is not a bug in
    // T_eq — it is the reason T_eq must never be presented as a surface temperature.
    expect(VENUS.surfaceTemperatureK - equilibriumTemperature(VENUS)).toBeGreaterThan(450);
    expect(EARTH.surfaceTemperatureK - equilibriumTemperature(EARTH)).toBeCloseTo(33, -1);
  });

  it("reproduces radiogenic heat flux for the Moon and Mars", () => {
    // Measured/modelled: Moon ~0.018 W/m2, Mars ~0.03 W/m2.
    expect(radiogenicHeating(MOON)).toBeGreaterThan(0.005);
    expect(radiogenicHeating(MOON)).toBeLessThan(0.03);
    expect(radiogenicHeating(MARS)).toBeGreaterThan(0.015);
    expect(radiogenicHeating(MARS)).toBeLessThan(0.06);
    expect(radiogenicHeating(EARTH)).toBeCloseTo(0.087, 2);
  });
});

/**
 * The validation that actually matters.
 *
 * We have maps of these worlds. If the operator gates are sound, feeding real parameters in
 * should reproduce their character — and if it does not, the rules are wrong in a way no
 * amount of exoplanet work would ever reveal.
 */
describe("the generator reproduces worlds we have actually visited", () => {
  const enabledOn = (body: SolarBody): string[] =>
    compileTerrainProgram({ context: toPlanetContext(body), seed: `sha256:${body.id}` })
      .operators.map((o) => o.op);

  it("gives the Moon craters, and no water, wind or ice erosion", () => {
    const ops = enabledOn(MOON);
    expect(ops).toContain("impact_population");
    expect(ops).not.toContain("fluvial_erosion");
    expect(ops).not.toContain("aeolian_transport");
  });

  it("gives Mars dunes and craters but no rivers today", () => {
    // Mars has the largest dune fields in the Solar System at 6 mbar, and valley networks
    // that are ancient — liquid water is not stable there now, and the gate must say so.
    const ops = enabledOn(MARS);
    expect(ops).toContain("aeolian_transport");
    expect(ops).toContain("impact_population");
    expect(ops).not.toContain("fluvial_erosion");
  });

  it("gives Earth rivers, dunes and ice", () => {
    const ops = enabledOn(EARTH);
    expect(ops).toEqual(
      expect.arrayContaining(["fluvial_erosion", "aeolian_transport", "glacial_erosion"]),
    );
  });

  it("refuses Jupiter a solid surface", () => {
    // Bulk density 1326 kg/m3. There is nothing to stand on, and the gate must not invent it.
    const ops = enabledOn(JUPITER);
    expect(ops).not.toContain("reference_ellipsoid");
    expect(ops).not.toContain("impact_population");
  });

  it("retains craters better on the Moon than on Earth", () => {
    const density = (body: SolarBody): number =>
      compileTerrainProgram({ context: toPlanetContext(body), seed: "s" })
        .operators.find((o) => o.op === "impact_population")?.params.density ?? 0;
    expect(density(MOON)).toBeGreaterThan(density(EARTH));
  });

  it("produces plausible relief on Mars", () => {
    const context = toPlanetContext(MARS);
    const program = compileTerrainProgram({ context, seed: "sha256:mars" });
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 600; i++) {
      const y = 1 - (i / 599) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = Math.PI * (3 - Math.sqrt(5)) * i;
      const { heightM } = evaluateTerrain(
        program,
        { x: Math.cos(t) * r, y, z: Math.sin(t) * r },
        { radiusM: context.radiusM },
      );
      min = Math.min(min, heightM);
      max = Math.max(max, heightM);
    }
    // Mars's true range is about 30 km, Olympus Mons to Hellas. Same order of magnitude.
    expect(max - min).toBeGreaterThan(2_000);
    expect(max - min).toBeLessThan(60_000);
  });

  it("selects only bodies with a solid surface for terrain", () => {
    const ids = terrestrialBodies().map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["mercury", "venus", "earth", "moon", "mars"]));
    expect(ids).not.toContain("jupiter");
    expect(ids).not.toContain("saturn");
    expect(ids).not.toContain("sun");
  });
});

describe("data sanity", () => {
  it("gives every body a positive radius, mass and description", () => {
    for (const body of SOLAR_SYSTEM) {
      expect(body.radiusM, body.id).toBeGreaterThan(0);
      expect(body.massKg, body.id).toBeGreaterThan(0);
      expect(body.blurb.length, body.id).toBeGreaterThan(10);
    }
  });

  it("gives every body except the Sun a parent and elements", () => {
    for (const body of SOLAR_SYSTEM) {
      if (body.id === "sun") {
        expect(body.elements).toBeUndefined();
      } else {
        expect(body.parentId, body.id).toBeTruthy();
        expect(body.elements, body.id).toBeDefined();
      }
    }
  });

  it("records Venus and Uranus as retrograde", () => {
    expect(VENUS.rotationPeriodS).toBeLessThan(0);
    expect(URANUS.rotationPeriodS).toBeLessThan(0);
    expect(EARTH.rotationPeriodS).toBeGreaterThan(0);
  });

  it("puts the Sun at the origin with no orbit", () => {
    expect(SUN.parentId).toBeUndefined();
    expect(SUN.radiusM / AU).toBeLessThan(0.01);
  });
});
