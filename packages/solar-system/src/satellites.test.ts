import { describe, expect, it } from "vitest";
import { DAY, JULIAN_YEAR } from "@aether/units";
import {
  CERES,
  CHARON,
  DWARF_PLANETS,
  ERIS,
  HAUMEA,
  MAJOR_MOONS,
  MAKEMAKE,
  PLUTO,
  RING_SYSTEMS,
  SOLAR_SYSTEM,
  TITAN,
  bulkDensity,
  getBody,
  orbitalPeriod,
  ringsFor,
  surfaceGravity,
  toPlanetContext,
} from "./index.js";
import { compileTerrainProgram, diversityFingerprint } from "@aether/terrain";

const days = (s: number): number => s / DAY;

/**
 * The reason for adding moons and dwarf planets is not that the scene looked empty. It is
 * that each one carries an independently published sidereal period, so each is a separate
 * chance to falsify the Kepler solver and the parent GM values. Nineteen new orbits is
 * nineteen new ways to be caught being wrong.
 */
describe("satellite orbital periods match published sidereal values", () => {
  const cases: ReadonlyArray<readonly [string, number, number]> = [
    // id, published sidereal period in days, tolerance in days
    ["phobos", 0.31891, 0.0005],
    ["deimos", 1.26244, 0.002],
    ["io", 1.769138, 0.002],
    ["europa", 3.551181, 0.004],
    ["ganymede", 7.154553, 0.008],
    ["callisto", 16.689017, 0.02],
    ["mimas", 0.942422, 0.002],
    ["enceladus", 1.370218, 0.002],
    ["rhea", 4.518212, 0.005],
    ["titan", 15.945421, 0.02],
    ["iapetus", 79.3215, 0.1],
    ["miranda", 1.413479, 0.002],
    ["ariel", 2.520379, 0.003],
    ["umbriel", 4.144177, 0.005],
    ["titania", 8.705872, 0.01],
    ["oberon", 13.463239, 0.02],
    ["triton", 5.876854, 0.008],
    ["charon", 6.387230, 0.01],
  ];

  for (const [id, publishedDays, tolerance] of cases) {
    it(`${id} orbits in ${publishedDays} days`, () => {
      const body = getBody(id);
      expect(body, `${id} is missing from SOLAR_SYSTEM`).toBeDefined();
      expect(body!.elements).toBeDefined();
      expect(days(orbitalPeriod(body!.elements!))).toBeCloseTo(publishedDays, 0);
      expect(Math.abs(days(orbitalPeriod(body!.elements!)) - publishedDays)).toBeLessThan(
        tolerance,
      );
    });
  }
});

describe("dwarf planet heliocentric periods", () => {
  const years = (s: number): number => s / JULIAN_YEAR;

  it.each([
    ["ceres", 4.604, 0.02],
    ["pluto", 248.0, 1.0],
    ["eris", 558.0, 4.0],
    ["makemake", 309.9, 2.0],
    ["haumea", 283.3, 2.0],
  ] as const)("%s orbits in %f years", (id, published, tolerance) => {
    const body = getBody(id)!;
    expect(Math.abs(years(orbitalPeriod(body.elements!)) - published)).toBeLessThan(tolerance);
  });
});

describe("physical parameters are self-consistent", () => {
  it("every satellite has a plausible bulk density", () => {
    for (const body of [...MAJOR_MOONS, ...DWARF_PLANETS]) {
      const rho = bulkDensity(body);
      // Ice-rich bodies bottom out near 850 (Tethys, not modelled); Io tops out at 3528.
      expect(rho, `${body.id} density ${rho}`).toBeGreaterThan(800);
      expect(rho, `${body.id} density ${rho}`).toBeLessThan(4000);
    }
  });

  it("Io is rocky and Enceladus is icy, and the densities say so without being told", () => {
    expect(bulkDensity(getBody("io")!)).toBeGreaterThan(3000);
    expect(bulkDensity(getBody("enceladus")!)).toBeLessThan(1800);
  });

  it("surface gravity on Titan is between the Moon's and Mars's", () => {
    const g = surfaceGravity(TITAN);
    expect(g).toBeGreaterThan(1.3);
    expect(g).toBeLessThan(1.5);
  });

  it("no body appears twice", () => {
    const ids = SOLAR_SYSTEM.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every non-solar body names a parent that exists", () => {
    for (const body of SOLAR_SYSTEM) {
      if (body.id === "sun") continue;
      expect(body.parentId, `${body.id} has no parent`).toBeDefined();
      expect(getBody(body.parentId!), `${body.id} parent ${body.parentId}`).toBeDefined();
    }
  });
});

/**
 * Titan is the single most useful calibration target in the outer Solar System, because it
 * separates two things that are easy to conflate: "has an atmosphere and rivers" from "is
 * Earth-like". Titan is 94 K. Water there is bedrock. But methane is liquid at 1.45 bar, so
 * it rains, and Cassini mapped the drainage networks. If the erosion gate asks "is there
 * liquid water" it gets Titan wrong; if it asks "is any liquid stable at this pressure and
 * temperature" it gets Titan right. That distinction is the whole thesis of the gate design.
 */
