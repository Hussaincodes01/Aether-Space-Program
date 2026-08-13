/**
 * Filling in what was never measured.
 *
 * Between 0.5% and 24% of the catalogue is missing any given field. A renderer needs a
 * number for all of them; the science must not pretend one was measured. So every function
 * here returns the value *and* how it was obtained, and nothing overwrites a measurement.
 *
 * The order is always the same, and it is the precedence rule from the PRD:
 *
 *   measured  ->  derived from other measurements  ->  population prior  ->  default
 *
 * A derived value is a real inference from real data and can be defended. A population
 * prior is a statement about planets in general, not about *this* planet, and carries a
 * distribution rather than a number. A default is an admission that we had nothing.
 */

export type PriorMethod = "measured" | "derived" | "population_prior" | "default_prior";

export interface FilledValue {
  value: number;
  method: PriorMethod;
  /** 0..1. A prior can never exceed the confidence of a measurement. */
  confidence: number;
  /** Multiplicative scatter for prior-derived values, where the relation has one. */
  scatterFactor?: number;
  formula?: string;
  note?: string;
}

const measured = (value: number): FilledValue => ({
  value,
  method: "measured",
  confidence: 0.95,
});

function known(v: number | undefined | null): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ── Mass and radius ─────────────────────────────────────────────────────────────────────

/**
 * Chen & Kipping (2017) "Forecaster" broken power law, log10(R) = C + S log10(M).
 *
 * Four regimes with different physics: Terran worlds compress under their own gravity,
 * Neptunian ones are volatile-dominated and swell, Jovian ones are supported by electron
 * degeneracy so radius becomes almost independent of mass, and above the hydrogen-burning
 * limit stars take over again.
 *
 * The Jovian exponent being *negative* is the interesting part: add mass to a Jupiter and
 * it gets slightly smaller.
 */
const FORECASTER = [
  { maxMassEarth: 2.04, c: 0.00346, s: 0.279, scatter: 1.05, label: "Terran" },
  { maxMassEarth: 131.6, c: -0.0925, s: 0.589, scatter: 1.15, label: "Neptunian" },
  { maxMassEarth: 26_635.6, c: 1.25, s: -0.044, scatter: 1.4, label: "Jovian" },
  { maxMassEarth: Infinity, c: -2.85, s: 0.881, scatter: 1.2, label: "Stellar" },
] as const;

export function radiusFromMass(massEarth: number): FilledValue {
  const regime = FORECASTER.find((r) => massEarth < r.maxMassEarth) ?? FORECASTER[3];
  const value = Math.pow(10, regime.c) * Math.pow(massEarth, regime.s);

  return {
    value,
    method: "population_prior",
    // A population relation says what planets of this mass do on average. It says much less
    // about any individual one, and the Jovian regime is the worst of them: hot Jupiters
    // are inflated by irradiation the relation knows nothing about.
    confidence: 0.35,
    scatterFactor: regime.scatter,
    formula: "chen_kipping_2017",
    note:
      `${regime.label} regime. Population mean with roughly ${regime.scatter}x scatter; ` +
      `not a measurement of this planet.`,
  };
}

/** Inverse Forecaster. Less reliable than the forward relation — the Jovian branch is nearly flat. */
export function massFromRadius(radiusEarth: number): FilledValue {
  for (const regime of FORECASTER) {
    const mass = Math.pow(radiusEarth / Math.pow(10, regime.c), 1 / regime.s);
    if (mass < regime.maxMassEarth) {
      return {
        value: mass,
        method: "population_prior",
        // Worse than radius-from-mass by construction: in the Jovian regime radius barely
        // depends on mass, so inverting it amplifies error enormously.
        confidence: 0.2,
        scatterFactor: regime.scatter * 2,
        formula: "chen_kipping_2017_inverse",
        note:
          `${regime.label} regime, inverted. The Jovian branch is nearly flat in radius, ` +
          `so mass inferred from radius there is barely constrained.`,
      };
    }
  }
  return {
    value: Number.NaN,
    method: "default_prior",
    confidence: 0,
    note: "Radius outside the fitted range.",
  };
}

// ── Orbit ───────────────────────────────────────────────────────────────────────────────

/**
 * Semi-major axis from period, by Kepler's third law.
 *
 * In solar units this is just a = (M* P^2)^(1/3), and it is a *derivation* rather than a
 * prior: given a real period and a real stellar mass the answer is exact. It only degrades
 * to a prior when the stellar mass itself was assumed.
 */
