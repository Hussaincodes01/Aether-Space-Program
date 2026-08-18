/**
 * Adaptive exposure tests.
 *
 * The requirement is "every planet is lit, however far from the Sun it is". The trap is that
 * the obvious way to satisfy it — light everything equally — would be a lie about
 * illumination. So these assert both halves: nothing is ever black, and the ordering is
 * never destroyed.
 */

import { describe, expect, it } from "vitest";
import { AU } from "@aether/units";
import {
  ADAPTATION_EXPONENT,
  FULL_MOON_W_M2,
  MAX_EXPOSURE,
  MIN_EXPOSURE,
  adaptedExposure,
  insolationWattsPerM2,
  relativeInsolation,
  versusFullMoon,
} from "./exposure.js";

/** Semi-major axes in AU. */
const BODIES: ReadonlyArray<readonly [string, number]> = [
  ["mercury", 0.387],
  ["venus", 0.723],
  ["earth", 1.0],
  ["mars", 1.524],
  ["jupiter", 5.204],
  ["saturn", 9.583],
  ["uranus", 19.19],
  ["neptune", 30.07],
  ["pluto", 39.48],
  ["eris", 67.78],
];

describe("the physics is untouched", () => {
  it("reproduces the solar constant at 1 AU", () => {
    expect(insolationWattsPerM2(AU)).toBeCloseTo(1361, 0);
  });

  it("follows the inverse square law exactly", () => {
    // Mars at 1.524 AU receives 1/1.524^2 of Earth's.
    expect(relativeInsolation(1.524 * AU)).toBeCloseTo(1 / 1.524 ** 2, 6);
    expect(relativeInsolation(2 * AU)).toBeCloseTo(0.25, 9);
  });

  it("scales with the host star's luminosity", () => {
    // TRAPPIST-1e: 0.02925 AU around a 0.000553 L_sun host, so near Earth's illumination
    // despite orbiting 34 times closer than Earth does.
    const relative = relativeInsolation(0.02925 * AU, 0.000553);
    expect(relative).toBeGreaterThan(0.4);
    expect(relative).toBeLessThan(1.0);
  });
});

describe("every world is lit", () => {
  it.each(BODIES)("%s is never rendered black", (_name, au) => {
    expect(adaptedExposure(au * AU)).toBeGreaterThanOrEqual(MIN_EXPOSURE);
  });

  it("lights the outer system well clear of darkness", () => {
    // The old code clamped everything past Mars to one dim value. Neptune should now be
    // within a factor of four of Earth on screen.
    const earth = adaptedExposure(AU);
    const neptune = adaptedExposure(30.07 * AU);
    expect(neptune).toBeGreaterThan(earth / 4);
  });

  it("holds even absurdly far out", () => {
    expect(adaptedExposure(500 * AU)).toBeGreaterThanOrEqual(MIN_EXPOSURE);
    expect(adaptedExposure(1e6 * AU)).toBeGreaterThanOrEqual(MIN_EXPOSURE);
  });

  it("never blows past the ceiling, however close in", () => {
    expect(adaptedExposure(0.01 * AU)).toBeLessThanOrEqual(MAX_EXPOSURE);
    expect(adaptedExposure(1e-6 * AU)).toBeLessThanOrEqual(MAX_EXPOSURE);
  });

  it("survives a zero or negative distance rather than returning NaN", () => {
    expect(Number.isFinite(adaptedExposure(0))).toBe(true);
    expect(Number.isFinite(adaptedExposure(-1))).toBe(true);
  });
});

describe("brightening compresses the range without reordering it", () => {
  it("keeps every body strictly brighter than the one outside it", () => {
    // This is what separates honest compression from "light everything the same".
    for (let i = 1; i < BODIES.length; i++) {
      const inner = adaptedExposure(BODIES[i - 1]![1] * AU);
      const outer = adaptedExposure(BODIES[i]![1] * AU);
      expect(inner, `${BODIES[i - 1]![0]} vs ${BODIES[i]![0]}`).toBeGreaterThan(outer);
    }
  });

  it("compresses four decades of illumination to under 10:1 on screen", () => {
    const brightest = adaptedExposure(0.387 * AU);
    const dimmest = adaptedExposure(67.78 * AU);
    // Real ratio Mercury:Eris is about 30,000:1.
    expect(relativeInsolation(0.387 * AU) / relativeInsolation(67.78 * AU)).toBeGreaterThan(
      20_000,
    );
    expect(brightest / dimmest).toBeLessThan(10);
    expect(brightest / dimmest).toBeGreaterThan(2);
  });

  it("uses an exponent that compresses rather than flattens", () => {
    // 0 would light everything identically, which would be the lie this avoids.
    expect(ADAPTATION_EXPONENT).toBeGreaterThan(0);
    expect(ADAPTATION_EXPONENT).toBeLessThan(1);
  });
});

describe("the justification holds up", () => {
  it("confirms even the outermost bodies are far brighter than a full moon", () => {
    // This is why brightening is the more truthful rendering, not a cheat: full moonlight is
    // enough to walk by, and every one of these worlds gets hundreds of times more.
    for (const [name, au] of BODIES) {
      expect(versusFullMoon(au * AU), name).toBeGreaterThan(200);
    }
  });

  it("puts Neptune above a thousand full moons and Eris above two hundred", () => {
    expect(versusFullMoon(30.07 * AU)).toBeGreaterThan(1000);
    expect(versusFullMoon(67.78 * AU)).toBeGreaterThan(200);
  });

  it("uses a full-moon reference in the right ballpark", () => {
    expect(FULL_MOON_W_M2).toBeGreaterThan(1e-4);
    expect(FULL_MOON_W_M2).toBeLessThan(1e-2);
  });
});
