/**
 * The Solar System and Proxima Centauri, as catalog entries.
 *
 * ## Why the Sun and Earth are in an exoplanet catalog
 *
 * Because they are the only entry where every derived value has a known right answer. Run
 * Earth's measured mass and radius through the same pipeline as TRAPPIST-1 e and the density
 * must come out at 5514 kg/m3, the surface gravity at 9.80 m/s2, the insolation at 1361
 * W/m2. If it does not, the pipeline is broken, and no amount of care about an exoplanet
 * would have revealed it.
 *
 * The values here are deliberately *only* the ones an observer would have — mass, radius,
 * orbit, albedo — so Earth goes through exactly the path an exoplanet goes through. Nothing
 * is short-circuited because we happen to live here.
 *
 * ## Proxima Centauri b
 *
 * The nearest exoplanet, and a useful contrast to TRAPPIST-1: it was found by radial
 * velocity, so what is known is a *minimum* mass and nothing about the radius at all. That
 * asymmetry is real and the catalog records it as a null rather than filling it from a
 * mass-radius relation, which is the inference layer's job further down the pipeline.
 */

import type { SystemSeed } from "../schema.js";

const JPL = "jpl-fact-sheet";
const IAU = "iau2015-b3";

export const SOL: SystemSeed = {
  id: "sol",
  name: "Solar System",
  blurb: "Home, and the only entry where every derived value has a known right answer.",
  observedBy: [],

  star: {
    id: "sun",
    name: "Sun",
    spectralType: "G2V",
    distance: {
      value: 0,
      unit: "pc",
      sourceId: IAU,
      method: "measured",
      note: "Zero by definition; the Solar System is the origin of the distance scale.",
    },
    effectiveTemperature: { value: 5772, unit: "K", sourceId: IAU, method: "measured" },
    radius: { value: 1, unit: "R_sun", sourceId: IAU, method: "measured" },
    mass: { value: 1, unit: "M_sun", sourceId: IAU, method: "measured" },
    luminosity: { value: 1, unit: "L_sun", sourceId: IAU, method: "measured" },
  },

  planets: [
    {
      id: "earth",
      name: "Earth",
      radius: {
        value: 1,
        unit: "R_earth",
        sourceId: IAU,
        method: "measured",
        note: "IAU nominal equatorial radius, the value the R_earth unit is defined against.",
      },
      mass: { value: 1, unit: "M_earth", sourceId: IAU, method: "measured" },
      orbitalPeriod: {
        value: 365.256,
        unit: "day",
        sourceId: JPL,
        method: "measured",
        note: "Sidereal year.",
      },
      semiMajorAxis: { value: 1.00000011, unit: "AU", sourceId: JPL, method: "measured" },
      eccentricity: { value: 0.0167, unit: "1", sourceId: JPL, method: "measured" },
      bondAlbedo: {
        value: 0.306,
        unit: "1",
        sourceId: JPL,
        method: "measured",
        note: "Measured, unlike every exoplanet in this catalog. That is the point of Earth being here.",
      },
      surfacePressure: { value: 1.01325, unit: "bar", sourceId: JPL, method: "measured" },
      atmosphereNote: "78% N2, 21% O2. Mean molecular weight 28.96 amu.",
    },
    {
      id: "mars",
      name: "Mars",
      radius: { value: 0.532, unit: "R_earth", sourceId: JPL, method: "measured" },
      mass: { value: 0.107, unit: "M_earth", sourceId: JPL, method: "measured" },
      orbitalPeriod: { value: 686.98, unit: "day", sourceId: JPL, method: "measured" },
      semiMajorAxis: { value: 1.52371034, unit: "AU", sourceId: JPL, method: "measured" },
      eccentricity: { value: 0.0934, unit: "1", sourceId: JPL, method: "measured" },
      bondAlbedo: { value: 0.25, unit: "1", sourceId: JPL, method: "measured" },
      surfacePressure: { value: 0.00636, unit: "bar", sourceId: JPL, method: "measured" },
      atmosphereNote: "95% CO2 at 6.36 mbar. Thin, but it moves the largest dune fields known.",
    },
  ],
};

export const PROXIMA_CENTAURI: SystemSeed = {
  id: "proxima-centauri",
  name: "Proxima Centauri",
  blurb: "The nearest star to the Sun, with a habitable-zone terrestrial planet.",
  observedBy: ["gaia", "harps", "espresso"],

  star: {
    id: "proxima-centauri",
    name: "Proxima Centauri",
    spectralType: "M5.5Ve",
    distance: {
      value: 1.30197,
      unit: "pc",
      uncertainty: { minus: 0.00002, plus: 0.00002 },
      sourceId: "gaia-dr3",
      method: "measured",
    },
    effectiveTemperature: {
      value: 3042,
      unit: "K",
      uncertainty: { minus: 117, plus: 117 },
      sourceId: "anglada-escude2016",
      method: "measured",
    },
    radius: {
      value: 0.1542,
      unit: "R_sun",
      uncertainty: { minus: 0.0045, plus: 0.0045 },
      sourceId: "anglada-escude2016",
      method: "measured",
    },
    mass: {
      value: 0.1221,
      unit: "M_sun",
      uncertainty: { minus: 0.0022, plus: 0.0022 },
      sourceId: "anglada-escude2016",
      method: "measured",
    },
    luminosity: {
      value: 0.001567,
      unit: "L_sun",
      uncertainty: { minus: 0.000032, plus: 0.000032 },
      sourceId: "anglada-escude2016",
      method: "derived",
    },
  },

  planets: [
    {
      id: "b",
      name: "Proxima Centauri b",
      /**
       * Genuinely unknown.
       *
       * Proxima b does not transit, so nothing constrains its radius. Filling this from a
       * mass-radius relation here would launder a population prior into the science layer;
       * the inference layer does that downstream, labelled, with its uncertainty intact.
       */
      radius: {
        value: null,
        unit: "R_earth",
        sourceId: "unmeasured",
        method: "measured",
        note: "Proxima b does not transit, so no radius has ever been measured.",
      },
      mass: {
        value: 1.07,
        unit: "M_earth",
        uncertainty: { minus: 0.06, plus: 0.06 },
        sourceId: "faria2022",
        method: "derived",
        note: "Minimum mass (m sin i) from radial velocity. The true mass is at least this.",
      },
      orbitalPeriod: {
        value: 11.18418,
        unit: "day",
        uncertainty: { minus: 0.00007, plus: 0.00007 },
        sourceId: "faria2022",
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.04857,
        unit: "AU",
        uncertainty: { minus: 0.00029, plus: 0.00029 },
        sourceId: "anglada-escude2016",
        method: "derived",
      },
      eccentricity: {
        value: 0.02,
        unit: "1",
        uncertainty: { minus: 0.02, plus: 0.09 },
        sourceId: "faria2022",
        method: "derived",
        note: "Consistent with circular; the upper bound is what is actually constrained.",
      },
      bondAlbedo: {
        value: null,
        unit: "1",
        sourceId: "unmeasured",
        method: "measured",
      },
      atmosphereNote:
        "No atmospheric detection. Proxima's frequent flares make retention an open question.",
    },
  ],
};