export function semiMajorAxisFromPeriod(
  periodDays: number,
  stellarMassSun: number,
  stellarMassMeasured = true,
): FilledValue {
  const periodYears = periodDays / 365.25;
  const value = Math.cbrt(stellarMassSun * periodYears * periodYears);

  return {
    value,
    method: stellarMassMeasured ? "derived" : "population_prior",
    confidence: stellarMassMeasured ? 0.85 : 0.4,
    formula: "keplers_third_law",
    note: stellarMassMeasured
      ? "Exact given period and stellar mass."
      : "Stellar mass was itself estimated, so this inherits that uncertainty.",
  };
}

export function periodFromSemiMajorAxis(
  semiMajorAu: number,
  stellarMassSun: number,
): FilledValue {
  const periodYears = Math.sqrt(semiMajorAu ** 3 / stellarMassSun);
  return {
    value: periodYears * 365.25,
    method: "derived",
    confidence: 0.85,
    formula: "keplers_third_law",
  };
}

/**
 * Eccentricity when unmeasured — 16.5% of the catalogue.
 *
 * Zero is chosen not because orbits are circular but because it is the only value that adds
 * no unearned structure. Close-in planets really are circularised by tides, so it is often
 * right; for long-period ones it is a convenience and is flagged as such.
 */
export function defaultEccentricity(semiMajorAu: number): FilledValue {
  const tidallyCircularised = Number.isFinite(semiMajorAu) && semiMajorAu < 0.1;
  return {
    value: 0,
    method: tidallyCircularised ? "population_prior" : "default_prior",
    confidence: tidallyCircularised ? 0.5 : 0.15,
    note: tidallyCircularised
      ? "Assumed circular: tidal circularisation is rapid inside ~0.1 AU."
      : "Assumed circular because nothing was measured. Long-period orbits are often not.",
  };
}

/**
 * Inclination when unmeasured — 24% of the catalogue.
 *
 * A transiting planet must be near edge-on or it would not transit, so 90 degrees is a real
 * inference. For a radial-velocity detection there is no constraint at all, and the value
 * is a display convention rather than a claim.
 */
export function defaultInclination(discoveredByTransit: boolean): FilledValue {
  return discoveredByTransit
    ? {
        value: 89,
        method: "derived",
        confidence: 0.7,
        note: "Near edge-on by necessity — otherwise no transit would be observed.",
      }
    : {
        value: 90,
        method: "default_prior",
        confidence: 0,
        note:
          "Unconstrained. Radial velocity measures M·sin(i) and cannot separate the two; " +
          "this is a display convention, not a measurement.",
      };
}

// ── Thermal ─────────────────────────────────────────────────────────────────────────────

const STEFAN_BOLTZMANN = 5.670374419e-8;
const SOLAR_LUMINOSITY_W = 3.828e26;
const AU_M = 1.495978707e11;

/**
 * Equilibrium temperature from stellar luminosity and orbital distance.
 *
 * Note the archive stores `st_lum` as log10(L/L_sun), not as a ratio. Treating it as linear
 * would make every Sun-like star a zero-luminosity object — a mistake that fails silently
 * because the resulting temperature is merely wrong rather than absurd.
 */
export function equilibriumTemperature(
  logLuminositySun: number,
  semiMajorAu: number,
  bondAlbedo = 0.3,
): FilledValue {
  const luminosityW = Math.pow(10, logLuminositySun) * SOLAR_LUMINOSITY_W;
  const distanceM = semiMajorAu * AU_M;
  const flux = luminosityW / (4 * Math.PI * distanceM * distanceM);
  const value = Math.pow((flux * (1 - bondAlbedo)) / (4 * STEFAN_BOLTZMANN), 0.25);

  return {
    value,
    method: "derived",
    // Capped: Bond albedo is assumed for essentially every exoplanet, and T_eq scales as
    // (1-A)^(1/4), so this can never be better than the albedo guess underneath it.
    confidence: 0.5,
    formula: "equilibrium_temperature",
    note:
      `Assumes Bond albedo ${bondAlbedo} and full heat redistribution. Excludes any ` +
      `greenhouse effect, so a planet with a thick atmosphere is warmer than this.`,
  };
}

/** Bulk density from mass and radius. Exact, given both. */
export function densityFromMassRadius(massEarth: number, radiusEarth: number): FilledValue {
  const EARTH_MASS_KG = 5.97237e24;
  const EARTH_RADIUS_M = 6.3781e6;
  const massKg = massEarth * EARTH_MASS_KG;
  const radiusM = radiusEarth * EARTH_RADIUS_M;
  const value = massKg / ((4 / 3) * Math.PI * radiusM ** 3) / 1000; // g/cm3

  return { value, method: "derived", confidence: 0.9, formula: "bulk_density" };
}

