/**
 * Stellar colour from effective temperature.
 *
 * This is where science visibly becomes visuals: an M-dwarf at 2566 K is genuinely,
 * measurably orange-red, and a world lit by one looks nothing like a world lit by the Sun.
 * Faking this would throw away one of the few places the data speaks for itself.
 *
 * Path: T_eff -> Planckian locus chromaticity (Kim et al. 2002 approximation)
 *       -> CIE xyY -> XYZ -> linear sRGB -> gamma-encoded sRGB.
 *
 * The renderer wants the **linear** value; only the UI swatch wants the gamma-encoded one.
 * Both are returned, because mixing them up produces a subtly wrong sky that is very hard
 * to debug after the fact.
 */

import { derived } from "../derived-value.js";
import { defineFormula } from "../registry.js";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * CIE 1931 chromaticity of a blackbody. Kim et al. (2002) cubic approximation to the
 * Planckian locus, valid for 1667 K - 25000 K, which covers every star we render.
 */
export function planckianLocusXy(temperatureK: number): { x: number; y: number } {
  const T = Math.min(Math.max(temperatureK, 1667), 25000);
  const t = 1000 / T; // work in inverse kilokelvin to keep the terms well-scaled

  const x =
    T <= 4000
      ? -0.2661239 * t ** 3 - 0.2343589 * t ** 2 + 0.8776956 * t + 0.17991
      : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;

  let y: number;
  if (T <= 2222) {
    y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  } else if (T <= 4000) {
    y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  }

  return { x, y };
}

/** CIE xyY (at Y = 1) to CIE XYZ. */
function xyToXyz(x: number, y: number): { X: number; Y: number; Z: number } {
  if (y === 0) return { X: 0, Y: 0, Z: 0 };
  return { X: x / y, Y: 1, Z: (1 - x - y) / y };
}

/** CIE XYZ to linear sRGB, using the standard D65 matrix. */
function xyzToLinearSrgb({ X, Y, Z }: { X: number; Y: number; Z: number }): Rgb {
  return {
    r: 3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    g: -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    b: 0.0557 * X - 0.204 * Y + 1.057 * Z,
  };
}

/**
 * Scale into gamut without changing hue.
 *
 * Clipping negative channels individually would shift the hue — a deep-red M-dwarf would
 * drift toward orange. Instead we lift by the most-negative channel, then normalise.
 */
function normaliseToGamut(c: Rgb): Rgb {
  const lift = Math.min(0, c.r, c.g, c.b);
  const r = c.r - lift;
  const g = c.g - lift;
  const b = c.b - lift;
  const peak = Math.max(r, g, b);
  if (peak <= 0) return { r: 0, g: 0, b: 0 };
  return { r: r / peak, g: g / peak, b: b / peak };
}

/** Linear to gamma-encoded sRGB, for display only. */
export function encodeSrgb(c: Rgb): Rgb {
  const enc = (v: number): number => {
    const x = Math.min(Math.max(v, 0), 1);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };
  return { r: enc(c.r), g: enc(c.g), b: enc(c.b) };
}

export interface StellarColor {
  /** Feed this to the renderer's light colour. */
  linear: Rgb;
  /** Use this for UI swatches and CSS only. */
  encoded: Rgb;
  chromaticity: { x: number; y: number };
}

export function stellarColor(effectiveTemperatureK: number): StellarColor {
  const chromaticity = planckianLocusXy(effectiveTemperatureK);
  const linear = normaliseToGamut(xyzToLinearSrgb(xyToXyz(chromaticity.x, chromaticity.y)));
  return { linear, encoded: encodeSrgb(linear), chromaticity };
}

export interface StellarColorInputs {
  effectiveTemperatureK: number;
  temperatureConfidence: number;
}

/**
 * Registered wrapper. The DerivedValue carries the chromaticity x as its scalar so the
 * provenance chain has something to show; callers use `stellarColor` for the full result.
 */
export const stellarColorFormula = defineFormula<StellarColorInputs>({
  id: "blackbody_to_srgb",
  name: "Stellar colour from effective temperature",
  latex: String.raw`B_\lambda(T) \rightarrow (x,y) \rightarrow XYZ \rightarrow \mathrm{sRGB}`,
  description:
    "Converts a star's effective temperature to a physically motivated display colour via " +
    "the Planckian locus. Drives all scene lighting.",
  references: ["Kim et al. 2002, IEEE CVPR"],
  unit: "1",
  domain: (i) =>
    i.effectiveTemperatureK > 0 ? null : "effective temperature must be positive",
  compute: (i) => {
    const { chromaticity } = stellarColor(i.effectiveTemperatureK);
    return derived({
      value: chromaticity.x,
      unit: "1",
      formulaId: "blackbody_to_srgb",
      inputsUsed: ["host.effectiveTemperatureK"],
      inputConfidences: [i.temperatureConfidence],
    });
  },
});
