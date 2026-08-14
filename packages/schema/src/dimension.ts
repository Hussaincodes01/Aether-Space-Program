/**
 * Unit dimensions and physical domains.
 *
 * The resolver used to accept a `unit` on every request and then never look at it. That is
 * worse than not asking: it reads like a checked contract at every call site while
 * guaranteeing nothing, so a placeholder in kelvin could satisfy a request for metres and
 * the only symptom would be a planet the wrong size.
 *
 * Two independent checks live here, and they catch different mistakes:
 *
 *   1. **Dimension.** Is the stored unit the same *kind* of quantity as the one requested?
 *      Catches "kelvin where metres were wanted". Purely structural.
 *   2. **Domain.** Is the number physically admissible for that quantity? Catches a negative
 *      radius, a temperature below absolute zero, an albedo of 1.4. Structurally fine,
 *      physically impossible.
 *
 * A value must pass both. Neither subsumes the other.
 */

/**
 * SI base dimensions as an exponent vector: mass, length, time, temperature.
 *
 * Four are enough for everything Aether carries. Adding current or amount of substance
 * means widening this tuple and nothing else.
 */
export interface Dimension {
  readonly mass: number;
  readonly length: number;
  readonly time: number;
  readonly temperature: number;
}

const dim = (mass = 0, length = 0, time = 0, temperature = 0): Dimension => ({
  mass,
  length,
  time,
  temperature,
});

export const DIMENSIONLESS = dim();

/**
 * Known unit strings.
 *
 * Deliberately a closed set. An unrecognised unit is treated as an error rather than
 * silently assumed compatible, because "we have not seen this unit before" and "this unit
 * is fine" are very different statements and only one of them is safe to act on.
 *
 * Aliases are included because catalogue ingestion sees all of these spellings in the wild.
 */
const UNIT_DIMENSIONS: Readonly<Record<string, Dimension>> = {
  // Base.
  "1": DIMENSIONLESS,
  "": DIMENSIONLESS,
  m: dim(0, 1),
  kg: dim(1),
  s: dim(0, 0, 1),
  K: dim(0, 0, 0, 1),

  // Derived, in the spellings the codebase actually uses.
  "m/s": dim(0, 1, -1),
  "m/s^2": dim(0, 1, -2),
  "m/s2": dim(0, 1, -2),
  "kg/m^3": dim(1, -3),
  "kg/m3": dim(1, -3),
  Pa: dim(1, -1, -2),
  W: dim(1, 2, -3),
  "W/m^2": dim(1, 0, -3),
  "W/m2": dim(1, 0, -3),
  J: dim(1, 2, -2),
  "m^2": dim(0, 2),
  "m^3": dim(0, 3),

  /**
   * Angles are dimensionless in strict SI, but treating radians as interchangeable with a
   * mixing ratio would let an inclination satisfy a request for an albedo. Kept distinct by
   * giving them their own pseudo-dimension slot in `temperature`'s place would be a hack, so
   * instead they are compared by name — see `unitsCompatible`.
   */
  rad: DIMENSIONLESS,
  deg: DIMENSIONLESS,
};

/** Units that are dimensionless but must not be interchanged with a plain ratio. */
const ANGLE_UNITS = new Set(["rad", "deg"]);

export function isKnownUnit(unit: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNIT_DIMENSIONS, unit);
}

export function dimensionOf(unit: string): Dimension | null {
  return UNIT_DIMENSIONS[unit] ?? null;
}

export function dimensionsEqual(a: Dimension, b: Dimension): boolean {
  return (
    a.mass === b.mass &&
    a.length === b.length &&
    a.time === b.time &&
    a.temperature === b.temperature
  );
}

/**
 * Can a value stored in `have` answer a request for `want`?
 *
 * Unknown units are never compatible, including with themselves — if we cannot say what a
 * unit means we cannot say it matches. Angles are compatible only with angles, despite
 * being formally dimensionless.
 */
