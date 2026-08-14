/**
 * Turning uncertainty into something you can see.
 *
 * The product's central mechanic is that a world *looks* less certain when less is known
 * about it. That only works if the mapping from evidence to appearance is a single, tested
 * function rather than a handful of ad-hoc `lerp` calls sprinkled through the render loop.
 *
 * Three rules, and all three are enforced here rather than trusted:
 *
 *   1. **The floor never reaches zero.** No exoplanet surface has ever been resolved, so no
 *      exoplanet surface is ever drawn as certain. Selecting every mission ever flown or
 *      planned still leaves a visible speculation rim. This is not pessimism; it is the
 *      only defensible position given the data.
 *   2. **Better evidence hardens, it does not certify.** More missions desaturate less and
 *      dim the rim, but the direction of travel stops short of "confident".
 *   3. **Unknown is drawn as unknown.** A planet with no atmospheric constraint gets an
 *      explicit unknown marker, not a plausible-looking haze. Drawing a haze "so it looks
 *      nicer" would be inventing a measurement in the most literal sense.
 */

import type { PlanetModel } from "@aether/catalog";

/**
 * The floor on visible speculation.
 *
 * Matches the envelope-width floor in `@aether/missions`. Kept as a named constant here so
 * that a change to the rendering never quietly removes it: a reviewer looking at this file
 * should be able to see the floor, not have to trace it through two packages.
 */
export const UNRESOLVED_SURFACE_FLOOR = 0.15;

export interface SpeculationStyle {
  /** 0..1, clamped to at least the floor. */
  speculation: number;
  /** How far to pull the surface colour toward neutral grey. */
  desaturation: number;
  /** Opacity of the amber speculation rim. */
  rimOpacity: number;
  /** True when the atmosphere is unconstrained and must be marked, not drawn. */
  atmosphereUnknown: boolean;
  /** One line for the HUD explaining the current visual state. */
  caption: string;
}

/**
 * Visual parameters for a planet model.
 *
 * `desaturation` is capped below 1 so a maximally speculative world is still legible rather
 * than a featureless grey ball — the point is to communicate uncertainty, and an unreadable
 * image communicates nothing.
 */
export function speculationStyle(model: PlanetModel): SpeculationStyle {
  const speculation = Math.min(1, Math.max(UNRESOLVED_SURFACE_FLOOR, model.speculation));

  const atmosphereUnknown =
    model.unknown.surface_pressure !== undefined ||
    model.science.surface_pressure === undefined;

  return {
    speculation,
    desaturation: Math.min(0.85, speculation),
    // Never fully transparent, for the same reason the floor exists.
    rimOpacity: Math.min(0.9, 0.15 + speculation * 0.75),
    atmosphereUnknown,
    caption: captionFor(speculation, atmosphereUnknown),
  };
}

function captionFor(speculation: number, atmosphereUnknown: boolean): string {
  const measured = Math.round((1 - speculation) * 100);
  const atmosphere = atmosphereUnknown ? " Atmosphere unconstrained — none is drawn." : "";

  if (speculation >= 0.75) {
    return `${measured}% constrained by measurement. Most of this world is inference.${atmosphere}`;
  }
  if (speculation >= 0.4) {
    return `${measured}% constrained by measurement. The surface remains a hypothesis.${atmosphere}`;
  }
  return `${measured}% constrained by measurement — as good as exoplanet data currently gets. The surface is still a hypothesis.${atmosphere}`;
}

/**
 * Blend a colour toward neutral grey by the desaturation factor.
 *
 * Returns plain numbers rather than a Three.js colour so this module stays testable without
 * a renderer, and so the science-facing half of the reasoning is not entangled with a
 * rendering library.
 */
export function desaturate(
  rgb: { r: number; g: number; b: number },
  amount: number,
): { r: number; g: number; b: number } {
  const t = Math.min(1, Math.max(0, amount));
  const neutral = { r: 0.55, g: 0.54, b: 0.53 };
  return {
    r: rgb.r + (neutral.r - rgb.r) * t,
    g: rgb.g + (neutral.g - rgb.g) * t,
    b: rgb.b + (neutral.b - rgb.b) * t,
  };
}
