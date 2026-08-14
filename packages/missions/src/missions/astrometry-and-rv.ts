/**
 * The missions that supply the two things transits cannot: the star, and the mass.
 *
 * Without Gaia there is no stellar radius, so a transit depth gives a ratio and nothing
 * more. Without radial velocity there is no mass, so there is no density, no surface
 * gravity, and no way to tell a rocky world from a puffy one. Almost every derived
 * quantity in Aether depends on one of these two.
 */

import { defineMission } from "../registry.js";

export const gaia = defineMission({
  id: "gaia",
  name: "Gaia",
  archiveFacilityNames: ["Gaia"],
  agency: "ESA",
  status: "operational",
  startYear: 2013,
  description:
    "Astrometry for nearly two billion stars. Gaia supplies the distances and stellar " +
    "parameters that turn a transit depth into a planetary radius — and it renders the " +
    "night sky from the planet's own position rather than Earth's.",
  instruments: [
    {
      name: "Astrometric field",
      wavelength: { minUm: 0.33, maxUm: 1.05 },
      techniques: ["astrometry"],
      note: "Parallax to microarcsecond precision for bright stars.",
    },
    {
      name: "BP/RP photometers",
      wavelength: { minUm: 0.33, maxUm: 1.05 },
      techniques: ["astrometry"],
      resolvingPower: 50,
      note: "Low-resolution spectrophotometry; yields Teff, radius and luminosity.",
    },
  ],
  constrains: {
    stellar_distance: { quality: 0.95, note: "Parallax; the foundation of the whole scale." },
    stellar_proper_motion: { quality: 0.95 },
    stellar_radius: { quality: 0.7, note: "From luminosity and Teff." },
    stellar_effective_temperature: { quality: 0.7 },
    stellar_mass: { quality: 0.5, note: "Inferred via isochrones, not measured directly." },
    stellar_metallicity: { quality: 0.5 },
    planet_mass: {
      quality: 0.3,
      note: "Astrometric detection only, and only for massive planets on wide orbits.",
    },
  },
  discoveredPlanets: 4,
  isDiscoveryFacility: true,
  references: ["2016A&A...595A...1G", "2023A&A...674A...1G"],
});

export const groundRadialVelocity = defineMission({
  id: "ground_rv",
  name: "Ground-based radial velocity",
  archiveFacilityNames: [
    "HARPS",
    "HARPS-N",
    "ESPRESSO",
    "HIRES",
    "Keck",
    "CARMENES",
    "SOPHIE",
    "ELODIE",
    "MAROON-X",
    "NEID",
    "La Silla",
    "Lick",
    "Anglo-Australian",
  ],
  agency: "Various",
  status: "operational",
  startYear: 1995,
  description:
    "High-precision spectrographs measuring the host star's reflex motion. The only " +
    "widely-available route to a planetary mass, and therefore to density and surface " +
    "gravity. ESPRESSO reaches ~10 cm/s, enough for an Earth analogue around a quiet M-dwarf.",
  instruments: [
    {
      name: "Precision spectrographs",
      wavelength: { minUm: 0.38, maxUm: 1.7 },
      techniques: ["radial_velocity"],
      resolvingPower: 115_000,
    },
  ],
  constrains: {
    planet_mass: {
      quality: 0.8,
      note: "Strictly M·sin(i) unless a transit fixes the inclination.",
    },
    eccentricity: { quality: 0.8, note: "Directly from the RV curve shape." },
    orbital_period: { quality: 0.85 },
    stellar_effective_temperature: { quality: 0.85, note: "From the same high-res spectra." },
    stellar_metallicity: { quality: 0.85 },
    stellar_mass: { quality: 0.6 },
  },
  discoveredPlanets: 1100,
  isDiscoveryFacility: true,
  references: ["1995Natur.378..355M"],
});

export const directImaging = defineMission({
  id: "direct_imaging",
  name: "Ground-based direct imaging",
  archiveFacilityNames: ["VLT", "SPHERE", "GPI", "Gemini", "Subaru", "Keck/NIRC2", "GRAVITY"],
  agency: "Various",
  status: "operational",
  startYear: 2004,
  description:
    "Adaptive-optics coronagraphy that resolves young, hot, widely-separated giant planets " +
    "directly. A completely different data modality: it measures the planet's own light " +
    "rather than the star's, which makes HR 8799 e the catalog's odd one out.",
  instruments: [
    {
      name: "Coronagraphic imagers and IFUs",
      wavelength: { minUm: 0.95, maxUm: 5.0 },
      techniques: ["direct_imaging", "emission_spectroscopy"],
      resolvingPower: 500,
    },
  ],
  constrains: {
    atmospheric_composition: {
      quality: 0.5,
      note: "Directly from the planet's own emission, with no stellar contamination.",
    },
    dayside_temperature: { quality: 0.7 },
    cloud_and_haze: { quality: 0.5 },
    planet_mass: {
      quality: 0.3,
      note: "From luminosity plus an evolutionary model — model-dependent.",
    },
    orbital_inclination: { quality: 0.6, note: "From orbital motion over years." },
    eccentricity: { quality: 0.5 },
  },
  discoveredPlanets: 80,
  isDiscoveryFacility: true,
  references: ["2008Sci...322.1348M"],
});
