import { describe, expect, it } from "vitest";
import {
  EARTH,
  TRAPPIST_1E,
  compileTerrainProgram,
  evaluateTerrain,
  reliefRange,
} from "./index.js";

/**
 * Cost guards for terrain evaluation.
 *
 * Not micro-benchmarks — the numbers are loose enough to survive a noisy CI runner. They
 * exist to catch the case where someone adds an operator that is an order of magnitude
 * more expensive than the rest and turns mesh generation into a visible freeze.
 */
describe("evaluation cost", () => {
  const measure = (samples: number): number => {
    const program = compileTerrainProgram({ context: EARTH, seed: "sha256:perf" });
    const options = { radiusM: EARTH.radiusM, tidallyLocked: false };
    const start = performance.now();
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
      const y = 1 - (i / (samples - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      evaluateTerrain(program, { x: Math.cos(t) * r, y, z: Math.sin(t) * r }, options);
    }
    return performance.now() - start;
  };

  it("evaluates a full icosphere-5 vertex set in well under a second", () => {
    // Subdivision 5 is 10,242 vertices — what the client builds at startup.
    const ms = measure(10_242);

    console.log(`  icosphere-5 (10,242 vertices): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(4000);
  });

  it("scales roughly linearly with sample count", () => {
    const small = measure(2000);
    const large = measure(8000);

    console.log(`  2,000: ${small.toFixed(0)} ms   8,000: ${large.toFixed(0)} ms`);
    // Four times the samples must not cost more than eight times the time.
    expect(large).toBeLessThan(small * 8 + 50);
  });

  it("keeps relief sampling cheap enough to run at startup", () => {
    const start = performance.now();
    reliefRange(
      compileTerrainProgram({ context: TRAPPIST_1E, seed: "sha256:perf" }),
      { radiusM: TRAPPIST_1E.radiusM, tidallyLocked: true },
      1500,
    );
    const ms = performance.now() - start;

    console.log(`  reliefRange(1500): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});