export function unitsCompatible(have: string, want: string): boolean {
  const a = dimensionOf(have);
  const b = dimensionOf(want);
  if (a === null || b === null) return false;

  const angleA = ANGLE_UNITS.has(have);
  const angleB = ANGLE_UNITS.has(want);
  if (angleA !== angleB) return false;

  return dimensionsEqual(a, b);
}

// -- Physical domains --------------------------------------------------------------------

export interface DomainViolation {
  reason: string;
}

/**
 * Quantities that cannot be negative, whatever the field is called.
 *
 * A negative absolute temperature, mass, pressure or irradiance is not a small error; it is
 * a sign that a conversion ran the wrong way or a subtraction was written backwards, and it
 * should stop the pipeline rather than render as a strange-looking world.
 */
const NON_NEGATIVE_UNITS = new Set([
  "kg",
  "K",
  "Pa",
  "W",
  "W/m^2",
  "W/m2",
  "kg/m^3",
  "kg/m3",
  "m^2",
  "m^3",
]);

/** Quantities that must be strictly positive: a zero here means "no body", not "small". */
const POSITIVE_UNITS = new Set(["kg/m^3", "kg/m3"]);

/**
 * Field-level domains that the unit alone cannot express.
 *
 * Matched on a normalised field name so `bondAlbedo`, `bond_albedo` and `bond-albedo` all
 * hit the same rule — the same naming-convention trap that once left the LLM forbidden-field
 * scan silently dead.
 */
const FIELD_DOMAINS: ReadonlyArray<{
  match: RegExp;
  min: number;
  max: number;
  note: string;
}> = [
  { match: /\balbedo\b/, min: 0, max: 1, note: "an albedo is a reflected fraction" },
  {
    match: /\beccentricity\b/,
    min: 0,
    max: 1,
    note: "a bound orbit has eccentricity below 1",
  },
  {
    match: /\b(hydrosphere|cloud|haze|ice) (fraction|coverage)\b/,
    min: 0,
    max: 1,
    note: "a surface fraction",
  },
  { match: /\bmixing ratio\b/, min: 0, max: 1, note: "a mixing ratio is a fraction" },
  { match: /\bconfidence\b/, min: 0, max: 1, note: "confidence is a probability" },
];

/**
 * Fields that must be strictly positive whatever their unit says.
 *
 * A length is signed in general — an offset of -3 m is perfectly ordinary — so `m` cannot be
 * marked non-negative wholesale. But a *radius* of -3 m is not a small planet, it is a sign
 * conversion that ran backwards, and it must not reach a renderer that will happily scale a
 * mesh by it.
 */
const POSITIVE_FIELDS =
  /\b(radius|diameter|distance|semi major axis|period|scale height|wavelength|luminosity|mass)\b/;

/** Shared with the LLM boundary scanner: underscores, dashes and camelCase all normalise. */
export function normaliseFieldName(field: string): string {
  return field
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/**
 * Check a value against the physical domain implied by its unit and field name.
 *
 * Returns `null` when admissible, or the reason it is not. A reason rather than a boolean
 * because this text ends up in the provenance inspector, where "rejected" without a cause is
 * only marginally more useful than a blank space.
 */
export function checkDomain(
  value: number,
  unit: string,
  field: string,
): DomainViolation | null {
  if (!Number.isFinite(value)) {
    return { reason: `${field} is ${value}, which is not a finite number` };
  }

  if (POSITIVE_UNITS.has(unit) && value <= 0) {
    return { reason: `${field} must be strictly positive in ${unit}, got ${value}` };
  }

  if (NON_NEGATIVE_UNITS.has(unit) && value < 0) {
    return { reason: `${field} cannot be negative in ${unit}, got ${value}` };
  }

  const normalised = normaliseFieldName(field);

  if (POSITIVE_FIELDS.test(normalised) && value <= 0) {
    return { reason: `${field} must be strictly positive, got ${value} ${unit}` };
  }

  for (const rule of FIELD_DOMAINS) {
    if (!rule.match.test(normalised)) continue;
    if (value < rule.min || value > rule.max) {
      return {
        reason: `${field} must be within [${rule.min}, ${rule.max}] because it is ${rule.note}, got ${value}`,
      };
    }
  }

  return null;
}
