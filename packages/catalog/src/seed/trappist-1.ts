/**
 * TRAPPIST-1.
 *
 * The reference system for this project, for a reason that has nothing to do with it being
 * famous: it is the best-characterised terrestrial system we have, and it is *still* almost
 * entirely unconstrained where surfaces are concerned. Seven planets with masses good to a
 * few percent from transit timing, and not one square kilometre of resolved ground.
 *
 * That gap is the whole product. A system this well measured, where the surface remains a
 * hypothesis, is the honest demonstration of what Aether can and cannot claim.
 *
 * Masses and radii are Agol et al. (2021), which supersedes the discovery values with a
 * global TTV + photometry fit. Stellar parameters follow the same paper. Bond albedo is
 * written as explicitly unknown for every planet, because it is.
 */

import type { SystemSeed } from "../schema.js";

const AGOL = "agol2021";

/** Every TRAPPIST-1 planet has an unmeasured Bond albedo, and the model must say so. */
const unknownAlbedo = {
  value: null,
  unit: "1",
  sourceId: "unmeasured",
  method: "measured",
  note: "No Bond albedo measurement exists for any TRAPPIST-1 planet.",
} as const;

export const TRAPPIST_1: SystemSeed = {
  id: "trappist-1",
  name: "TRAPPIST-1",
  blurb:
    "Seven terrestrial planets in a resonant chain around an M8V dwarf, 40.7 light-years away.",
  observedBy: ["spitzer", "jwst", "hubble", "gaia", "kepler-k2", "tess"],

  star: {
    id: "trappist-1",
    name: "TRAPPIST-1",
    spectralType: "M8V",
    distance: {
      value: 12.467,
      unit: "pc",
      uncertainty: { minus: 0.012, plus: 0.012 },
      sourceId: "gaia-dr3",
      method: "measured",
    },
    effectiveTemperature: {
      value: 2566,
      unit: "K",
      uncertainty: { minus: 26, plus: 26 },
      sourceId: AGOL,
      method: "measured",
    },
    radius: {
      value: 0.1192,
      unit: "R_sun",
      uncertainty: { minus: 0.0013, plus: 0.0013 },
      sourceId: AGOL,
      method: "measured",
    },
    mass: {
      value: 0.0898,
      unit: "M_sun",
      uncertainty: { minus: 0.0023, plus: 0.0023 },
      sourceId: AGOL,
      method: "measured",
    },
    luminosity: {
      value: 0.000553,
      unit: "L_sun",
      uncertainty: { minus: 0.000018, plus: 0.000018 },
      sourceId: AGOL,
      method: "derived",
      note: "Derived by the source from radius and effective temperature.",
    },
  },

  planets: [
    {
      id: "b",
      name: "TRAPPIST-1 b",
      radius: {
        value: 1.116,
        unit: "R_earth",
        uncertainty: { minus: 0.012, plus: 0.014 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 1.374,
        unit: "M_earth",
        uncertainty: { minus: 0.069, plus: 0.069 },
        sourceId: AGOL,
        method: "derived",
        note: "Transit-timing variation mass; model-dependent.",
      },
      orbitalPeriod: {
        value: 1.510826,
        unit: "day",
        uncertainty: { minus: 0.000006, plus: 0.000006 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.01154,
        unit: "AU",
        uncertainty: { minus: 0.0001, plus: 0.0001 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.00622,
        unit: "1",
        uncertainty: { minus: 0.00304, plus: 0.00304 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
      atmosphereNote:
        "JWST secondary-eclipse photometry is consistent with a bare rock and no thick atmosphere.",
    },
    {
      id: "c",
      name: "TRAPPIST-1 c",
      radius: {
        value: 1.097,
        unit: "R_earth",
        uncertainty: { minus: 0.012, plus: 0.014 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 1.308,
        unit: "M_earth",
        uncertainty: { minus: 0.056, plus: 0.056 },
        sourceId: AGOL,
        method: "derived",
      },
      orbitalPeriod: {
        value: 2.421937,
        unit: "day",
        uncertainty: { minus: 0.000018, plus: 0.000018 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.0158,
        unit: "AU",
        uncertainty: { minus: 0.00013, plus: 0.00013 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.00654,
        unit: "1",
        uncertainty: { minus: 0.00188, plus: 0.00188 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
      atmosphereNote: "No thick CO2 atmosphere detected by JWST.",
    },
    {
      id: "d",
      name: "TRAPPIST-1 d",
      radius: {
        value: 0.788,
        unit: "R_earth",
        uncertainty: { minus: 0.01, plus: 0.011 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 0.388,
        unit: "M_earth",
        uncertainty: { minus: 0.012, plus: 0.012 },
        sourceId: AGOL,
        method: "derived",
      },
      orbitalPeriod: {
        value: 4.049219,
        unit: "day",
        uncertainty: { minus: 0.000026, plus: 0.000026 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.02227,
        unit: "AU",
        uncertainty: { minus: 0.00019, plus: 0.00019 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.00837,
        unit: "1",
        uncertainty: { minus: 0.00093, plus: 0.00093 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
    },
    {
      id: "e",
      name: "TRAPPIST-1 e",
      radius: {
        value: 0.92,
        unit: "R_earth",
        uncertainty: { minus: 0.012, plus: 0.013 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 0.692,
        unit: "M_earth",
        uncertainty: { minus: 0.022, plus: 0.022 },
        sourceId: AGOL,
        method: "derived",
        note: "Transit-timing variation mass; model-dependent.",
      },
      orbitalPeriod: {
        value: 6.101013,
        unit: "day",
        uncertainty: { minus: 0.000035, plus: 0.000035 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.02925,
        unit: "AU",
        uncertainty: { minus: 0.00025, plus: 0.00025 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.0051,
        unit: "1",
        uncertainty: { minus: 0.00058, plus: 0.00058 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
      atmosphereNote:
        "In the habitable zone by insolation. No atmospheric detection; the surface is entirely unconstrained.",
    },
    {
      id: "f",
      name: "TRAPPIST-1 f",
      radius: {
        value: 1.045,
        unit: "R_earth",
        uncertainty: { minus: 0.012, plus: 0.013 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 1.039,
        unit: "M_earth",
        uncertainty: { minus: 0.031, plus: 0.031 },
        sourceId: AGOL,
        method: "derived",
      },
      orbitalPeriod: {
        value: 9.20754,
        unit: "day",
        uncertainty: { minus: 0.000032, plus: 0.000032 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.03849,
        unit: "AU",
        uncertainty: { minus: 0.00033, plus: 0.00033 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.01007,
        unit: "1",
        uncertainty: { minus: 0.00068, plus: 0.00068 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
    },
    {
      id: "g",
      name: "TRAPPIST-1 g",
      radius: {
        value: 1.129,
        unit: "R_earth",
        uncertainty: { minus: 0.013, plus: 0.015 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 1.321,
        unit: "M_earth",
        uncertainty: { minus: 0.038, plus: 0.038 },
        sourceId: AGOL,
        method: "derived",
      },
      orbitalPeriod: {
        value: 12.352446,
        unit: "day",
        uncertainty: { minus: 0.000054, plus: 0.000054 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.04683,
        unit: "AU",
        uncertainty: { minus: 0.0004, plus: 0.0004 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.00208,
        unit: "1",
        uncertainty: { minus: 0.00058, plus: 0.00058 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
    },
    {
      id: "h",
      name: "TRAPPIST-1 h",
      radius: {
        value: 0.755,
        unit: "R_earth",
        uncertainty: { minus: 0.014, plus: 0.014 },
        sourceId: AGOL,
        method: "measured",
      },
      mass: {
        value: 0.326,
        unit: "M_earth",
        uncertainty: { minus: 0.02, plus: 0.02 },
        sourceId: AGOL,
        method: "derived",
      },
      orbitalPeriod: {
        value: 18.772866,
        unit: "day",
        uncertainty: { minus: 0.000214, plus: 0.000214 },
        sourceId: AGOL,
        method: "measured",
      },
      semiMajorAxis: {
        value: 0.06189,
        unit: "AU",
        uncertainty: { minus: 0.00053, plus: 0.00053 },
        sourceId: AGOL,
        method: "derived",
      },
      eccentricity: {
        value: 0.00567,
        unit: "1",
        uncertainty: { minus: 0.00121, plus: 0.00121 },
        sourceId: AGOL,
        method: "derived",
      },
      bondAlbedo: unknownAlbedo,
    },
  ],
};
