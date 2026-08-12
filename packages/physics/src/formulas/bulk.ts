/**
 * Bulk planetary properties from mass and radius.
 *
 * These are textbook identities with no free parameters — the cheapest, most defensible
 * values in the whole system, and the ones a reviewer will check first.
 */

import { GRAVITATIONAL_CONSTANT } from "@aether/units";
import { derived, propagatePowerLaw, symmetrise } from "../derived-value.js";
import { defineFormula } from "../registry.js";

export interface MassRadiusInputs {
  massKg: number;
  radiusM: number;
  massUncertainty?: { minus: number; plus: number };
  radiusUncertainty?: { minus: number; plus: number };
  massConfidence: number;
  radiusConfidence: number;
}

export const bulkDensity = defineFormula<MassRadiusInputs>({
  id: "bulk_density",
  name: "Bulk density",
  latex: String.raw`\rho = \frac{3M}{4\pi R^3}`,
  description: "Mean density of the planet from its mass and radius.",
  references: [],
  unit: "kg/m^3",
  domain: (i) =>
    i.radiusM > 0 && i.massKg > 0 ? null : "mass and radius must both be positive",
  compute: (i) => {
    const value = (3 * i.massKg) / (4 * Math.PI * i.radiusM ** 3);
    return derived({
      value,
      unit: "kg/m^3",
      formulaId: "bulk_density",
      inputsUsed: ["planet.massKg", "planet.radiusM"],
      inputConfidences: [i.massConfidence, i.radiusConfidence],
      uncertainty: propagatePowerLaw(value, [
        { value: i.massKg, sigma: symmetrise(i.massUncertainty), exponent: 1 },
        { value: i.radiusM, sigma: symmetrise(i.radiusUncertainty), exponent: -3 },
      ]),
    });
  },
});

export const surfaceGravity = defineFormula<MassRadiusInputs>({
  id: "surface_gravity",
  name: "Surface gravity",
  latex: String.raw`g = \frac{GM}{R^2}`,
  description: "Gravitational acceleration at the planet's reference radius.",
  references: [],
  unit: "m/s^2",
  domain: (i) => (i.radiusM > 0 ? null : "radius must be positive"),
  compute: (i) => {
    const value = (GRAVITATIONAL_CONSTANT * i.massKg) / i.radiusM ** 2;
    return derived({
      value,
      unit: "m/s^2",
      formulaId: "surface_gravity",
      inputsUsed: ["planet.massKg", "planet.radiusM"],
      inputConfidences: [i.massConfidence, i.radiusConfidence],
      uncertainty: propagatePowerLaw(value, [
        { value: i.massKg, sigma: symmetrise(i.massUncertainty), exponent: 1 },
        { value: i.radiusM, sigma: symmetrise(i.radiusUncertainty), exponent: -2 },
      ]),
    });
  },
});

export const escapeVelocity = defineFormula<MassRadiusInputs>({
  id: "escape_velocity",
  name: "Escape velocity",
  latex: String.raw`v_{\mathrm{esc}} = \sqrt{\frac{2GM}{R}}`,
  description: "Speed needed to escape the planet's gravity from its reference radius.",
  references: [],
  unit: "m/s",
  domain: (i) => (i.radiusM > 0 && i.massKg > 0 ? null : "mass and radius must be positive"),
  compute: (i) => {
    const value = Math.sqrt((2 * GRAVITATIONAL_CONSTANT * i.massKg) / i.radiusM);
    return derived({
      value,
      unit: "m/s",
      formulaId: "escape_velocity",
      inputsUsed: ["planet.massKg", "planet.radiusM"],
      inputConfidences: [i.massConfidence, i.radiusConfidence],
      uncertainty: propagatePowerLaw(value, [
        { value: i.massKg, sigma: symmetrise(i.massUncertainty), exponent: 0.5 },
        { value: i.radiusM, sigma: symmetrise(i.radiusUncertainty), exponent: -0.5 },
      ]),
    });
  },
});
