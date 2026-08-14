/**
 * Physical and astronomical constants.
 *
 * Sources are named per-constant because a reviewer will ask, and because switching
 * constant systems silently is exactly the kind of drift that makes results
 * irreproducible. Solar and planetary values follow IAU 2015 Resolution B3 *nominal*
 * conversion constants, which are defined exactly and therefore do not change when
 * measurements improve — that stability is what makes them the right choice for a
 * reproducibility-first product.
 */

import { si } from "./brand.js";
import type { Kelvin, Kilograms, Metres, Seconds, Watts } from "./brand.js";

// ── Fundamental (SI 2019 exact, and CODATA 2018 for G) ──────────────────────────────────

/** Speed of light in vacuum. Exact by SI definition. */
export const SPEED_OF_LIGHT = si<number>(299_792_458); // m/s
/** Planck constant. Exact by SI definition. */
export const PLANCK = si<number>(6.626_070_15e-34); // J·s
/** Boltzmann constant. Exact by SI definition. */
export const BOLTZMANN = si<number>(1.380_649e-23); // J/K
/** Stefan–Boltzmann constant. Derived from exact SI constants. */
export const STEFAN_BOLTZMANN = si<number>(5.670_374_419e-8); // W/m^2/K^4
/**
 * Newtonian constant of gravitation, CODATA 2018.
 *
 * This is the least precisely known constant here (~2.2e-5 relative). Where possible use
 * the GM products below instead, which are measured far more precisely than G itself.
 */
export const GRAVITATIONAL_CONSTANT = si<number>(6.674_30e-11); // m^3/kg/s^2
/** Unified atomic mass unit. */
export const ATOMIC_MASS_UNIT = si<number>(1.660_539_066_60e-27); // kg

// ── Distance (IAU 2012 Resolution B2) ───────────────────────────────────────────────────

/** Astronomical unit. Exact by IAU 2012 definition. */
export const AU: Metres = si<Metres>(1.495_978_707e11);
/** Parsec, derived exactly from the AU and the definition of the arcsecond. */
export const PARSEC: Metres = si<Metres>((AU * 648_000) / Math.PI);
/** Light year, using the Julian year. */
export const LIGHT_YEAR: Metres = si<Metres>(SPEED_OF_LIGHT * 365.25 * 86_400);

// ── Time ────────────────────────────────────────────────────────────────────────────────

export const DAY: Seconds = si<Seconds>(86_400);
/** Julian year — the astronomical standard, not the Gregorian calendar year. */
export const JULIAN_YEAR: Seconds = si<Seconds>(365.25 * 86_400);

// ── Solar (IAU 2015 B3 nominal — exact by definition) ───────────────────────────────────

export const SOLAR_RADIUS: Metres = si<Metres>(6.957e8);
export const SOLAR_LUMINOSITY: Watts = si<Watts>(3.828e26);
export const SOLAR_EFFECTIVE_TEMPERATURE: Kelvin = si<Kelvin>(5772);
/** Nominal solar mass parameter GM☉. Known far more precisely than M☉ itself. */
export const SOLAR_GM = si<number>(1.327_124_4e20); // m^3/s^2
export const SOLAR_MASS: Kilograms = si<Kilograms>(SOLAR_GM / GRAVITATIONAL_CONSTANT);

// ── Terrestrial and Jovian (IAU 2015 B3 nominal, equatorial) ────────────────────────────

export const EARTH_RADIUS: Metres = si<Metres>(6.3781e6);
export const EARTH_GM = si<number>(3.986_004e14); // m^3/s^2
export const EARTH_MASS: Kilograms = si<Kilograms>(EARTH_GM / GRAVITATIONAL_CONSTANT);

export const JUPITER_RADIUS: Metres = si<Metres>(7.1492e7);
export const JUPITER_GM = si<number>(1.266_865_3e17); // m^3/s^2
export const JUPITER_MASS: Kilograms = si<Kilograms>(JUPITER_GM / GRAVITATIONAL_CONSTANT);

/**
 * Solar irradiance at 1 AU, derived rather than tabulated so it stays consistent with the
 * luminosity and AU above. Used as the reference for insolation in Earth units.
 */
export const SOLAR_CONSTANT = si<number>(SOLAR_LUMINOSITY / (4 * Math.PI * AU * AU)); // W/m^2

/** Provenance for the constant set, stamped into every EnvironmentSpec. */
export const CONSTANTS_VERSION = "iau2015b3+codata2018" as const;