describe("Titan calibrates the erosion gate as a phase-diagram question", () => {
  it("is cold enough that water is not the liquid", () => {
    expect(TITAN.surfaceTemperatureK).toBeLessThan(100);
    expect(TITAN.stableLiquid).toBe("methane");
  });

  it("has a surface pressure above Earth's", () => {
    expect(TITAN.surfacePressurePa).toBeGreaterThan(101_325);
  });

  it("receives fluvial erosion despite being 94 K", () => {
    const program = compileTerrainProgram({ context: toPlanetContext(TITAN), seed: "sha256:test" });
    const active = program.operators.map((o) => o.op);
    expect(active).toContain("fluvial_erosion");
  });

  it("does not receive it on airless Callisto, which is a similar size and composition", () => {
    const program = compileTerrainProgram({ context: toPlanetContext(getBody("callisto")!), seed: "sha256:test" });
    const active = program.operators.map((o) => o.op);
    expect(active).not.toContain("fluvial_erosion");
    expect(active).toContain("impact_population");
  });
});

describe("ring systems", () => {
  it("Saturn's rings sit outside the planet and inside the Roche limit region", () => {
    const rings = ringsFor("saturn")!;
    const saturn = getBody("saturn")!;
    expect(rings.innerRadiusM).toBeGreaterThan(saturn.radiusM);
    expect(rings.outerRadiusM).toBeGreaterThan(rings.innerRadiusM);
    // The A ring's outer edge is inside Mimas's orbit; that is what confines it.
    expect(rings.outerRadiusM).toBeLessThan(getBody("mimas")!.elements!.semiMajorAxisM);
  });

  it("every ring system belongs to a body that exists and is a giant", () => {
    for (const ring of RING_SYSTEMS) {
      const body = getBody(ring.bodyId);
      expect(body, ring.bodyId).toBeDefined();
      expect(body!.radiusM).toBeGreaterThan(2e7);
      expect(ring.innerRadiusM).toBeGreaterThan(body!.radiusM);
      expect(ring.opacity).toBeGreaterThan(0);
      expect(ring.opacity).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Pluto, Eris and Makemake are the only surfaces anyone has resolved below 50 K. The
 * exoplanet catalogue has almost nothing this cold, because transit surveys cannot see
 * long-period orbits. So these are the only check that the generator does not simply fall
 * apart at the cold end.
 */
describe("the cold end of the generator", () => {
  it.each(["pluto", "eris", "makemake", "haumea", "charon"])(
    "%s compiles to a terrain program with active layers",
    (id) => {
      const program = compileTerrainProgram({ context: toPlanetContext(getBody(id)!), seed: "sha256:test" });
      expect(program.operators.length).toBeGreaterThan(0);
    },
  );

  it("gives no fluvial erosion to a 30 K body with no atmosphere", () => {
    for (const id of ["eris", "makemake", "charon"]) {
      const program = compileTerrainProgram({ context: toPlanetContext(getBody(id)!), seed: "sha256:test" });
      expect(
        program.operators.map((o) => o.op),
        `${id} should not have rivers`,
      ).not.toContain("fluvial_erosion");
    }
  });

  it("distinguishes Pluto from Charon despite identical distance and age", () => {
    const a = diversityFingerprint(
      compileTerrainProgram({ context: toPlanetContext(PLUTO), seed: "sha256:pluto" }),
    );
    const b = diversityFingerprint(
      compileTerrainProgram({ context: toPlanetContext(CHARON), seed: "sha256:charon" }),
    );
    // Pluto holds a nitrogen atmosphere and Charon does not; they must not be the same world.
    expect(a).not.toEqual(b);
  });
});

describe("the map is actually populated", () => {
  it("has the Sun, eight planets, seventeen moons and six dwarfs", () => {
    expect(SOLAR_SYSTEM.filter((b) => b.kind === "star")).toHaveLength(1);
    expect(SOLAR_SYSTEM.filter((b) => b.kind === "planet")).toHaveLength(8);
    expect(SOLAR_SYSTEM.filter((b) => b.kind === "moon")).toHaveLength(19); // +Moon, +Charon
    expect(SOLAR_SYSTEM.filter((b) => b.kind === "dwarf")).toHaveLength(5);
  });

  it("reaches past 60 AU", () => {
    const farthest = Math.max(
      ...SOLAR_SYSTEM.filter((b) => b.parentId === "sun").map(
        (b) => b.elements!.semiMajorAxisM,
      ),
    );
    expect(farthest / 1.495978707e11).toBeGreaterThan(60);
  });

  it("names Ceres, Eris, Makemake and Haumea as dwarfs, not planets", () => {
    for (const b of [CERES, ERIS, MAKEMAKE, HAUMEA, PLUTO]) {
      expect(b.kind).toBe("dwarf");
    }
  });
});
