/**
 * Formatting SI values for display.
 *
 * Everything in the pipeline is SI, which is right for computation and unreadable on
 * screen: nobody wants a planet radius of 5866452 m or an orbital period of 527127.5 s. The
 * conversion to a human unit happens here, at the very last step, and only here.
 *
 * Two rules the formatters follow:
 *
 *   - Never round a value to nothing. A scale height of 8.4 km and one of 0.0084 km are the
 *     same number, but only one of them communicates.
 *   - Never invent precision. Three significant figures is roughly what any of these
 *     quantities is actually known to, and printing eight would imply otherwise.
 */

import { AU, DAY, EARTH_MASS, EARTH_RADIUS, JULIAN_YEAR, PARSEC } from "@aether/units";

const LIGHT_YEARS_PER_PARSEC = 3.26156;

/** Three significant figures, without exponent notation for ordinary magnitudes. */
function sig(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-3) return value.toExponential(digits - 1);

  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(magnitude)));
  return value.toFixed(Math.min(decimals, 6));
}

/**
 * Format an SI value in whatever unit a reader actually thinks in.
 *
 * The choice of display unit is per-field rather than per-dimension, because the natural
 * unit depends on the quantity: a planet radius belongs in Earth radii, a scale height in
 * kilometres, and a stellar distance in light-years — all three are lengths.
 */
export function formatValue(field: string, valueSI: number | null, unit: string): string {
  if (valueSI === null) return "unknown";

  switch (field) {
    case "planet_radius":
      return `${sig(valueSI / EARTH_RADIUS)} R⊕`;
    case "planet_mass":
      return `${sig(valueSI / EARTH_MASS)} M⊕`;
    case "stellar_radius":
      return `${sig(valueSI / 6.957e8)} R☉`;
    case "stellar_mass":
      return `${sig(valueSI / 1.98892e30)} M☉`;
    case "stellar_distance":
      // Light-years, because that is the unit every reader already has intuition for,
      // even though parsecs are what the catalogue stores.
      return `${sig((valueSI / PARSEC) * LIGHT_YEARS_PER_PARSEC)} ly`;
    case "semi_major_axis":
      return `${sig(valueSI / AU)} AU`;
    case "orbital_period": {
      const days = valueSI / DAY;
      return days >= 365 ? `${sig(valueSI / JULIAN_YEAR)} yr` : `${sig(days)} d`;
    }
    case "scale_height":
      return `${sig(valueSI / 1000)} km`;
    case "escape_velocity":
      return `${sig(valueSI / 1000)} km/s`;
    case "insolation":
      // Relative to Earth's, which is the comparison anyone actually wants to make.
      return `${sig(valueSI / 1361)} S⊕`;
    default:
      break;
  }

  switch (unit) {
    case "K":
      return `${sig(valueSI)} K`;
    case "kg/m^3":
      return `${sig(valueSI)} kg/m³`;
    case "m/s^2":
      return `${sig(valueSI)} m/s²`;
    case "W/m^2":
      return `${sig(valueSI)} W/m²`;
    case "Pa":
      return valueSI >= 1000 ? `${sig(valueSI / 1e5)} bar` : `${sig(valueSI)} Pa`;
    case "1":
      return sig(valueSI);
    case "":
      return sig(valueSI);
    default:
      return `${sig(valueSI)} ${unit}`;
  }
}

/**
 * An uncertainty rendered in the same display unit as its value.
 *
 * Returns an empty string rather than "±0" when there is none. A false zero here would
 * claim a precision nobody published, which is the specific dishonesty this project exists
 * to avoid.
 */
export function formatUncertainty(
  field: string,
  uncertainty: { minus: number; plus: number } | undefined,
  unit: string,
): string {
  if (!uncertainty) return "";
  if (uncertainty.minus === 0 && uncertainty.plus === 0) return "";

  const strip = (s: string): string => s.replace(/\s*[^\d.eE+-]+$/, "");
  const minus = strip(formatValue(field, uncertainty.minus, unit));
  const plus = strip(formatValue(field, uncertainty.plus, unit));

  return minus === plus ? `± ${plus}` : `+${plus} / −${minus}`;
}

/** A distribution's 16th–84th percentile band, in display units. */
export function formatInterval(
  field: string,
  interval: { p16: number; p84: number },
  unit: string,
): string {
  return `${formatValue(field, interval.p16, unit)} … ${formatValue(field, interval.p84, unit)}`;
}

/** Confidence as a percentage, or a dash where a layer supplies none. */
export function formatConfidence(confidence: number | null): string {
  return confidence === null ? "—" : `${Math.round(confidence * 100)}%`;
}