// ── The resolver ────────────────────────────────────────────────────────────────────────

export interface RawPlanet {
  radiusEarth: number;
  massEarth: number;
  periodDays: number;
  semiMajorAu: number;
  eccentricity: number;
  inclinationDeg: number;
  eqTempK: number;
  densityGcc: number;
  discoveredByTransit: boolean;
}

export interface RawStar {
  teff: number;
  radiusSun: number;
  massSun: number;
  logLuminosity: number;
}

export interface ResolvedPlanet {
  radiusEarth: FilledValue;
  massEarth: FilledValue;
  periodDays: FilledValue;
  semiMajorAu: FilledValue;
  eccentricity: FilledValue;
  inclinationDeg: FilledValue;
  eqTempK: FilledValue;
  densityGcc: FilledValue;
  /** Fraction of fields that were actually measured, 0..1. */
  completeness: number;
}

const unresolved = (note: string): FilledValue => ({
  value: Number.NaN,
  method: "default_prior",
  confidence: 0,
  note,
});

/**
 * Fill every field a renderer needs, recording how each one was obtained.
 *
 * Nothing here overwrites a measurement, and the order is fixed: measured, then derived from
 * other measurements, then a population prior, then an admission of ignorance.
 */
export function resolvePlanet(raw: RawPlanet, star: RawStar): ResolvedPlanet {
  const stellarMassKnown = known(star.massSun);

  // Mass and radius fill each other in, in whichever direction the data allows.
  const massEarth = known(raw.massEarth)
    ? measured(raw.massEarth)
    : known(raw.radiusEarth)
      ? massFromRadius(raw.radiusEarth)
      : unresolved("Neither mass nor radius was measured.");

  const radiusEarth = known(raw.radiusEarth)
    ? measured(raw.radiusEarth)
    : known(raw.massEarth)
      ? radiusFromMass(raw.massEarth)
      : unresolved("Neither radius nor mass was measured.");

  const periodDays = known(raw.periodDays)
    ? measured(raw.periodDays)
    : known(raw.semiMajorAu) && stellarMassKnown
      ? periodFromSemiMajorAxis(raw.semiMajorAu, star.massSun)
      : unresolved("Neither period nor semi-major axis was measured.");

  const semiMajorAu = known(raw.semiMajorAu)
    ? measured(raw.semiMajorAu)
    : known(raw.periodDays) && stellarMassKnown
      ? semiMajorAxisFromPeriod(raw.periodDays, star.massSun, true)
      : unresolved("Neither semi-major axis nor period was measured.");

  const eccentricity = known(raw.eccentricity)
    ? measured(raw.eccentricity)
    : defaultEccentricity(semiMajorAu.value);

  const inclinationDeg = known(raw.inclinationDeg)
    ? measured(raw.inclinationDeg)
    : defaultInclination(raw.discoveredByTransit);

  const eqTempK = known(raw.eqTempK)
    ? measured(raw.eqTempK)
    : known(star.logLuminosity) && Number.isFinite(semiMajorAu.value)
      ? equilibriumTemperature(star.logLuminosity, semiMajorAu.value)
      : unresolved("No stellar luminosity or orbital distance to derive a temperature from.");

  const densityGcc = known(raw.densityGcc)
    ? measured(raw.densityGcc)
    : Number.isFinite(massEarth.value) && Number.isFinite(radiusEarth.value)
      ? densityFromMassRadius(massEarth.value, radiusEarth.value)
      : unresolved("Density needs both a mass and a radius.");

  const fields = [
    radiusEarth, massEarth, periodDays, semiMajorAu,
    eccentricity, inclinationDeg, eqTempK, densityGcc,
  ];
  const completeness = fields.filter((f) => f.method === "measured").length / fields.length;

  return {
    radiusEarth, massEarth, periodDays, semiMajorAu,
    eccentricity, inclinationDeg, eqTempK, densityGcc,
    completeness,
  };
}

/**
 * How speculative a rendered world is, 0..1.
 *
 * Drives the amber rim. Weighted by confidence rather than by a raw measured/unmeasured
 * count, because a derived value is worth more than a population prior, and both are worth
 * more than a default.
 */
export function speculationFraction(resolved: ResolvedPlanet): number {
  const fields = [
    resolved.radiusEarth, resolved.massEarth, resolved.semiMajorAu,
    resolved.eqTempK, resolved.densityGcc,
  ];
  const mean = fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
  // Never fully certain: no exoplanet surface has ever been resolved.
  return Math.max(0.15, 1 - mean);
}
