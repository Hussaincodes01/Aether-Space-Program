/**
 * Adaptive exposure — making every world visible without lying about its illumination.
 *
 * ## The problem
 *
 * Sunlight follows an inverse square law across a range no display can show at once.
 * Normalised to Earth, the Solar System spans four orders of magnitude:
 *
 *   Mercury  6.68     Jupiter  0.0369     Neptune  0.00111
 *   Earth    1.00     Saturn   0.0109     Pluto    0.000642
 *   Mars     0.431    Uranus   0.00272    Eris     0.000218
 *
 * Rendering that linearly makes everything past Mars effectively black. The previous code
 * did exactly that, and then made it worse by clamping the low end: Jupiter, Saturn, Uranus,
 * Neptune, Pluto and Eris all came out at the *same* intensity, so the outer system was both
 * invisible and stripped of its ordering.
 *
 * ## Why brightening it is the more truthful choice
 *
 * A pitch-black Neptune is not the honest rendering. Sunlight at Neptune is 1.5 W/m2 —
 * about **1,150 times** the illumination a full moon gives Earth. Even Eris, at 68 AU, gets
 * **228 times** full moonlight. Full moonlight is enough to walk by, so an observer at any of
 * these worlds would see a plainly lit landscape, not darkness.
 *
 * What is missing from a linear render is not photons, it is **adaptation**. A human eye
 * spans roughly ten orders of magnitude by adjusting, and so does a camera. Modelling that
 * adaptation is what makes the image match what an observer would actually experience.
 *
 * ## What is preserved
 *
 * Ordering and the physics. `relativeInsolation` is the real inverse-square value and is what
 * the HUD reports; `adaptedExposure` is a display transform applied on top, declared as such,
 * and it is monotonic — Mercury always renders brighter than Earth, Earth brighter than
 * Neptune. Only the *ratio* is compressed, never the *ranking*.
 */

import { AU } from "@aether/units";

/** Solar irradiance at 1 AU, W/m^2. */
export const SOLAR_CONSTANT_W_M2 = 1361;

/** Illumination from a full moon at Earth's surface, W/m^2. The reference for "you can see". */
export const FULL_MOON_W_M2 = 0.0013;

/**
 * True insolation relative to Earth, from the inverse square law.
 *
 * Physics, not presentation. This is the number the provenance panel and HUD report.
 */
export function relativeInsolation(
  distanceFromStarM: number,
  luminosityRelativeSun = 1,
): number {
  const au = distanceFromStarM / AU;
  if (!Number.isFinite(au) || au <= 0) return 1;
  return luminosityRelativeSun / (au * au);
}

/** True insolation in W/m^2, for display. */
export function insolationWattsPerM2(
  distanceFromStarM: number,
  luminosityRelativeSun = 1,
): number {
  return SOLAR_CONSTANT_W_M2 * relativeInsolation(distanceFromStarM, luminosityRelativeSun);
}

/**
 * How many times brighter than a full moon on Earth. The "can you see anything" number.
 */
export function versusFullMoon(distanceFromStarM: number, luminosityRelativeSun = 1): number {
  return insolationWattsPerM2(distanceFromStarM, luminosityRelativeSun) / FULL_MOON_W_M2;
}

/**
 * Adaptation exponent.
 *
 * A pure power law standing in for the eye's response. At 0.18 the Solar System's four
 * decades of illumination compress to about 6.4:1 on screen, which fits comfortably inside
 * the tone mapper while leaving every step visible.
 *
 * Lower values flatten harder. Zero would light every world identically, which *would* be a
 * lie; the point is to compress the range, not erase it.
 */
export const ADAPTATION_EXPONENT = 0.18;

/** Overall gain, setting where the adapted scale sits against the tone mapper. */
export const EXPOSURE_GAIN = 3.6;

/** Nothing is ever rendered black, and nothing is ever blown past this. */
export const MIN_EXPOSURE = 0.75;
export const MAX_EXPOSURE = 6.5;

/**
 * Render intensity for a body at this distance from its star.
 *
 * Strictly increasing in illumination, so the ranking always survives; only the ratio is
 * compressed. Purely a viewing transform — it must never feed a physical calculation.
 */
export function adaptedExposure(distanceFromStarM: number, luminosityRelativeSun = 1): number {
  const relative = relativeInsolation(distanceFromStarM, luminosityRelativeSun);
  const adapted = EXPOSURE_GAIN * Math.pow(Math.max(relative, 1e-12), ADAPTATION_EXPONENT);
  return Math.min(Math.max(adapted, MIN_EXPOSURE), MAX_EXPOSURE);
}
