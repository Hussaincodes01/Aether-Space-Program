/**
 * Habitable zone boundaries — Kopparapu et al. 2013, with the 2014 erratum coefficients.
 *
 * Four boundaries are computed, not two. The conservative pair (runaway greenhouse,
 * maximum greenhouse) and the optimistic pair (recent Venus, early Mars) disagree by a
 * wide margin, and showing both is more honest than picking one and drawing a green band.
 */

import { AU } from "@aether/units";
import { derived } from "../derived-value.js";
import { defineFormula } from "../registry.js";

interface Coefficients {
  seffSun: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Coefficients for a 1 M⊕ planet. Valid for 2600 K ≤ T_eff ≤ 7200 K. */
const COEFFICIENTS = {
  recentVenus: {
    seffSun: 1.7763,
    a: 1.4335e-4,
    b: 3.3954e-9,
    c: -7.6364e-12,
    d: -1.195e-15,
  },
  runawayGreenhouse: {
    seffSun: 1.014,
    a: 8.1774e-5,
    b: 1.7063e-9,
    c: -4.3241e-12,
    d: -6.6462e-16,
  },
  maximumGreenhouse: {
    seffSun: 0.3438,
    a: 5.8942e-5,
    b: 1.6558e-9,
    c: -3.0045e-12,
    d: -5.2983e-16,
  },
  earlyMars: {
    seffSun: 0.3179,
    a: 5.4513e-5,
    b: 1.5313e-9,
    c: -2.7786e-12,
    d: -4.8997e-16,
  },
} as const satisfies Record<string, Coefficients>;

export type HabitableZoneBoundary = keyof typeof COEFFICIENTS;

const T_REFERENCE = 5780;

function effectiveFlux(coeff: Coefficients, effectiveTemperatureK: number): number {
  const t = effectiveTemperatureK - T_REFERENCE;
  return coeff.seffSun + coeff.a * t + coeff.b * t ** 2 + coeff.c * t ** 3 + coeff.d * t ** 4;
}

export interface HabitableZoneInputs {
  /** In solar units — the form the Kopparapu parameterisation expects. */
  luminositySolar: number;
  effectiveTemperatureK: number;
  luminosityConfidence: number;
  temperatureConfidence: number;
}

export interface HabitableZoneBounds {
  recentVenusM: number;
  runawayGreenhouseM: number;
  maximumGreenhouseM: number;
  earlyMarsM: number;
}

/** Distance in metres at which the planet receives `S_eff` relative to Earth. */
function boundaryDistance(luminositySolar: number, seff: number): number {
  return Math.sqrt(luminositySolar / seff) * AU;
}

export const habitableZone = defineFormula<HabitableZoneInputs>({
  id: "habitable_zone",
  name: "Habitable zone bounds",
  latex: String.raw`d = \sqrt{\frac{L/L_\odot}{S_{\mathrm{eff}}}}\,\mathrm{AU},\quad
S_{\mathrm{eff}} = S_{\odot} + aT_\star + bT_\star^2 + cT_\star^3 + dT_\star^4`,
  description:
    "Conservative and optimistic habitable-zone boundaries for a 1 Earth-mass planet with " +
    "an H2O-CO2-N2 atmosphere.",
  references: ["2013ApJ...765..131K", "2014ApJ...787L..29K"],
  unit: "m",
  domain: (i) => {
    if (i.effectiveTemperatureK < 2600 || i.effectiveTemperatureK > 7200) {
      return (
        `stellar effective temperature ${i.effectiveTemperatureK.toFixed(0)} K is outside ` +
        `the 2600-7200 K range the Kopparapu parameterisation was fitted over`
      );
    }
    if (i.luminositySolar <= 0) return "luminosity must be positive";
    return null;
  },
  /**
   * Returns the runaway-greenhouse (conservative inner) edge as the scalar value, because
   * a DerivedValue carries one number. Callers wanting all four use `habitableZoneBounds`.
   */
  compute: (i) => {
    const seff = effectiveFlux(COEFFICIENTS.runawayGreenhouse, i.effectiveTemperatureK);
    return derived({
      value: boundaryDistance(i.luminositySolar, seff),
      unit: "m",
      formulaId: "habitable_zone",
      inputsUsed: ["host.luminosityW", "host.effectiveTemperatureK"],
      inputConfidences: [i.luminosityConfidence, i.temperatureConfidence],
    });
  },
});

/** All four boundaries. The UI draws two bands, conservative inside optimistic. */
export function habitableZoneBounds(i: HabitableZoneInputs): HabitableZoneBounds {
  const at = (b: HabitableZoneBoundary): number =>
    boundaryDistance(i.luminositySolar, effectiveFlux(COEFFICIENTS[b], i.effectiveTemperatureK));

  return {
    recentVenusM: at("recentVenus"),
    runawayGreenhouseM: at("runawayGreenhouse"),
    maximumGreenhouseM: at("maximumGreenhouse"),
    earlyMarsM: at("earlyMars"),
  };
}

export type HabitableZonePosition =
  | "too_hot"
  | "optimistic_inner"
  | "conservative"
  | "optimistic_outer"
  | "too_cold";

export function habitableZonePosition(
  semimajorAxisM: number,
  bounds: HabitableZoneBounds,
): HabitableZonePosition {
  if (semimajorAxisM < bounds.recentVenusM) return "too_hot";
  if (semimajorAxisM < bounds.runawayGreenhouseM) return "optimistic_inner";
  if (semimajorAxisM <= bounds.maximumGreenhouseM) return "conservative";
  if (semimajorAxisM <= bounds.earlyMarsM) return "optimistic_outer";
  return "too_cold";
}
