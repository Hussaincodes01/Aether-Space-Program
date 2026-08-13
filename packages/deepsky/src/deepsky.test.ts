import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEEPSKY_MAGIC,
  DEEP_SKY_DISPLAY,
  DeepSkyFormatError,
  DeepSkyType,
  HUBBLE_CONSTANTS,
  UNKNOWN_MAGNITUDE,
  bestDistance,
  distanceFromParallax,
  distanceFromRedshift,
  hasDistance,
  megaparsecsToMetres,
  parseDeepSky,
  rescaleForHubble,
  typeOf,
  type DeepSkyCatalog,
  type NamedObject,
} from "./index.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

const buf = readFileSync(join(DATA, "deepsky.bin"));
const catalog: DeepSkyCatalog = parseDeepSky(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const names: NamedObject[] = JSON.parse(readFileSync(join(DATA, "deepsky-names.json"), "utf8"));

const byMessier = (m: number): NamedObject | undefined => names.find((n) => n.m === m);

describe("catalogue integrity", () => {
  it("loads the full catalogue", () => {
    expect(catalog.count).toBeGreaterThan(11_000);
    expect(catalog.count).toBeLessThan(14_000);
  });

  it("stores unit direction vectors", () => {
    for (let i = 0; i < catalog.count; i += 37) {
      const len = Math.hypot(
        catalog.directions[i * 3]!,
        catalog.directions[i * 3 + 1]!,
        catalog.directions[i * 3 + 2]!,
      );
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it("is sorted brightest first", () => {
    // The renderer draws a prefix of the buffer as a quality tier and must not have to sort.
    for (let i = 1; i < catalog.count; i++) {
      expect(catalog.magnitudes[i]!).toBeGreaterThanOrEqual(catalog.magnitudes[i - 1]!);
    }
  });

  it("excludes duplicates and stars, which belong in the stellar catalogue", () => {
    // 651 Dup, 546 *, 243 ** in the source. Rendering them would double-count objects and
    // put stars in two layers at slightly different positions.
    for (let i = 0; i < catalog.count; i++) {
      expect(catalog.types[i]!).toBeLessThanOrEqual(DeepSkyType.Nebula);
    }
  });

  it("gives every type a display definition", () => {
    const used = new Set(Array.from(catalog.types));
    for (const t of used) {
      const display = DEEP_SKY_DISPLAY[t as DeepSkyType];
      expect(display, `type ${t}`).toBeDefined();
      expect(display.colour).toHaveLength(3);
      expect(display.description.length).toBeGreaterThan(15);
    }
  });
});

describe("format errors fail loudly", () => {
  it("rejects wrong magic", () => {
    expect(() => parseDeepSky(new Uint8Array(64).buffer)).toThrow(DeepSkyFormatError);
  });

  it("rejects a truncated file", () => {
    const short = buf.buffer.slice(buf.byteOffset, buf.byteOffset + 500);
    expect(() => parseDeepSky(short)).toThrow(/Truncated or corrupt/);
  });

  it("writes the expected magic", () => {
    expect(buf.subarray(0, 8).toString("ascii")).toBe(DEEPSKY_MAGIC);
  });
});

describe("Messier objects are present and correctly classified", () => {
  it("carries essentially the whole Messier catalogue", () => {
    const messier = names.filter((n) => n.m).length;
    // 110 objects; a few are asterisms or duplicates that OpenNGC classes out.
    expect(messier).toBeGreaterThan(100);
    expect(messier).toBeLessThanOrEqual(110);
  });

  const expectations: Array<[number, string, DeepSkyType]> = [
    [1, "Crab Nebula", DeepSkyType.SupernovaRemnant],
    [13, "Hercules globular", DeepSkyType.GlobularCluster],
    [31, "Andromeda", DeepSkyType.Galaxy],
    [42, "Orion Nebula", DeepSkyType.Nebula],
    [45, "Pleiades", DeepSkyType.OpenCluster],
    [57, "Ring Nebula", DeepSkyType.PlanetaryNebula],
    [87, "Virgo A", DeepSkyType.Galaxy],
    [104, "Sombrero", DeepSkyType.Galaxy],
  ];

  for (const [m, label, expectedType] of expectations) {
    it(`M${m} (${label}) is classified as ${DEEP_SKY_DISPLAY[expectedType].label}`, () => {
      const entry = byMessier(m);
      expect(entry, `M${m} missing`).toBeDefined();
      const actual = typeOf(catalog, entry!.i);
      // A few Messier objects are classified differently by different authorities; accept
      // the family rather than demanding an exact match on the nebula subtypes.
      if (expectedType === DeepSkyType.Nebula) {
        expect([
          DeepSkyType.Nebula,
          DeepSkyType.EmissionNebula,
          DeepSkyType.HiiRegion,
          DeepSkyType.ClusterWithNebulosity,
          DeepSkyType.ReflectionNebula,
        ]).toContain(actual);
      } else {
        expect(actual).toBe(expectedType);
      }
    });
  }

  it("puts M31 in Andromeda's direction", () => {
    // RA 00h42m44s, Dec +41d16m: high declination, just past the vernal equinox in RA.
    const entry = byMessier(31)!;
    const z = catalog.directions[entry.i * 3 + 2]!;
    expect(Math.asin(z) * (180 / Math.PI)).toBeCloseTo(41.27, 0);
  });
});

/**
 * The distance layer is where this could quietly go wrong, so it gets the most attention.
 */
describe("distances are derived honestly", () => {
  it("derives most galaxy distances from redshift", () => {
    const withDistance = Array.from({ length: catalog.count }, (_, i) => i).filter((i) =>
      hasDistance(catalog, i),
    );
    expect(withDistance.length).toBeGreaterThan(9_000);
  });

  it("leaves distance unknown where the source has neither redshift nor parallax", () => {
    // ~1,500 objects. Assigning them a nominal depth would be inventing data.
    const unknown = Array.from({ length: catalog.count }, (_, i) => i).filter(
      (i) => !hasDistance(catalog, i),
    );
    expect(unknown.length).toBeGreaterThan(500);
  });

  it("refuses a distance for M31, because Hubble's law does not apply to it", () => {
    // Andromeda is *blueshifted* — it is falling toward us at ~300 km/s. Its peculiar
    // velocity swamps cosmological expansion, so redshift distance is meaningless here.
    // Returning nothing is correct; returning a number would be worse than useless.
    const entry = byMessier(31)!;
    expect(hasDistance(catalog, entry.i)).toBe(false);
  });

  it("puts M87 at roughly the Virgo cluster distance", () => {
    // Published ~16.4 Mpc. Redshift-derived values land near 16-17 Mpc at Planck H0.
    const entry = byMessier(87)!;
    expect(catalog.distancesMpc[entry.i]!).toBeGreaterThan(10);
    expect(catalog.distancesMpc[entry.i]!).toBeLessThan(30);
  });

  it("uses relativistic Doppler, not the naive cz/H0", () => {
    // At z=0.5 the naive form overestimates by ~25%. The difference is small in this
    // catalogue but wrong in a direction that grows.
    const naive = (0.5 * 299_792.458) / HUBBLE_CONSTANTS.planck2018.value;
    const proper = distanceFromRedshift(0.5).megaparsecs;
    expect(proper).toBeLessThan(naive * 0.85);
  });

  it("prefers parallax over redshift, because geometry assumes less", () => {
    const result = bestDistance(2.0, 0.01);
    expect(result.method).toBe("parallax");
  });

  it("returns unknown rather than guessing when it has nothing", () => {
    expect(bestDistance(null, null).method).toBe("unknown");
    expect(bestDistance(0, 0).megaparsecs).toBe(0);
    // A blueshift is not a distance.
    expect(distanceFromRedshift(-0.001).method).toBe("unknown");
  });

  it("converts parallax correctly", () => {
    // 1 mas is 1 kpc by definition.
    expect(distanceFromParallax(1).megaparsecs).toBeCloseTo(0.001, 9);
  });
});

describe("the Hubble tension is exposed, not hidden", () => {
  it("offers both ends of the disagreement", () => {
    expect(HUBBLE_CONSTANTS.planck2018.value).toBeLessThan(HUBBLE_CONSTANTS.sh0es2022.value);
    // They disagree by far more than their stated uncertainties. That is the tension.
    const gap = HUBBLE_CONSTANTS.sh0es2022.value - HUBBLE_CONSTANTS.planck2018.value;
    const combined =
      HUBBLE_CONSTANTS.planck2018.uncertainty + HUBBLE_CONSTANTS.sh0es2022.uncertainty;
    expect(gap).toBeGreaterThan(combined * 3);
  });

  it("records which H0 every redshift distance assumed", () => {
    const d = distanceFromRedshift(0.01);
    expect(d.hubbleConstant?.id).toBe("planck2018");
    expect(d.note).toMatch(/H0=67.4/);
  });

  it("rescales cleanly between the two, since distance goes as 1/H0", () => {
    const planck = distanceFromRedshift(0.02, HUBBLE_CONSTANTS.planck2018).megaparsecs;
    const sh0es = distanceFromRedshift(0.02, HUBBLE_CONSTANTS.sh0es2022).megaparsecs;
    // The whole extragalactic universe shrinks ~8% moving from Planck to SH0ES.
    expect(sh0es).toBeLessThan(planck);
    expect(rescaleForHubble(planck, HUBBLE_CONSTANTS.planck2018, HUBBLE_CONSTANTS.sh0es2022))
      .toBeCloseTo(sh0es, 6);
  });
});

describe("units", () => {
  it("converts megaparsecs to metres", () => {
    expect(megaparsecsToMetres(1)).toBeCloseTo(3.0857e22, -19);
  });

  it("keeps unknown magnitudes out of the visible range", () => {
    const known = Array.from(catalog.magnitudes).filter((m) => m < UNKNOWN_MAGNITUDE);
    expect(known.length).toBeGreaterThan(1_000);
    expect(Math.min(...known)).toBeGreaterThan(-2);
  });
});
