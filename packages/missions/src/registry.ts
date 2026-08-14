/**
 * Mission registry.
 *
 * Same building-block pattern as the physics and terrain registries: adding a mission
 * means creating one file in `missions/` and exporting it from `missions/index.ts`.
 * The selector UI, the filters and the evidence model all pick it up automatically.
 */

import type { Mission, MissionStatus, ObservationTechnique } from "./types.js";

const registry = new Map<string, Mission>();

export function defineMission(mission: Mission): Mission {
  if (registry.has(mission.id)) {
    throw new Error(
      `Mission id "${mission.id}" is already registered. Ids are referenced from provenance ` +
        `records and saved user selections, so they must be unique and stable.`,
    );
  }
  registry.set(mission.id, mission);
  return mission;
}

export function getMission(id: string): Mission | undefined {
  return registry.get(id);
}

/** All missions, newest first — the order a selector should present them. */
export function listMissions(): readonly Mission[] {
  return [...registry.values()].sort((a, b) => b.startYear - a.startYear);
}

export function missionIds(): readonly string[] {
  return [...registry.keys()].sort();
}

export function missionsByStatus(status: MissionStatus): readonly Mission[] {
  return listMissions().filter((m) => m.status === status);
}

export function missionsWithTechnique(technique: ObservationTechnique): readonly Mission[] {
  return listMissions().filter((m) =>
    m.instruments.some((i) => i.techniques.includes(technique)),
  );
}

/** Discovery facilities only — the missions that can populate a catalog. */
export function discoveryFacilities(): readonly Mission[] {
  return listMissions().filter((m) => m.isDiscoveryFacility);
}

/**
 * Resolve a NASA Exoplanet Archive `disc_facility` string to a mission.
 *
 * The archive uses long-form facility names ("Transiting Exoplanet Survey Satellite
 * (TESS)"), so matching is on the declared aliases rather than the id. An unmatched
 * facility returns undefined and the caller must show it as an unrecognised source rather
 * than guessing.
 */
export function missionForFacility(facility: string): Mission | undefined {
  const needle = facility.trim().toLowerCase();
  return listMissions().find((m) =>
    m.archiveFacilityNames.some((alias) => needle.includes(alias.toLowerCase())),
  );
}
