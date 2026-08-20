/**
 * Vertical exaggeration must scale with the body, not be applied flat.
 *
 * The bug these pin: at a flat 25x, Europa's 18.9 km of computed relief became 474 km of
 * displacement against a 1561 km radius -- 30% of the body -- and the moon rendered as a sea
 * urchin. Earth survived the same multiplier only because 8.85 km against 6371 km is 3.5%.
 *
 * So the invariant is about displayed relief as a fraction of radius, which is the thing that
 * actually determines whether a world reads as terrain or as spikes.
 */

import { describe, expect, it } from "vitest";
import { MAX_DISPLAYED_RELIEF_FRACTION, effectiveExaggeration } from "./terrain-data.js";
import { maxReliefM } from "@aether/terrain";

/** radius m, computed relief span m */
const BODIES = {
  earth: [6.3781e6, 8850],
  moon: [1.7374e6, 19_900],
  mars: [3.3895e6, 29_400],
  europa: [1.5608e6, 18_948],
  mimas: [1.982e5, 9_885],
  phobos: [1.1267e4, 562],
} as const;

describe("displayed relief never overwhelms the body", () => {
  it.each(Object.entries(BODIES))(
    "%s stays within the cap, or is already at true scale",
    (_name, [radiusM, relief]) => {
      const e = effectiveExaggeration(25, radiusM, relief);
      const displayed = (relief * e) / radiusM;

      // Two admissible outcomes, and the second one matters. Mimas's computed relief is
      // 4.99% of its radius at 1:1 -- already past the cap before any exaggeration. The
      // right response is to stop exaggerating, not to shrink real terrain below its true
      // size to make the body look tidier. So the cap binds only down to true scale.
      const withinCap = displayed <= MAX_DISPLAYED_RELIEF_FRACTION + 1e-9;
      expect(withinCap || e === 1).toBe(true);
    },
  );

  it("never compresses terrain below true scale, however lumpy that leaves a small moon", () => {
    // Mimas and Phobos both land here: honest 1:1 rather than a flattering shrink.
    const [mimasR, mimasRelief] = BODIES.mimas;
    expect(effectiveExaggeration(25, mimasR, mimasRelief)).toBe(1);
    expect(mimasRelief / mimasR).toBeGreaterThan(MAX_DISPLAYED_RELIEF_FRACTION);
  });

  it("would have failed for Europa at a flat 25x", () => {
    // The regression, stated numerically: this is what shipped as a hedgehog.
    const [radiusM, relief] = BODIES.europa;
    expect((relief * 25) / radiusM).toBeGreaterThan(0.3);
  });

  it("leaves Earth alone, because Earth was already inside the cap", () => {
    const [radiusM, relief] = BODIES.earth;
    expect(effectiveExaggeration(25, radiusM, relief)).toBeCloseTo(25, 5);
  });

  it("cuts Europa hard", () => {
    const [radiusM, relief] = BODIES.europa;
    expect(effectiveExaggeration(25, radiusM, relief)).toBeLessThan(4);
  });
});

describe("the cap behaves at the edges", () => {
  it("never returns less than 1, so terrain is never flattened out of existence", () => {
    expect(effectiveExaggeration(25, 1e3, 1e9)).toBeGreaterThanOrEqual(1);
  });

  it("never exceeds what was requested", () => {
    for (const [radiusM, relief] of Object.values(BODIES)) {
      expect(effectiveExaggeration(25, radiusM, relief)).toBeLessThanOrEqual(25);
    }
  });

  it("passes the request through when there is no relief to scale", () => {
    expect(effectiveExaggeration(25, 6.4e6, 0)).toBe(25);
  });

  it("survives a degenerate radius rather than returning NaN", () => {
    expect(Number.isFinite(effectiveExaggeration(25, 0, 1000))).toBe(true);
  });

  it("is monotonic: a smaller body gets a smaller exaggeration for the same relief", () => {
    const big = effectiveExaggeration(25, 6.4e6, 10_000);
    const small = effectiveExaggeration(25, 1.5e6, 10_000);
    expect(small).toBeLessThan(big);
  });
});

describe("relief never exceeds what the body can carry", () => {
  // radius m, bulk density kg/m3, surface gravity m/s2
  const ctx = (radiusM: number, bulkDensityKgM3: number, surfaceGravityMs2: number) =>
    ({ radiusM, bulkDensityKgM3, surfaceGravityMs2 }) as never;

  it("bounds Phobos to a few hundred metres, not several kilometres", () => {
    // The bug: the generator produced 15.9 km of relief on an 11.27 km radius -- 141% of
    // the body -- so at true scale the displacement reached past the centre and the moon
    // rendered inside out.
    const ceiling = maxReliefM(ctx(11_270, 1876, 0.0057));
    expect(ceiling).toBeLessThan(600);
    expect(ceiling).toBeGreaterThan(500);
    expect(ceiling / 11_270).toBeLessThan(0.06);
  });

  it("agrees with the harness, which reaches 562 m for Phobos", () => {
    expect(maxReliefM(ctx(11_270, 1876, 0.0057))).toBeCloseTo(563.5, 0);
  });

  it("leaves Earth on the strength limit, near Everest", () => {
    // Big bodies are strength-limited, not size-limited, and must be untouched.
    const ceiling = maxReliefM(ctx(6.3781e6, 5514, 9.80665));
    expect(ceiling).toBeGreaterThan(8000);
    expect(ceiling).toBeLessThan(9500);
  });

  it("leaves Mars able to carry Olympus Mons", () => {
    // Olympus Mons is 22 km; the ceiling must not fall below it.
    expect(maxReliefM(ctx(3.3895e6, 3934, 3.73))).toBeGreaterThan(22_000);
  });

  it("never returns a ceiling at or above the body's own radius", () => {
    const bodies: ReadonlyArray<readonly [number, number, number]> = [
      [11_270, 1876, 0.0057],
      [6_200, 1471, 0.003],
      [198_200, 1150, 0.064],
      [1.5608e6, 3013, 1.32],
      [6.3781e6, 5514, 9.80665],
    ];
    for (const [r, rho, g] of bodies) {
      expect(maxReliefM(ctx(r, rho, g))).toBeLessThan(r);
    }
  });

  it("is monotonic in radius for bodies in the size-limited regime", () => {
    const small = maxReliefM(ctx(6_200, 1471, 0.003));
    const large = maxReliefM(ctx(11_270, 1876, 0.0057));
    expect(large).toBeGreaterThan(small);
  });
});
