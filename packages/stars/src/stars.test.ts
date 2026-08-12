import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARSEC } from "@aether/units";
import {
  CATALOG_MAGIC,
  CatalogFormatError,
  NAKED_EYE_LIMIT,
  absoluteMagnitude,
  apparentMagnitude,
  distanceParsecs,
  parseCatalog,
  positionMetres,
  relativeFlux,
  renderScale,
  spectralClass,
  starColour,
  temperatureFromColourIndex,
  type StarCatalog,
} from "./index.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

function load(name: string): StarCatalog {
  const buf = readFileSync(join(DATA, name));
  return parseCatalog(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const bright = load("stars-bright.bin");
const full = load("stars-full.bin");

describe("catalogue integrity", () => {
  it("loads both tiers", () => {
    // ~9,000 stars are visible to the unaided eye over the whole sky, north and south,
    // across a full year. Landing near that number is a real check that the magnitude
    // filter is doing what it claims.
    expect(bright.count).toBeGreaterThan(7_000);
    expect(bright.count).toBeLessThan(11_000);
    expect(full.count).toBeGreaterThan(100_000);
  });

  it("keeps the tiers consistent in shape", () => {
    for (const c of [bright, full]) {
      expect(c.positionsPc).toHaveLength(c.count * 3);
      expect(c.absoluteMagnitudes).toHaveLength(c.count);
      expect(c.colourIndices).toHaveLength(c.count);
    }
  });

  it("contains only stars with real parallax distances", () => {
    // HYG uses 100000 pc as its "no usable parallax" placeholder; none may survive import,
    // or the sky grows a shell of phantom stars at a fixed radius.
    for (let i = 0; i < full.count; i++) {
      const d = distanceParsecs(full, i);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(50_000);
    }
  });

  it("keeps colour indices inside the physical range", () => {
    for (let i = 0; i < full.count; i++) {
      expect(full.colourIndices[i]!).toBeGreaterThan(-1);
      expect(full.colourIndices[i]!).toBeLessThan(6);
    }
  });

  it("converts positions to metres for the frame tree", () => {
    const p = positionMetres(full, 0);
    const pc = distanceParsecs(full, 0);
    expect(Math.hypot(p.x, p.y, p.z) / PARSEC).toBeCloseTo(pc, 3);
  });
});

describe("format errors fail loudly", () => {
  it("rejects a buffer with the wrong magic", () => {
    const bad = new Uint8Array(64);
    expect(() => parseCatalog(bad.buffer)).toThrow(CatalogFormatError);
    expect(() => parseCatalog(bad.buffer)).toThrow(/Bad magic/);
  });

  it("rejects a truncated file rather than rendering garbage", () => {
    const buf = readFileSync(join(DATA, "stars-bright.bin"));
    const truncated = buf.buffer.slice(buf.byteOffset, buf.byteOffset + 1000);
    expect(() => parseCatalog(truncated)).toThrow(/Truncated or corrupt/);
  });

  it("rejects a buffer too short to hold a header", () => {
    expect(() => parseCatalog(new Uint8Array(4).buffer)).toThrow(/too short/);
  });

  it("writes the expected magic", () => {
    const buf = readFileSync(join(DATA, "stars-bright.bin"));
    expect(buf.subarray(0, 8).toString("ascii")).toBe(CATALOG_MAGIC);
  });
});

describe("photometry against published values", () => {
  it("recovers the Sun's temperature from its colour index", () => {
    // B-V = 0.656 -> 5756 K against a true 5772 K. Ballesteros (2012).
    expect(temperatureFromColourIndex(0.656)).toBeCloseTo(5772, -2);
  });

  it("recovers temperatures across the main sequence", () => {
    // Sirius A: B-V 0.00, ~9940 K. Betelgeuse: B-V 1.85, ~3600 K.
    expect(temperatureFromColourIndex(0.0)).toBeGreaterThan(9_000);
    expect(temperatureFromColourIndex(0.0)).toBeLessThan(11_000);
    expect(temperatureFromColourIndex(1.85)).toBeGreaterThan(3_000);
    expect(temperatureFromColourIndex(1.85)).toBeLessThan(4_000);
  });

  it("is monotonic: redder always means cooler", () => {
    let previous = Infinity;
    for (let bv = -0.3; bv <= 2.0; bv += 0.05) {
      const t = temperatureFromColourIndex(bv);
      expect(t).toBeLessThan(previous);
      previous = t;
    }
  });

  it("colours hot stars blue and cool stars red", () => {
    const hot = starColour(-0.3);
    const cool = starColour(1.9);
    expect(hot.b).toBeGreaterThan(hot.r);
    expect(cool.r).toBeGreaterThan(cool.b);
  });

  it("reproduces the distance modulus for real stars", () => {
    // Sirius: absolute magnitude 1.45 at 2.64 pc gives apparent -1.44 (published -1.46).
    expect(apparentMagnitude(1.45, 2.64)).toBeCloseTo(-1.44, 1);
    // Vega: 0.58 at 7.68 pc gives 0.01 (published 0.03).
    expect(apparentMagnitude(0.58, 7.68)).toBeCloseTo(0.03, 1);
    // By definition, a star at 10 pc has apparent magnitude equal to absolute.
    expect(apparentMagnitude(4.83, 10)).toBeCloseTo(4.83, 6);
  });

  it("round-trips the distance modulus", () => {
    for (const [m, d] of [[1.45, 2.64], [-5.85, 168], [4.83, 10]] as const) {
      expect(absoluteMagnitude(apparentMagnitude(m, d), d)).toBeCloseTo(m, 6);
    }
  });

  it("keeps the magnitude scale correct: five magnitudes is a factor of 100", () => {
    expect(relativeFlux(0) / relativeFlux(5)).toBeCloseTo(100, 6);
    expect(relativeFlux(0) / relativeFlux(1)).toBeCloseTo(2.512, 2);
  });

  it("classifies spectral types by colour", () => {
    expect(spectralClass(-0.32)).toBe("O");
    expect(spectralClass(0.0)).toBe("A");
    expect(spectralClass(0.656)).toBe("G");
    expect(spectralClass(1.85)).toBe("M");
  });
});

describe("render scaling", () => {
  it("makes brighter stars bigger, and drops the invisible ones", () => {
    const sirius = renderScale(-1.46);
    const faint = renderScale(6.0);
    expect(sirius.size).toBeGreaterThan(faint.size);
    expect(sirius.brightness).toBeGreaterThan(faint.brightness);
    expect(renderScale(20).size).toBe(0);
  });

  it("is monotonic in magnitude, so no faint star outshines a bright one", () => {
    let previous = Infinity;
    for (let m = -1.5; m <= 9; m += 0.25) {
      const { size } = renderScale(m);
      expect(size).toBeLessThanOrEqual(previous + 1e-9);
      previous = size;
    }
  });

  it("keeps sizes bounded so the brightest star is not a dinner plate", () => {
    // A physical flux mapping would make Sirius ~10^4 times Vega's area. The perceptual
    // compression is deliberate and this pins it.
    expect(renderScale(-1.46).size).toBeLessThan(renderScale(6).size * 12);
  });
});

describe("the sky as seen from Earth", () => {
  const apparentMags = Array.from({ length: bright.count }, (_, i) =>
    apparentMagnitude(bright.absoluteMagnitudes[i]!, distanceParsecs(bright, i)),
  ).sort((a, b) => a - b);

  it("has a brightest star matching Sirius", () => {
    // Sirius is the brightest star in the night sky at magnitude -1.46.
    expect(apparentMags[0]!).toBeGreaterThan(-1.7);
    expect(apparentMags[0]!).toBeLessThan(-1.2);
  });

  it("respects the naked-eye cut in the bright tier", () => {
    expect(apparentMags[apparentMags.length - 1]!).toBeLessThanOrEqual(NAKED_EYE_LIMIT + 0.01);
  });

  it("has roughly the right number of first-magnitude stars", () => {
    // Convention counts 21 or 22 first-magnitude stars (brighter than 1.5).
    const first = apparentMags.filter((m) => m < 1.5).length;
    expect(first).toBeGreaterThan(14);
    expect(first).toBeLessThan(30);
  });

  it("gets steeply more numerous with magnitude, as a real sky does", () => {
    // Each magnitude step should roughly triple the count in a uniform-density shell.
    const countBelow = (m: number): number => apparentMags.filter((x) => x < m).length;
    expect(countBelow(5)).toBeGreaterThan(countBelow(4) * 2);
    expect(countBelow(6)).toBeGreaterThan(countBelow(5) * 2);
  });
});
