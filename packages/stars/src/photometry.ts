/**
 * Stellar photometry — turning catalogue numbers into something you can render.
 *
 * The chain matters more than any single formula. A star's rendered colour comes from
 * B-V colour index -> effective temperature -> blackbody -> sRGB, which means it uses the
 * *same* `stellarColor()` the renderer uses to light a planet. One physical model, applied
 * consistently, rather than a lookup table tuned by eye.
 *
 * OpenSpace uses a `colorbv.cmap` texture for the same job. A texture is faster; deriving
 * it keeps the star field and the sunlight physically consistent, which is worth more here.
 */

import { stellarColor, type Rgb } from "@aether/physics";

/**
 * Effective temperature from B-V colour index.
 *
 * Ballesteros (2012), EPL 97, 34008. A single closed-form fit derived by treating stars as
 * two-temperature blackbodies; accurate to a few percent across the main sequence, which is
 * far better than the data warrants for rendering.
 *
 *   T = 4600 K * ( 1/(0.92 B-V + 1.7) + 1/(0.92 B-V + 0.62) )
 *
 * Sanity: the Sun's B-V of 0.656 returns 5756 K against a true 5772 K.
 */
export function temperatureFromColourIndex(colourIndex: number): number {
  // Clamp to the range the fit was derived over. Beyond it the formula is not merely
  // imprecise, it goes non-physical.
  const bv = Math.min(Math.max(colourIndex, -0.4), 2.0);
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** Rendered colour of a star, via the same blackbody path used for scene lighting. */
export function starColour(colourIndex: number): Rgb {
  return stellarColor(temperatureFromColourIndex(colourIndex)).linear;
}

/**
 * Apparent magnitude from absolute magnitude and distance — the distance modulus.
 *
 *   m = M + 5 log10(d / 10 pc)
 *
 * This is what makes the sky behave correctly as the camera moves: fly toward a star and it
 * brightens by exactly the right amount, and the constellations distort as they should,
 * because nothing here is painted on a fixed dome.
 */
export function apparentMagnitude(absoluteMagnitude: number, distanceParsecs: number): number {
  if (distanceParsecs <= 0) return -Infinity;
  return absoluteMagnitude + 5 * Math.log10(distanceParsecs) - 5;
}

/** Absolute magnitude back out of an apparent one. */
export function absoluteMagnitude(apparent: number, distanceParsecs: number): number {
  if (distanceParsecs <= 0) return apparent;
  return apparent - 5 * Math.log10(distanceParsecs) + 5;
}

/**
 * Relative flux for a magnitude, normalised so magnitude 0 is 1.0.
 *
 * The magnitude scale is logarithmic and inverted: five magnitudes is a factor of exactly
 * 100 in flux, so each magnitude is 100^(1/5) ~ 2.512.
 */
export function relativeFlux(magnitude: number): number {
  return Math.pow(10, -0.4 * magnitude);
}

/** Magnitude at which a star stops being visible to the unaided eye from a dark site. */
export const NAKED_EYE_LIMIT = 6.5;

export interface RenderScaling {
  /** Magnitude that renders at full brightness. Brighter stars saturate and bloom. */
  referenceMagnitude?: number;
  /** Faintest magnitude drawn at all. */
  limitingMagnitude?: number;
  minPointSize?: number;
  maxPointSize?: number;
}

/**
 * Point size and brightness for a star of a given apparent magnitude.
 *
 * Stars are point sources: a real one is far below a pixel, and what makes a bright star
 * *look* bright on a screen is that it saturates the sensor and blooms. So brightness is
 * physical (flux), while size is a perceptual stand-in for that bloom — deliberately not
 * physical, and deliberately sub-linear, or Sirius would be a dinner plate.
 */
export function renderScale(
  apparentMag: number,
  options: RenderScaling = {},
): { size: number; brightness: number } {
  const reference = options.referenceMagnitude ?? 1.0;
  const limit = options.limitingMagnitude ?? 9.5;
  const minSize = options.minPointSize ?? 0.7;
  const maxSize = options.maxPointSize ?? 7.0;

  if (apparentMag > limit) return { size: 0, brightness: 0 };

  // Physical: flux relative to the reference magnitude.
  const brightness = Math.min(1, relativeFlux(apparentMag - reference));

  // Perceptual: the fourth root compresses a 10^4 flux range into something a screen can
  // show without the brightest stars swallowing the frame.
  const size = minSize + (maxSize - minSize) * Math.pow(brightness, 0.25);

  return { size, brightness };
}

/** Rough spectral class from colour index, for labels and grouping. */
export function spectralClass(colourIndex: number): "O" | "B" | "A" | "F" | "G" | "K" | "M" {
  if (colourIndex < -0.3) return "O";
  if (colourIndex < 0.0) return "B";
  if (colourIndex < 0.3) return "A";
  if (colourIndex < 0.58) return "F";
  if (colourIndex < 0.81) return "G";
  if (colourIndex < 1.4) return "K";
  return "M";
}
