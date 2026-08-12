/**
 * Missions and what they can actually tell you.
 *
 * The important idea here is that a mission is not a filter label — it is an **evidence
 * source**. Which instruments observed a planet determines which physical parameters are
 * constrained at all, which determines how wide the hypothesis envelope is, which
 * determines how uncertain the rendered world should look.
 *
 * A TESS-only planet has a radius and a period and essentially nothing else, so its
 * surface must be drawn as a guess. The same planet with a JWST transmission spectrum and
 * a ground-based mass has a real atmosphere and a real density, and the world tightens
 * accordingly. Selecting missions is therefore a scientific act, not a cosmetic one.
 */

/**
 * Physical parameters an observation can constrain.
 *
 * Deliberately expressed as what is *measured*, not what is *derived*: transit photometry
 * measures a radius ratio, and a planetary radius only follows once the stellar radius is
 * known from somewhere else. Keeping that distinction is what stops the UI claiming a
 * mission measured something it merely contributed to.
 */
export type ConstrainedParameter =
  | "planet_radius_ratio"
  | "orbital_period"
  | "transit_epoch"
  | "orbital_inclination"
  | "eccentricity"
  | "planet_mass"
  | "stellar_radius"
  | "stellar_mass"
  | "stellar_effective_temperature"
  | "stellar_distance"
  | "stellar_proper_motion"
  | "stellar_metallicity"
  | "atmospheric_composition"
  | "atmospheric_scale_height"
  | "cloud_and_haze"
  | "dayside_temperature"
  | "heat_redistribution"
  | "bond_albedo"
  | "surface_composition"
  | "rotation_period";

export type ObservationTechnique =
  | "transit_photometry"
  | "radial_velocity"
  | "transmission_spectroscopy"
  | "emission_spectroscopy"
  | "phase_curve"
  | "secondary_eclipse"
  | "direct_imaging"
  | "reflected_light_spectroscopy"
  | "astrometry";

export type MissionStatus = "operational" | "completed" | "planned";

export interface WavelengthRange {
  /** Micrometres. */
  minUm: number;
  maxUm: number;
}

export interface Instrument {
  name: string;
  wavelength: WavelengthRange;
  techniques: readonly ObservationTechnique[];
  /** Approximate resolving power λ/Δλ, where meaningful. */
  resolvingPower?: number;
  note?: string;
}

export interface Mission {
  id: string;
  name: string;
  /** Short name as it appears in the NASA Exoplanet Archive `disc_facility` column. */
  archiveFacilityNames: readonly string[];
  agency: string;
  status: MissionStatus;
  /** Operational span. `endYear` absent means still running or not yet launched. */
  startYear: number;
  endYear?: number;
  description: string;
  instruments: readonly Instrument[];
  /** What this mission's data can constrain, with typical achievable precision. */
  constrains: Readonly<Partial<Record<ConstrainedParameter, ConstraintQuality>>>;
  /** Confirmed planets discovered, where the mission is a discovery facility. */
  discoveredPlanets?: number;
  /** True when the mission discovers planets rather than only characterising known ones. */
  isDiscoveryFacility: boolean;
  references: readonly string[];
}

/**
 * How well a mission constrains a parameter.
 *
 * Values feed straight into the confidence a derived quantity can carry, so they are
 * deliberately coarse — pretending to know that TESS constrains a radius ratio to 0.73
 * rather than 0.7 would be false precision about false precision.
 */
export interface ConstraintQuality {
  /** 0..1. Roughly: how much of the achievable precision this mission delivers. */
  quality: number;
  note?: string;
}

/** A user's chosen set of missions. */
export interface MissionSelection {
  readonly selected: ReadonlySet<string>;
}

/** What a selection can collectively constrain, and how well. */
export interface EvidenceProfile {
  /** Parameter → best quality available across the selected missions. */
  coverage: Readonly<Partial<Record<ConstrainedParameter, ConstraintQuality>>>;
  /** Which mission supplied the best constraint for each parameter. */
  bestSource: Readonly<Partial<Record<ConstrainedParameter, string>>>;
  /** Parameters no selected mission can constrain. These stay `null` in ScienceSpec. */
  unconstrained: readonly ConstrainedParameter[];
  /** Techniques available across the selection. */
  techniques: readonly ObservationTechnique[];
  /**
   * 0..1 aggregate. Drives how wide the hypothesis envelope opens and therefore how
   * speculative the rendered world looks.
   */
  completeness: number;
}
