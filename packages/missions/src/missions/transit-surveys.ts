/**
 * Transit photometry surveys — the missions that found most of the catalog.
 *
 * A transit measures the *ratio* of planet to stellar radius, plus a period and an epoch.
 * It does not measure a planetary radius on its own: that requires a stellar radius from
 * spectroscopy or from Gaia. Keeping the distinction is why `planet_radius_ratio` and
 * `stellar_radius` are separate constraints here.
 */

import { defineMission } from "../registry.js";

export const kepler = defineMission({
  id: "kepler",
  name: "Kepler",
  archiveFacilityNames: ["Kepler"],
  agency: "NASA",
  status: "completed",
  startYear: 2009,
  endYear: 2013,
  description:
    "Stared at a single 115 deg2 field in Cygnus for four years, delivering the longest " +
    "continuous photometry ever obtained and the bulk of the known planet population. Its " +
    "targets are mostly faint, which makes them poor candidates for follow-up spectroscopy.",
  instruments: [
    {
      name: "Photometer",
      wavelength: { minUm: 0.42, maxUm: 0.9 },
      techniques: ["transit_photometry"],
      note: "Single broad optical bandpass; no spectral information.",
    },
  ],
  constrains: {
    planet_radius_ratio: { quality: 0.9, note: "Long baselines give very precise depths." },
    orbital_period: { quality: 0.95, note: "Four-year baseline; periods to many decimals." },
    transit_epoch: { quality: 0.95 },
    orbital_inclination: { quality: 0.6, note: "From transit duration and shape." },
    eccentricity: { quality: 0.2, note: "Weak, via transit duration anomalies only." },
    rotation_period: { quality: 0.5, note: "From starspot modulation of the host." },
  },
  discoveredPlanets: 2778,
  isDiscoveryFacility: true,
  references: ["2010Sci...327..977B"],
});

export const k2 = defineMission({
  id: "k2",
  name: "K2",
  archiveFacilityNames: ["K2"],
  agency: "NASA",
  status: "completed",
  startYear: 2014,
  endYear: 2018,
  description:
    "Kepler's second life after two reaction wheels failed. Observed a sequence of ~80-day " +
    "ecliptic campaigns, trading Kepler's long baseline for sky coverage and brighter, more " +
    "followable targets.",
  instruments: [
    {
      name: "Photometer",
      wavelength: { minUm: 0.42, maxUm: 0.9 },
      techniques: ["transit_photometry"],
      note: "Same hardware as Kepler, with degraded pointing corrected in software.",
    },
  ],
  constrains: {
    planet_radius_ratio: { quality: 0.75 },
    orbital_period: { quality: 0.7, note: "Campaign length caps the recoverable period." },
    transit_epoch: { quality: 0.8 },
    orbital_inclination: { quality: 0.5 },
    rotation_period: { quality: 0.4 },
  },
  discoveredPlanets: 549,
  isDiscoveryFacility: true,
  references: ["2014PASP..126..398H"],
});

export const tess = defineMission({
  id: "tess",
  name: "TESS",
  archiveFacilityNames: [
    "Transiting Exoplanet Survey Satellite",
    "TESS",
  ],
  agency: "NASA",
  status: "operational",
  startYear: 2018,
  description:
    "An all-sky survey of bright, nearby stars in 24x96 degree sectors. Its planets are " +
    "far better suited to atmospheric follow-up than Kepler's, which is the point: TESS " +
    "exists to feed JWST and Ariel target lists.",
  instruments: [
    {
      name: "Cameras (4x)",
      wavelength: { minUm: 0.6, maxUm: 1.0 },
      techniques: ["transit_photometry"],
      note: "Red-optical bandpass, chosen to favour cool M-dwarf hosts.",
    },
  ],
  constrains: {
    planet_radius_ratio: { quality: 0.75 },
    orbital_period: {
      quality: 0.6,
      note: "27 days per sector: long-period planets often show only one or two transits.",
    },
    transit_epoch: { quality: 0.8 },
    orbital_inclination: { quality: 0.5 },
    rotation_period: { quality: 0.5 },
  },
  discoveredPlanets: 638,
  isDiscoveryFacility: true,
  references: ["2015JATIS...1a4003R"],
});

export const corot = defineMission({
  id: "corot",
  name: "CoRoT",
  archiveFacilityNames: ["CoRoT"],
  agency: "CNES / ESA",
  status: "completed",
  startYear: 2006,
  endYear: 2012,
  description:
    "The first space telescope dedicated to transit searches, and the discoverer of the " +
    "first confirmed rocky exoplanet, CoRoT-7 b.",
  instruments: [
    {
      name: "Telescope",
      wavelength: { minUm: 0.37, maxUm: 0.95 },
      techniques: ["transit_photometry"],
    },
  ],
  constrains: {
    planet_radius_ratio: { quality: 0.6 },
    orbital_period: { quality: 0.7 },
    transit_epoch: { quality: 0.7 },
    orbital_inclination: { quality: 0.4 },
  },
  discoveredPlanets: 32,
  isDiscoveryFacility: true,
  references: ["2009A&A...506..411A"],
});

export const groundTransit = defineMission({
  id: "ground_transit",
  name: "Ground-based transit surveys",
  archiveFacilityNames: [
    "SuperWASP",
    "WASP",
    "HATNet",
    "HATSouth",
    "KELT",
    "NGTS",
    "TRAPPIST",
    "SPECULOOS",
    "MEarth",
    "Qatar",
    "XO",
  ],
  agency: "Various",
  status: "operational",
  startYear: 2004,
  description:
    "Wide-field robotic surveys that found most of the bright hot Jupiters, and — through " +
    "TRAPPIST and SPECULOOS — the TRAPPIST-1 system. Cheap, wide, and limited by the " +
    "atmosphere to deep transits around bright stars.",
  instruments: [
    {
      name: "Wide-field robotic telescopes",
      wavelength: { minUm: 0.4, maxUm: 1.0 },
      techniques: ["transit_photometry"],
      note: "Atmospheric scintillation limits precision to roughly 1 part in 1000.",
    },
  ],
  constrains: {
    planet_radius_ratio: { quality: 0.5, note: "Limited by atmospheric systematics." },
    orbital_period: { quality: 0.8, note: "Years-long baselines from repeated visits." },
    transit_epoch: { quality: 0.7 },
    orbital_inclination: { quality: 0.35 },
  },
  discoveredPlanets: 500,
  isDiscoveryFacility: true,
  references: [],
});
