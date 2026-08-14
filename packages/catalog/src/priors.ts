/**
 * Population priors.
 *
 * A prior is what stands in when a mission selection — or the universe — has not supplied a
 * measurement. It is returned as a distribution rather than a scalar, and the caller is
 * required to keep it in the inference layer, because collapsing it to a median is exactly
 * how "we do not know this planet's radius" becomes "this planet's radius is 6.4e6 m".
 */

import { EARTH_MASS, EARTH_RADIUS } from "@aether/units";
import type { Distribution } from "@aether/schema";

/**
 * Chen & Kipping (2017) probabilistic mass-radius relation, Terran and Neptunian regimes.
 *
 * Forecaster fits a broken power law with intrinsic scatter, and the scatter is the point:
 * two planets of the same mass genuinely differ in radius by tens of percent, so a relation
 * that returned a single radius would be claiming a precision the data does not contain.
 *
 * The transition at 2.04 Earth masses is the fitted Terran/Neptunian break. Above roughly
 * 130 Earth masses the relation turns over into the Jovian regime, where radius stops
 * increasing with mass; a caller asking about a planet there gets an out-of-distribution
 * flag rather than a confident extrapolation.
 */
const TERRAN_MAX_MEARTH = 2.04;
const NEPTUNIAN_MAX_MEARTH = 131.6;

const TERRAN_EXPONENT = 0.279;
const NEPTUNIAN_EXPONENT = 0.589;

/** Intrinsic scatter in dex, from the same fit. Wider for Neptunians, as observed. */
const TERRAN_SCATTER_DEX = 0.041;
const NEPTUNIAN_SCATTER_DEX = 0.146;

export const MASS_RADIUS_MODEL_ID = "chen-kipping-2017-forecaster";

/**
 * Radius distribution for a given mass.
 *
 * The quantiles come from applying the lognormal scatter to the power-law median, so p16 and
 * p84 are the one-sigma band of the *relation*, not of the mass measurement. That is the
 * honest reading: even a perfectly measured mass leaves this much room in the radius.
 */
export function massRadiusPrior(massKg: number): Distribution {
  const massEarth = massKg / EARTH_MASS;

  const { exponent, scatterDex, ood } = regimeFor(massEarth);

  // Both regimes are normalised so that 1 Earth mass gives 1 Earth radius, which the
  // Terran fit does by construction and the Neptunian branch is matched to at the break.
  const radiusEarth =
    massEarth <= TERRAN_MAX_MEARTH
      ? Math.pow(massEarth, exponent)
      : Math.pow(TERRAN_MAX_MEARTH, TERRAN_EXPONENT) *
        Math.pow(massEarth / TERRAN_MAX_MEARTH, exponent);

  const median = radiusEarth * EARTH_RADIUS;
  const spread = Math.pow(10, scatterDex);

  return {
    median,
    p16: median / spread,
    p84: median * spread,
    p02_5: median / (spread * spread),
    p97_5: median * spread * spread,
    unit: "m",
    method: "prior",
    modelId: MASS_RADIUS_MODEL_ID,
    oodFlag: ood,
  };
}

function regimeFor(massEarth: number): {
  exponent: number;
  scatterDex: number;
  ood: boolean;
} {
  if (massEarth <= 0) {
    // Not a physical mass. Flagged rather than thrown, so the resolver's domain check is
    // the single place that decides what to do about it.
    return { exponent: TERRAN_EXPONENT, scatterDex: TERRAN_SCATTER_DEX, ood: true };
  }
  if (massEarth <= TERRAN_MAX_MEARTH) {
    return { exponent: TERRAN_EXPONENT, scatterDex: TERRAN_SCATTER_DEX, ood: false };
  }
  if (massEarth <= NEPTUNIAN_MAX_MEARTH) {
    return { exponent: NEPTUNIAN_EXPONENT, scatterDex: NEPTUNIAN_SCATTER_DEX, ood: false };
  }
  // Jovian regime: radius stops tracking mass, and this relation no longer applies.
  return { exponent: NEPTUNIAN_EXPONENT, scatterDex: NEPTUNIAN_SCATTER_DEX, ood: true };
}
