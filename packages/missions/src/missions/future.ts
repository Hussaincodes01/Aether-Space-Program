/**
 * Missions that have not flown yet.
 *
 * These are included for two reasons. First, selecting one lets a user see what a planet
 * *would* look like once the data exists, which makes the uncertainty story concrete
 * rather than abstract. Second, HWO is the only mission that would ever produce the
 * reflected-light photometry the surface-composition model was trained on — so it is the
 * one selection under which that model becomes a retrieval rather than a forward
 * prediction.
 *
 * Everything derived from a planned mission must be labelled as a projection. Launch dates
 * are the current agency estimates and have historically slipped.
 */

import { defineMission } from "../registry.js";

export const plato = defineMission({
  id: "plato",
  name: "PLATO",
  archiveFacilityNames: ["PLATO"],
  agency: "ESA",
  status: "planned",
  startYear: 2026,
  description:
    "Twenty-six cameras hunting Earth-sized planets in the habitable zones of bright " +
    "solar-type stars — the population Kepler could only reach around faint hosts. " +
    "Asteroseismology of the same stars gives unusually precise stellar radii and ages.",
  instruments: [
    {
      name: "Camera array (26x)",
      wavelength: { minUm: 0.5, maxUm: 1.0 },
      techniques: ["transit_photometry"],
      note: "Long-baseline staring at two fields, plus asteroseismic mode analysis.",
    },
  ],
  constrains: {
    planet_radius_ratio: { quality: 0.9 },
    orbital_period: { quality: 0.9, note: "Multi-year stares recover long periods." },
    transit_epoch: { quality: 0.9 },
    stellar_radius: {
      quality: 0.9,
      note: "Asteroseismology — the most precise route available.",
    },
    stellar_mass: { quality: 0.85, note: "Also asteroseismic." },
    rotation_period: { quality: 0.6 },
  },
  isDiscoveryFacility: true,
  references: ["2014ExA....38..249R"],
});

export const ariel = defineMission({
  id: "ariel",
  name: "Ariel",
  archiveFacilityNames: ["Ariel"],
  agency: "ESA",
  status: "planned",
  startYear: 2029,
  description:
    "The first mission dedicated entirely to exoplanet atmospheres, surveying roughly a " +
    "thousand planets in one consistent wavelength range. Where JWST characterises " +
    "individual planets exquisitely, Ariel is built to make population statistics possible.",
  instruments: [
    {
      name: "AIRS + FGS spectrometers",
      wavelength: { minUm: 0.5, maxUm: 7.8 },
      techniques: ["transmission_spectroscopy", "emission_spectroscopy", "phase_curve"],
      resolvingPower: 200,
      note: "Uniform coverage across a large, statistically designed target list.",
    },
  ],
  constrains: {
    atmospheric_composition: {
      quality: 0.7,
      note: "Lower resolution than JWST, but across a survey rather than single targets.",
    },
    atmospheric_scale_height: { quality: 0.75 },
    cloud_and_haze: { quality: 0.6 },
    dayside_temperature: { quality: 0.7 },
    heat_redistribution: { quality: 0.6 },
  },
  isDiscoveryFacility: false,
  references: ["2018ExA....46..135T"],
});

export const roman = defineMission({
  id: "roman",
  name: "Nancy Grace Roman Space Telescope",
  archiveFacilityNames: ["Roman", "Nancy Grace Roman Space Telescope", "WFIRST"],
  agency: "NASA",
  status: "planned",
  startYear: 2027,
  description:
    "A microlensing survey sensitive to cold planets beyond the snow line — the part of " +
    "parameter space transits and radial velocity both miss — plus a coronagraph " +
    "technology demonstrator that is the direct precursor to HWO.",
  instruments: [
    {
      name: "Wide Field Instrument",
      wavelength: { minUm: 0.48, maxUm: 2.3 },
      techniques: ["transit_photometry", "astrometry"],
      note: "Microlensing survey of the galactic bulge.",
    },
    {
      name: "Coronagraph Instrument",
      wavelength: { minUm: 0.6, maxUm: 0.8 },
      techniques: ["direct_imaging", "reflected_light_spectroscopy"],
      resolvingPower: 50,
      note: "Technology demonstrator: reflected light from mature giant planets.",
    },
  ],
  constrains: {
    planet_mass: { quality: 0.5, note: "Microlensing gives a mass ratio, not a mass." },
    stellar_distance: { quality: 0.4 },
    bond_albedo: { quality: 0.4, note: "Coronagraph only, and only for giants." },
  },
  isDiscoveryFacility: true,
  references: ["2015arXiv150303757S"],
});

export const hwo = defineMission({
  id: "hwo",
  name: "Habitable Worlds Observatory",
  archiveFacilityNames: ["Habitable Worlds Observatory", "HWO"],
  agency: "NASA",
  status: "planned",
  startYear: 2040,
  description:
    "A large ultraviolet-optical-infrared telescope designed to image and take spectra of " +
    "Earth-sized planets in habitable zones — reflected starlight from the planet itself, " +
    "not starlight filtered through a limb.",
  instruments: [
    {
      name: "Coronagraph + imaging spectrograph",
      wavelength: { minUm: 0.2, maxUm: 2.5 },
      techniques: ["direct_imaging", "reflected_light_spectroscopy"],
      resolvingPower: 140,
      note: "Broadband reflected-light photometry and spectroscopy of terrestrial planets.",
    },
  ],
  constrains: {
    // The only mission here that constrains a surface at all — and even then, published
    // work finds ocean and sand nearly indistinguishable from 0.4-1.8 um, with a severe
    // degeneracy between planetary radius and surface albedo. A single 100-hour visit
    // cannot break it. This quality figure reflects that limit, not the raw signal.
    surface_composition: {
      quality: 0.35,
      note:
        "Strong degeneracies: ocean and sand are spectrally similar, and surface albedo " +
        "trades against planetary radius. Vegetation is the one component that retrieves " +
        "reliably, via the chlorophyll red edge.",
    },
    atmospheric_composition: { quality: 0.7, note: "Including the O2 and O3 biosignatures." },
    bond_albedo: { quality: 0.8, note: "Measured directly from reflected flux." },
    rotation_period: { quality: 0.6, note: "From rotational light-curve modulation." },
    planet_radius_ratio: { quality: 0.4, note: "Degenerate with albedo — see above." },
  },
  isDiscoveryFacility: true,
  references: ["2021pdaa.book.....N"],
});
