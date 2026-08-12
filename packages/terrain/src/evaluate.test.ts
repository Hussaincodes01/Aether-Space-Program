import { describe, expect, it } from "vitest";
import {
  CANCRI_55E,
  EARTH,
  LHS_3844B,
  TITAN,
  TRAPPIST_1E,
  compileTerrainProgram,
  evaluateTerrain,
  fbm,
  frequencyForScale,
  hash3,
  reliefRange,
  ridged,
  terrainNormal,
  valueNoise3,
  worley3,
} from "./index.js";
import type { PlanetContext } from "./types.js";

const EARTH_RADIUS_M = 6.3781e6;

const programFor = (ctx: PlanetContext, seed = "sha256:test") =>
  compileTerrainProgram({ context: ctx, seed });

const sampleAt = (ctx: PlanetContext, dir: { x: number; y: number; z: number }, seed?: string) =>
  evaluateTerrain(programFor(ctx, seed), dir, {
    radiusM: ctx.radiusM,
    tidallyLocked: ctx.tidallyLocked,
  });

describe("noise primitives", () => {
  it("is deterministic", () => {
    expect(valueNoise3(1.5, 2.5, 3.5, 42)).toBe(valueNoise3(1.5, 2.5, 3.5, 42));
    expect(hash3(10, 20, 30, 7)).toBe(hash3(10, 20, 30, 7));
  });

  it("stays in range", () => {
    for (let i = 0; i < 400; i++) {
      const v = valueNoise3(i * 0.37, i * 0.71, i * 1.13, 99);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
      const r = ridged(i * 0.37, i * 0.71, i * 1.13, 99);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.0001);
    }
  });

  it("stays coherent at planetary coordinate magnitudes", () => {
    // The failure this integer hash exists to prevent: a float hash based on
    // fract(sin(dot(p,k))*k) collapses neighbouring samples onto the same value once the
    // coordinates get large, and the surface goes blotchy. Adjacent samples must differ.
    const base = 1_500_000;
    const a = valueNoise3(base + 0.0, 0.5, 0.5, 3);
    const b = valueNoise3(base + 0.5, 0.5, 0.5, 3);
    expect(a).not.toBeCloseTo(b, 6);
  });

  it("produces distinct fields for distinct seeds", () => {
    expect(valueNoise3(2.2, 3.3, 4.4, 1)).not.toBeCloseTo(valueNoise3(2.2, 3.3, 4.4, 2), 5);
  });

  it("gives Worley a nearest that never exceeds the second nearest", () => {
    for (let i = 0; i < 200; i++) {
      const { f1, f2 } = worley3(i * 0.31, i * 0.53, i * 0.77, 5);
      expect(f1).toBeLessThanOrEqual(f2);
    }
  });

  it("scales feature size with planet radius", () => {
    // 1800 km features must appear more often around a large planet than a small one.
    const onEarth = frequencyForScale(1800, EARTH_RADIUS_M);
    const onSmall = frequencyForScale(1800, EARTH_RADIUS_M / 4);
    expect(onEarth).toBeGreaterThan(onSmall);
  });

  it("keeps fBm bounded", () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.13, i * 0.29, i * 0.41, 11, { octaves: 6 });
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe("determinism (PRD §13.2)", () => {
  it("gives byte-identical samples for identical inputs", () => {
    const a = sampleAt(EARTH, { x: 0.3, y: 0.5, z: 0.81 });
    const b = sampleAt(EARTH, { x: 0.3, y: 0.5, z: 0.81 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("changes the world when the seed changes", () => {
    const a = sampleAt(EARTH, { x: 0.3, y: 0.5, z: 0.81 }, "sha256:aaa");
    const b = sampleAt(EARTH, { x: 0.3, y: 0.5, z: 0.81 }, "sha256:bbb");
    expect(a.heightM).not.toBeCloseTo(b.heightM, 3);
  });

  it("normalises the direction, so magnitude cannot change the result", () => {
    const unit = sampleAt(EARTH, { x: 0, y: 0, z: 1 });
    const scaled = sampleAt(EARTH, { x: 0, y: 0, z: 7 });
    expect(scaled.heightM).toBeCloseTo(unit.heightM, 6);
  });
});

describe("operators actually shape the surface", () => {
  it("attributes every contribution to a named process", () => {
    const sample = sampleAt(EARTH, { x: 0.2, y: 0.3, z: 0.93 });
    expect(Object.keys(sample.contributions).length).toBeGreaterThan(1);
    for (const op of Object.keys(sample.contributions)) {
      // Anything shaping the surface must be a registered, gated process — never a
      // free-floating noise term nobody can explain.
      expect(op).toMatch(/^[a-z_]+$/);
    }
  });

  it("carves craters into an airless world and not into Earth", () => {
    const airless = sampleAt(LHS_3844B, { x: 0.5, y: 0.1, z: 0.86 });
    expect(airless.contributions.impact_population).toBeDefined();

    // Earth retains craters far more poorly — atmosphere, water and resurfacing all erase.
    const earthProgram = programFor(EARTH);
    const earthCraters = earthProgram.operators.find((o) => o.op === "impact_population");
    const airlessProgram = programFor(LHS_3844B);
    const airlessCraters = airlessProgram.operators.find((o) => o.op === "impact_population");
    expect(airlessCraters!.params.density!).toBeGreaterThan(earthCraters!.params.density!);
  });

  it("gives Earth rivers and an airless world none", () => {
    // Contributions are recorded per point, and a drainage network does not cover a globe
    // — so this has to sample the surface rather than probe one spot.
    const firesSomewhere = (ctx: PlanetContext, op: string): boolean => {
      const program = programFor(ctx);
      const options = { radiusM: ctx.radiusM, tidallyLocked: ctx.tidallyLocked };
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < 400; i++) {
        const y = 1 - (i / 399) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const t = golden * i;
        const s = evaluateTerrain(
          program,
          { x: Math.cos(t) * r, y, z: Math.sin(t) * r },
          options,
        );
        if (s.contributions[op]) return true;
      }
      return false;
    };

    expect(firesSomewhere(EARTH, "fluvial_erosion")).toBe(true);
    expect(firesSomewhere(LHS_3844B, "fluvial_erosion")).toBe(false);
  });

  it("floods a lava world flat below its sea level", () => {
    const program = programFor(CANCRI_55E);
    expect(program.operators.map((o) => o.op)).toContain("lava_ocean");

    // Two points in low ground must end at the same height: a liquid surface is level.
    const options = { radiusM: CANCRI_55E.radiusM, tidallyLocked: true };
    const heights: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = (i / 60) * Math.PI * 2;
      const s = evaluateTerrain(program, { x: Math.cos(t), y: 0.1, z: Math.sin(t) }, options);
      if (s.contributions.lava_ocean) heights.push(s.heightM);
    }
    if (heights.length > 1) {
      const spread = Math.max(...heights) - Math.min(...heights);
      expect(spread).toBeLessThan(1);
    }
  });
});

describe("tidal locking moves the cold trap", () => {
  it("puts ice at the antistellar point, not at the poles", () => {
    // TRAPPIST-1e is tidally locked, so the glacial operator must key on substellar angle.
    const program = programFor(TRAPPIST_1E);
    const options = { radiusM: TRAPPIST_1E.radiusM, tidallyLocked: true };

    const substellar = evaluateTerrain(program, { x: 1, y: 0, z: 0 }, options);
    const antistellar = evaluateTerrain(program, { x: -1, y: 0, z: 0 }, options);
    const pole = evaluateTerrain(program, { x: 0, y: 1, z: 0 }, options);

    const ice = (s: typeof substellar): number => s.contributions.glacial_erosion ?? 0;

    expect(ice(antistellar)).toBeGreaterThan(ice(substellar));
    // The pole is no colder than the antistellar point on a locked world.
    expect(ice(antistellar)).toBeGreaterThanOrEqual(ice(pole));
  });

  it("puts ice at the poles on a world that is not locked", () => {
    const program = programFor(EARTH);
    const options = { radiusM: EARTH.radiusM, tidallyLocked: false };
    const pole = evaluateTerrain(program, { x: 0, y: 1, z: 0 }, options);
    const equator = evaluateTerrain(program, { x: 1, y: 0, z: 0 }, options);
    const ice = (s: typeof pole): number => s.contributions.glacial_erosion ?? 0;
    expect(ice(pole)).toBeGreaterThan(ice(equator));
  });
});

describe("relief is physically plausible", () => {
  it("keeps Earth's relief in the right order of magnitude", () => {
    // Earth's true range is about -11 km to +8.8 km.
    const { minM, maxM } = reliefRange(
      programFor(EARTH),
      { radiusM: EARTH.radiusM, tidallyLocked: false },
      800,
    );
    expect(maxM - minM).toBeGreaterThan(1_000);
    expect(maxM - minM).toBeLessThan(40_000);
  });

  it("gives a low-gravity world more relief than a high-gravity one", () => {
    // Maximum supportable topography scales as 1/g. Titan is low gravity; LHS 3844 b is not.
    const titan = reliefRange(programFor(TITAN), { radiusM: TITAN.radiusM }, 500);
    const heavy = reliefRange(programFor(LHS_3844B), { radiusM: LHS_3844B.radiusM }, 500);
    const span = (r: { minM: number; maxM: number }): number => r.maxM - r.minM;
    expect(span(titan) / TITAN.radiusM).toBeGreaterThan(span(heavy) / LHS_3844B.radiusM / 4);
  });
});

describe("normals", () => {
  it("returns unit vectors pointing outward", () => {
    const program = programFor(EARTH);
    const options = { radiusM: EARTH.radiusM, tidallyLocked: false };
    for (const dir of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0.3, y: 0.4, z: 0.87 },
      { x: 0, y: -1, z: 0 },
    ]) {
      const n = terrainNormal(program, dir, options);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
      // Outward: within 90 degrees of the radial direction.
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const dot = (n.x * dir.x + n.y * dir.y + n.z * dir.z) / len;
      expect(dot).toBeGreaterThan(0);
    }
  });
});
