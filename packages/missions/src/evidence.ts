/**
 * From a mission selection to an evidence profile.
 *
 * This is where choosing missions stops being a filter and becomes a scientific
 * statement. The selected missions determine which parameters are constrained; the
 * unconstrained ones stay `null` in ScienceSpec and must be filled by the inference
 * resolver, which widens the hypothesis envelope, which makes the rendered world visibly
 * less certain.
 *
 * Select TESS alone and you get a radius ratio and a period: the surface is a guess and
 * should look like one. Add Gaia and the radius becomes real. Add radial velocity and the
 * density follows. Add JWST and the sky colour is finally derived from a measurement
 * rather than an assumption.
 */

import { getMission, listMissions } from "./registry.js";
import type {
  ConstrainedParameter,
  ConstraintQuality,
  EvidenceProfile,
  Mission,
  MissionSelection,
  ObservationTechnique,
} from "./types.js";

/**
 * How much each parameter matters to producing an honest world.
 *
 * Weights reflect rendering and scientific leverage, not how interesting the parameter is.
 * Stellar distance is weighted heavily because without it there is no scale at all; surface
 * composition is weighted low because no realistic mission constrains it well, so demanding
 * it would make every profile look bad for a reason the user cannot act on.
 */
export const PARAMETER_WEIGHTS: Readonly<Record<ConstrainedParameter, number>> = {
  stellar_distance: 1.0,
  stellar_radius: 1.0,
  stellar_effective_temperature: 1.0,
  planet_radius_ratio: 1.0,
  orbital_period: 0.9,
  planet_mass: 0.9,
  stellar_mass: 0.6,
  atmospheric_composition: 0.7,
  atmospheric_scale_height: 0.5,
  dayside_temperature: 0.5,
  transit_epoch: 0.3,
  orbital_inclination: 0.4,
  eccentricity: 0.4,
  heat_redistribution: 0.4,
  cloud_and_haze: 0.35,
  bond_albedo: 0.4,
  stellar_metallicity: 0.3,
  stellar_proper_motion: 0.2,
  rotation_period: 0.3,
  surface_composition: 0.25,
};

export const ALL_PARAMETERS = Object.keys(PARAMETER_WEIGHTS) as ConstrainedParameter[];

export function createSelection(missionIds: Iterable<string>): MissionSelection {
  return { selected: new Set(missionIds) };
}

export function selectedMissions(selection: MissionSelection): readonly Mission[] {
  return [...selection.selected]
    .map((id) => getMission(id))
    .filter((m): m is Mission => m !== undefined);
}

/**
 * Combine the selected missions into a single profile.
 *
 * Quality is the **best** available across missions, not a sum. Two mediocre transit
 * surveys do not add up to one good one — that would let a user manufacture confidence by
 * ticking more boxes, which is exactly the failure mode this whole product exists to
 * avoid.
 */
export function buildEvidenceProfile(selection: MissionSelection): EvidenceProfile {
  const coverage: Partial<Record<ConstrainedParameter, ConstraintQuality>> = {};
  const bestSource: Partial<Record<ConstrainedParameter, string>> = {};
  const techniques = new Set<ObservationTechnique>();

  for (const mission of selectedMissions(selection)) {
    for (const instrument of mission.instruments) {
      for (const technique of instrument.techniques) techniques.add(technique);
    }

    for (const [parameter, quality] of Object.entries(mission.constrains) as Array<
      [ConstrainedParameter, ConstraintQuality]
    >) {
      const existing = coverage[parameter];
      if (!existing || quality.quality > existing.quality) {
        coverage[parameter] = quality;
        bestSource[parameter] = mission.id;
      }
    }
  }

  const unconstrained = ALL_PARAMETERS.filter((p) => coverage[p] === undefined);

  let weighted = 0;
  let totalWeight = 0;
  for (const parameter of ALL_PARAMETERS) {
    const weight = PARAMETER_WEIGHTS[parameter];
    totalWeight += weight;
    weighted += weight * (coverage[parameter]?.quality ?? 0);
  }

  return {
    coverage,
    bestSource,
    unconstrained,
    techniques: [...techniques].sort(),
    completeness: totalWeight > 0 ? weighted / totalWeight : 0,
  };
}

