import { describe, expect, it } from "vitest";
import {
  AU,
  EARTH_RADIUS,
  JUPITER_RADIUS,
  PARSEC,
  SOLAR_CONSTANT,
  earthRadii,
  fromCatalogUnit,
  jupiterRadii,
  toEarthRadii,
  toParsecs,
} from "./index.js";

describe("constants", () => {
  it("agrees with published values within tolerance", () => {
    // Parsec, from the exact AU + arcsecond definition. The published value has 17
    // significant digits and a double holds ~16, so the literal here is the nearest
    // representable one rather than the full published string.
    expect(PARSEC).toBeCloseTo(3.085677581491367e16, -1);
    // Solar constant at 1 AU. Published value ~1361 W/m^2; we derive it, so a mismatch
    // here means the luminosity or AU has drifted.
    expect(SOLAR_CONSTANT).toBeGreaterThan(1355);
    expect(SOLAR_CONSTANT).toBeLessThan(1365);
  });

  it("keeps Earth and Jupiter radii distinct by an order of magnitude", () => {
    // The bug this whole package exists to prevent.
    expect(JUPITER_RADIUS / EARTH_RADIUS).toBeCloseTo(11.209, 2);
  });
});

describe("conversions", () => {
  it("round-trips", () => {
    expect(toEarthRadii(earthRadii(1.63))).toBeCloseTo(1.63, 12);
    expect(toParsecs(PARSEC)).toBeCloseTo(1, 12);
  });

  it("does not conflate Earth and Jupiter radii", () => {
    expect(earthRadii(1)).not.toBeCloseTo(jupiterRadii(1), 0);
  });

  it("converts one AU to the defined value", () => {
    expect(fromCatalogUnit(1, "au")).toBe(AU);
  });

  it("throws loudly on an unknown catalog unit", () => {
    // An unlisted unit almost always means an upstream schema change. Failing the ingest
    // is correct; passing the number through unconverted is not.
    expect(() => fromCatalogUnit(1, "furlongs")).toThrow(/Unrecognised catalog unit/);
  });
});
