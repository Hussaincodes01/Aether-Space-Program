/**
 * Atmospheric characterisation missions.
 *
 * These are the only missions that constrain an atmosphere at all. Everything Aether says
 * about composition, clouds or scale height traces back to one of them — and for the vast
 * majority of the catalog, none of them has ever looked, which is precisely why the
 * atmosphere layer must be able to render an honest "we do not know".
 */

import { defineMission } from "../registry.js";

export const jwst = defineMission({
  id: "jwst",
  name: "JWST",
  archiveFacilityNames: ["James Webb Space Telescope", "JWST"],
  agency: "NASA / ESA / CSA",
  status: "operational",
  startYear: 2022,
  description:
    "The first observatory able to measure exoplanet atmospheric composition with real " +
    "confidence, across a wavelength range wide enough to break several of the degeneracies " +
    "that limited HST-era retrievals.",
  instruments: [
    {
      name: "NIRISS SOSS",
      wavelength: { minUm: 0.6, maxUm: 2.8 },
      techniques: ["transmission_spectroscopy"],
      resolvingPower: 700,
    },
    {
      name: "NIRSpec PRISM",
      wavelength: { minUm: 0.6, maxUm: 5.3 },
      techniques: ["transmission_spectroscopy", "emission_spectroscopy"],
      resolvingPower: 100,
      note: "Widest single-shot coverage; the workhorse for terrestrial targets.",
    },
    {
      name: "NIRSpec G395H",
      wavelength: { minUm: 2.87, maxUm: 5.14 },
      techniques: ["transmission_spectroscopy", "emission_spectroscopy"],
      resolvingPower: 2700,
      note: "Resolves CO2 and CO bands individually.",
    },
    {
      name: "NIRCam",
      wavelength: { minUm: 0.6, maxUm: 5.0 },
      techniques: ["transmission_spectroscopy", "phase_curve"],
      resolvingPower: 1600,
    },
    {
      name: "MIRI LRS",
      wavelength: { minUm: 5, maxUm: 12 },
      techniques: ["emission_spectroscopy", "secondary_eclipse", "phase_curve"],
      resolvingPower: 100,
      note: "Thermal emission; the route to dayside temperature and heat redistribution.",
    },
  ],
  constrains: {
    atmospheric_composition: {
      quality: 0.85,
      note: "Molecular abundances with genuine uncertainty, not just a detection claim.",
    },
    atmospheric_scale_height: { quality: 0.8 },
    cloud_and_haze: { quality: 0.7, note: "Grey opacity and haze slope are separable." },
    dayside_temperature: { quality: 0.85, note: "From secondary eclipse depth in the mid-IR." },
    heat_redistribution: { quality: 0.7, note: "Requires a full phase curve." },
    bond_albedo: { quality: 0.5 },
    planet_radius_ratio: { quality: 0.9, note: "White-light transit depth, very precise." },
  },
  isDiscoveryFacility: false,
  references: ["2023PASP..135f8001R"],
});

export const hst = defineMission({
  id: "hst",
  name: "Hubble Space Telescope",
  archiveFacilityNames: ["Hubble Space Telescope", "HST"],
  agency: "NASA / ESA",
  status: "operational",
  startYear: 1990,
  description:
    "Carried exoplanet atmospheric science for two decades. Its narrow WFC3 window covers " +
    "one water band and little else, which is why HST-era retrievals were so often " +
    "degenerate between a water-rich clear atmosphere and a water-poor cloudy one.",
  instruments: [
    {
      name: "WFC3/IR G141",
      wavelength: { minUm: 1.1, maxUm: 1.7 },
      techniques: ["transmission_spectroscopy", "emission_spectroscopy"],
      resolvingPower: 130,
      note: "The 1.4 um water band. Narrow coverage is the source of the classic degeneracy.",
    },
    {
      name: "STIS",
      wavelength: { minUm: 0.2, maxUm: 1.0 },
      techniques: ["transmission_spectroscopy"],
      resolvingPower: 500,
      note: "Optical and UV; measures the Rayleigh scattering slope and escaping hydrogen.",
    },
  ],
  constrains: {
    atmospheric_composition: {
      quality: 0.4,
      note: "Water only, and strongly degenerate with cloud-top pressure.",
    },
    atmospheric_scale_height: { quality: 0.5 },
    cloud_and_haze: { quality: 0.45, note: "Rayleigh slope from STIS constrains haze." },
    planet_radius_ratio: { quality: 0.8 },
  },
  isDiscoveryFacility: false,
  references: ["2013MNRAS.435.3481D"],
});

export const spitzer = defineMission({
  id: "spitzer",
  name: "Spitzer Space Telescope",
  archiveFacilityNames: ["Spitzer Space Telescope", "Spitzer"],
  agency: "NASA",
  status: "completed",
  startYear: 2003,
  endYear: 2020,
  description:
    "The first observatory to measure exoplanet thermal emission. Its broadband IRAC " +
    "photometry gave dayside temperatures and phase curves — including the LHS 3844 b " +
    "result that made a bare-rock, airless world the leading interpretation.",
  instruments: [
    {
      name: "IRAC 3.6 / 4.5 um",
      wavelength: { minUm: 3.1, maxUm: 5.0 },
      techniques: ["secondary_eclipse", "phase_curve", "emission_spectroscopy"],
      note: "Broadband photometry, not spectroscopy: two colours, not a spectrum.",
    },
  ],
  constrains: {
    dayside_temperature: { quality: 0.6 },
    heat_redistribution: {
      quality: 0.55,
      note: "Phase curves distinguish a thick atmosphere from a bare rock.",
    },
    bond_albedo: { quality: 0.35 },
    atmospheric_composition: {
      quality: 0.15,
      note: "Two broadband colours only; molecular identification is not possible.",
    },
  },
  isDiscoveryFacility: false,
  references: ["2004ApJS..154....1W"],
});