/**
 * Confidence ceiling a parameter can carry given the evidence.
 *
 * An unconstrained parameter returns 0 — meaning ScienceSpec keeps `null` and anything the
 * renderer shows for it came from the inference resolver and must be badged as such.
 */
export function confidenceCeiling(
  profile: EvidenceProfile,
  parameter: ConstrainedParameter,
): number {
  return profile.coverage[parameter]?.quality ?? 0;
}

export function isConstrained(
  profile: EvidenceProfile,
  parameter: ConstrainedParameter,
): boolean {
  return profile.coverage[parameter] !== undefined;
}

/**
 * How far the hypothesis envelope should open, 0..1.
 *
 * The inverse of completeness, with a floor: even perfect data leaves real uncertainty
 * about a surface nobody has ever resolved, so the envelope never closes entirely. That
 * floor is not pessimism — it is the honest statement that no exoplanet surface has been
 * observed.
 */
export function envelopeWidth(profile: EvidenceProfile): number {
  const MINIMUM_WIDTH = 0.15;
  return Math.max(MINIMUM_WIDTH, 1 - profile.completeness);
}

/**
 * Plain-language summary of what a selection can and cannot establish.
 *
 * Written for the UI panel, so it names the missing thing that matters most rather than
 * listing everything absent.
 */
export function describeEvidence(profile: EvidenceProfile): string {
  if (profile.completeness === 0) {
    return "No missions selected. Nothing about this planet can be established.";
  }

  const missing: string[] = [];
  if (!isConstrained(profile, "stellar_distance")) missing.push("distance");
  if (!isConstrained(profile, "planet_mass")) missing.push("mass, so no density or gravity");
  if (!isConstrained(profile, "stellar_radius")) {
    missing.push("stellar radius, so the transit gives only a ratio");
  }
  if (!isConstrained(profile, "atmospheric_composition")) missing.push("atmosphere");

  const pct = Math.round(profile.completeness * 100);
  if (missing.length === 0) {
    return `${pct}% parameter coverage. Every major quantity is constrained by at least one selected mission.`;
  }
  return `${pct}% parameter coverage. Unconstrained: ${missing.join("; ")}.`;
}

/**
 * Curated selections, so a user can meaningfully compare eras in one click rather than
 * reasoning about instrument lists.
 */
export const MISSION_PRESETS = {
  kepler_era: {
    name: "Kepler era (2009-2013)",
    description: "What was knowable before Gaia distances and JWST spectra.",
    missions: ["kepler", "ground_rv", "hst", "spitzer"],
  },
  today: {
    name: "Everything flying today",
    description: "The full modern picture: TESS discovery, Gaia scale, JWST atmospheres.",
    missions: ["tess", "kepler", "k2", "gaia", "ground_rv", "ground_transit", "jwst", "hst", "spitzer", "direct_imaging"],
  },
  discovery_only: {
    name: "Discovery data only",
    description: "A planet as it looks the day it is announced, before any follow-up.",
    missions: ["tess", "kepler", "k2", "corot", "ground_transit"],
  },
  jwst_targets: {
    name: "JWST characterisation targets",
    description: "Planets with real atmospheric measurements.",
    missions: ["tess", "gaia", "ground_rv", "jwst"],
  },
  future: {
    name: "Projected — next generation",
    description:
      "What PLATO, Ariel and HWO would add. Everything derived here is a projection, not data.",
    missions: ["plato", "ariel", "roman", "hwo", "gaia", "ground_rv", "jwst"],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; missions: readonly string[] }
>;

export type MissionPresetId = keyof typeof MISSION_PRESETS;

export function presetSelection(id: MissionPresetId): MissionSelection {
  return createSelection(MISSION_PRESETS[id].missions);
}

/** Every registered mission. The default state before a user narrows it. */
export function allMissionsSelection(): MissionSelection {
  return createSelection(listMissions().map((m) => m.id));
}

/**
 * True when a selection includes any mission that has not flown.
 *
 * The UI must label a projected world differently from an observed one, and this is the
 * check that drives it.
 */
export function includesPlannedMission(selection: MissionSelection): boolean {
  return selectedMissions(selection).some((m) => m.status === "planned");
}
