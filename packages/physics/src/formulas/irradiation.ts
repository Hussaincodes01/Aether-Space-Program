/**
 * Stellar irradiation and equilibrium temperature.
 *
 * Equilibrium temperature is the most-quoted and most-misunderstood number in exoplanet
 * science. It is a radiative-balance blackbody temperature with **no greenhouse effect**,
 * and it depends on two quantities almost nobody has measured: Bond albedo and heat
 * redistribution. Both are exposed here as explicit, user-adjustable assumptions rather
 * than buried constants, because changing them changes the answer by tens of kelvin and a
 * user is entitled to see that.
 */

import { SOLAR_CONSTANT } from "@aether/units";
import { derived, propagatePowerLaw, symmetrise } from "../derived-value.js";
import type { Assumption } from "../derived-value.js";
import { defineFormula } from "../registry.js";

export interface InsolationInputs {
  luminosityW: number;
  semimajorAxisM: number;
  luminosityUncertainty?: { minus: number; plus: number };
  axisUncertainty?: { minus: number; plus: number };
  luminosityConfidence: number;
  axisConfidence: number;
}

export const insolation = defineFormula<InsolationInputs>({
  id: "insolation",
  name: "Insolation",
  latex: String.raw`S = \frac{L_\star}{4\pi a^2}`,
  description: "Stellar flux received at the planet's orbital distance.",
  references: [],
  unit: "W/m^2",
  domain: (i) => (i.semimajorAxisM > 0 ? null : "semimajor axis must be positive"),
  compute: (i) => {
    const value = i.luminosityW / (4 * Math.PI * i.semimajorAxisM ** 2);
    return derived({
      value,
      unit: "W/m^2",
      formulaId: "insolation",
      inputsUsed: ["host.luminosityW", "planet.orbit.semimajorAxisM"],
      inputConfidences: [i.luminosityConfidence, i.axisConfidence],
      uncertainty: propagatePowerLaw(value, [
        { value: i.luminosityW, sigma: symmetrise(i.luminosityUncertainty), exponent: 1 },
        { value: i.semimajorAxisM, sigma: symmetrise(i.axisUncertainty), exponent: -2 },
      ]),
    });
  },
});

/** Insolation in Earth units — the form every catalog and every paper quotes. */
export function insolationEarthUnits(wattsPerSquareMetre: number): number {
  return wattsPerSquareMetre / SOLAR_CONSTANT;
}

export interface EquilibriumTemperatureInputs {
  starEffectiveTemperatureK: number;
  starRadiusM: number;
  semimajorAxisM: number;
  /** Bond albedo. Measured for a handful of planets; assumed for the rest. */
  bondAlbedo: number;
  bondAlbedoIsMeasured: boolean;
  /**
   * Heat redistribution factor `f`.
   *   0.25 — full redistribution around the planet (the usual default)
   *   0.5  — dayside only, no redistribution (tidally locked, thin atmosphere)
   * Cowan & Agol 2011 discuss the physical range between them.
   */
  redistributionFactor: number;
  starTempUncertainty?: { minus: number; plus: number };
  starRadiusUncertainty?: { minus: number; plus: number };
  axisUncertainty?: { minus: number; plus: number };
  starTempConfidence: number;
  starRadiusConfidence: number;
  axisConfidence: number;
}

export const equilibriumTemperature = defineFormula<EquilibriumTemperatureInputs>({
  id: "equilibrium_temperature",
  name: "Equilibrium temperature",
  latex: String.raw`T_{\mathrm{eq}} = T_\star \sqrt{\frac{R_\star}{a}}\left[f(1-A_B)\right]^{1/4}`,
  description:
    "Radiative-equilibrium blackbody temperature. Excludes any greenhouse effect, so a " +
    "planet with a thick atmosphere will be warmer than this at the surface.",
  references: ["2011ApJ...729...54C"],
  unit: "K",
  domain: (i) => {
    if (i.semimajorAxisM <= 0) return "semimajor axis must be positive";
    if (i.bondAlbedo < 0 || i.bondAlbedo >= 1) return "Bond albedo must lie in [0, 1)";
    if (i.redistributionFactor <= 0 || i.redistributionFactor > 1) {
      return "redistribution factor must lie in (0, 1]";
    }
    return null;
  },
  compute: (i) => {
    const value =
      i.starEffectiveTemperatureK *
      Math.sqrt(i.starRadiusM / i.semimajorAxisM) *
      Math.pow(i.redistributionFactor * (1 - i.bondAlbedo), 0.25);

    const assumptions: Assumption[] = [];
    if (!i.bondAlbedoIsMeasured) {
      assumptions.push({
        parameter: "bondAlbedo",
        value: i.bondAlbedo,
        unit: "1",
        rationale:
          "No Bond albedo measurement exists for this planet; a representative value is " +
          "assumed. T_eq scales as (1-A)^(1/4), so this choice materially changes the result.",
        userAdjustable: true,
      });
    }
    assumptions.push({
      parameter: "redistributionFactor",
      value: i.redistributionFactor,
      unit: "1",
      rationale:
        i.redistributionFactor === 0.25
          ? "Full day-night heat redistribution assumed."
          : "Reduced heat redistribution assumed; dayside runs hotter.",
      userAdjustable: true,
    });

    return derived({
      value,
      unit: "K",
      formulaId: "equilibrium_temperature",
      inputsUsed: [
        "host.effectiveTemperatureK",
        "host.radiusM",
        "planet.orbit.semimajorAxisM",
        "planet.bondAlbedo",
      ],
      inputConfidences: [i.starTempConfidence, i.starRadiusConfidence, i.axisConfidence],
      uncertainty: propagatePowerLaw(value, [
        {
          value: i.starEffectiveTemperatureK,
          sigma: symmetrise(i.starTempUncertainty),
          exponent: 1,
        },
        { value: i.starRadiusM, sigma: symmetrise(i.starRadiusUncertainty), exponent: 0.5 },
        { value: i.semimajorAxisM, sigma: symmetrise(i.axisUncertainty), exponent: -0.5 },
      ]),
      assumptions,
    });
  },
});

/** Conventional defaults, named so they are searchable and reviewable in one place. */
export const FULL_REDISTRIBUTION = 0.25;
export const DAYSIDE_ONLY = 0.5;
/** Earth's Bond albedo, the least-bad generic default for a terrestrial world. */
export const DEFAULT_BOND_ALBEDO = 0.3;
