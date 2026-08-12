/**
 * Atmospheric structure and retention.
 *
 * The Jeans parameter is the gate that decides whether a rocky planet is rendered with an
 * atmosphere at all — which makes it one of the highest-leverage numbers in the pipeline.
 * It is also strongly dependent on exobase temperature, which is almost never measured, so
 * the assumption is surfaced rather than hidden.
 */

import { ATOMIC_MASS_UNIT, BOLTZMANN, GRAVITATIONAL_CONSTANT } from "@aether/units";
import { derived } from "../derived-value.js";
import type { Assumption } from "../derived-value.js";
import { defineFormula } from "../registry.js";

/** Mean molecular weight in atomic mass units, for the compositions we care about. */
export const MOLECULAR_WEIGHT = {
  H: 1.008,
  H2: 2.016,
  He: 4.003,
  H2He_solar: 2.34,
  CH4: 16.04,
  H2O: 18.015,
  N2: 28.013,
  O2: 31.999,
  CO2: 44.01,
} as const;

export type SpeciesName = keyof typeof MOLECULAR_WEIGHT;

export interface ScaleHeightInputs {
  temperatureK: number;
  meanMolecularWeightAmu: number;
  surfaceGravityMs2: number;
  temperatureConfidence: number;
  gravityConfidence: number;
  compositionIsRetrieved: boolean;
}

export const scaleHeight = defineFormula<ScaleHeightInputs>({
  id: "scale_height",
  name: "Atmospheric scale height",
  latex: String.raw`H = \frac{k_B T}{\mu m_u g}`,
  description:
    "Vertical distance over which atmospheric pressure falls by a factor of e. Sets how " +
    "thick the atmosphere looks and how strong the limb glow is.",
  references: [],
  unit: "m",
  domain: (i) => {
    if (i.surfaceGravityMs2 <= 0) return "gravity must be positive";
    if (i.meanMolecularWeightAmu <= 0) return "mean molecular weight must be positive";
    return null;
  },
  compute: (i) => {
    const value =
      (BOLTZMANN * i.temperatureK) /
      (i.meanMolecularWeightAmu * ATOMIC_MASS_UNIT * i.surfaceGravityMs2);

    const assumptions: Assumption[] = [];
    if (!i.compositionIsRetrieved) {
      assumptions.push({
        parameter: "meanMolecularWeightAmu",
        value: i.meanMolecularWeightAmu,
        unit: "u",
        rationale:
          "No atmospheric composition has been retrieved for this planet; a mean molecular " +
          "weight is assumed from the planet class. Scale height is inversely proportional " +
          "to it, so an H/He envelope and a CO2 atmosphere differ by more than an order of " +
          "magnitude.",
        userAdjustable: true,
      });
    }

    return derived({
      value,
      unit: "m",
      formulaId: "scale_height",
      inputsUsed: ["derived.equilibrium_temperature", "derived.surface_gravity"],
      inputConfidences: [i.temperatureConfidence, i.gravityConfidence],
      assumptions,
    });
  },
});

export interface JeansInputs {
  massKg: number;
  radiusM: number;
  /** Exobase temperature, typically well above T_eq and rarely constrained. */
  exobaseTemperatureK: number;
  speciesMassAmu: number;
  exobaseTemperatureIsMeasured: boolean;
  massConfidence: number;
  radiusConfidence: number;
}

/**
 * Jeans escape parameter λ.
 *
 * λ ≲ 6 implies rapid hydrodynamic escape of the species over geological time; λ ≳ 15–20
 * implies secure retention. Between those the answer depends on history the data cannot
 * supply, which is exactly the sort of thing the confidence badge exists to communicate.
 */
export const jeansParameter = defineFormula<JeansInputs>({
  id: "jeans_parameter",
  name: "Jeans escape parameter",
  latex: String.raw`\lambda = \frac{G M m}{k_B T_{\mathrm{exo}} R}`,
  description:
    "Ratio of gravitational binding energy to thermal energy for one molecule at the " +
    "exobase. Gates whether the planet plausibly retains a given gas.",
  references: ["2017ApJ...843..122Z"],
  unit: "1",
  domain: (i) => {
    if (i.radiusM <= 0) return "radius must be positive";
    if (i.exobaseTemperatureK <= 0) return "exobase temperature must be positive";
    return null;
  },
  compute: (i) => {
    const value =
      (GRAVITATIONAL_CONSTANT * i.massKg * i.speciesMassAmu * ATOMIC_MASS_UNIT) /
      (BOLTZMANN * i.exobaseTemperatureK * i.radiusM);

    const assumptions: Assumption[] = [];
    if (!i.exobaseTemperatureIsMeasured) {
      assumptions.push({
        parameter: "exobaseTemperatureK",
        value: i.exobaseTemperatureK,
        unit: "K",
        rationale:
          "Exobase temperature is not measured for any planet in the catalog; it is scaled " +
          "from the equilibrium temperature. λ is inversely proportional to it.",
        userAdjustable: true,
      });
    }

    return derived({
      value,
      unit: "1",
      formulaId: "jeans_parameter",
      inputsUsed: ["planet.massKg", "planet.radiusM", "derived.equilibrium_temperature"],
      inputConfidences: [i.massConfidence, i.radiusConfidence],
      assumptions,
    });
  },
});

/** λ thresholds, named rather than inlined so the terrain gates can cite them. */
export const JEANS_RAPID_ESCAPE = 6;
export const JEANS_SECURE_RETENTION = 15;

export type RetentionVerdict = "escapes" | "marginal" | "retained";

export function retentionVerdict(lambda: number): RetentionVerdict {
  if (lambda < JEANS_RAPID_ESCAPE) return "escapes";
  if (lambda < JEANS_SECURE_RETENTION) return "marginal";
  return "retained";
}
