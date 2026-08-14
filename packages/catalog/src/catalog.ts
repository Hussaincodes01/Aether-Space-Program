/**
 * Catalog ingestion.
 *
 * Seed data is validated once, at module load, and a failure throws. That is deliberate: a
 * catalog entry with an unresolvable source id or a malformed value is a defect in the
 * repository, not a runtime condition to degrade around, and it should stop the build rather
 * than surface as a strange planet three screens later.
 *
 * Validation is stricter than the Zod schema alone. Zod checks shape; these checks also
 * confirm that every `sourceId` resolves in the source registry, which is what makes the
 * provenance inspector's central promise structurally true rather than merely intended.
 */

import { InvalidCatalogDataError, UnknownCatalogEntryError } from "./errors.js";
import {
  SystemSeedSchema,
  type CatalogValue,
  type PlanetSeed,
  type SystemSeed,
} from "./schema.js";
import { sourceExists } from "./sources.js";
import { PROXIMA_CENTAURI, SOL } from "./seed/reference.js";
import { TRAPPIST_1 } from "./seed/trappist-1.js";

const SEEDS: readonly SystemSeed[] = [SOL, TRAPPIST_1, PROXIMA_CENTAURI];

/** Every catalog value on a system, with a path for error reporting. */
function* allValues(system: SystemSeed): Generator<[string, CatalogValue]> {
  const star = system.star;
  yield [`star.distance`, star.distance];
  yield [`star.effectiveTemperature`, star.effectiveTemperature];
  yield [`star.radius`, star.radius];
  yield [`star.mass`, star.mass];
  if (star.luminosity) yield [`star.luminosity`, star.luminosity];
  if (star.metallicity) yield [`star.metallicity`, star.metallicity];

  for (const planet of system.planets) {
    const p = `planet[${planet.id}]`;
    yield [`${p}.radius`, planet.radius];
    yield [`${p}.mass`, planet.mass];
    yield [`${p}.orbitalPeriod`, planet.orbitalPeriod];
    yield [`${p}.semiMajorAxis`, planet.semiMajorAxis];
    yield [`${p}.eccentricity`, planet.eccentricity];
    if (planet.inclination) yield [`${p}.inclination`, planet.inclination];
    if (planet.bondAlbedo) yield [`${p}.bondAlbedo`, planet.bondAlbedo];
    if (planet.surfacePressure) yield [`${p}.surfacePressure`, planet.surfacePressure];
  }
}

/**
 * Validate one seed system.
 *
 * Exported so tests can feed it deliberately broken entries and confirm it rejects them.
 * A validator that is only ever exercised on good data is a validator nobody has tested.
 */
export function validateSystemSeed(seed: unknown): SystemSeed {
  const parsed = SystemSeedSchema.safeParse(seed);
  if (!parsed.success) {
    const id =
      typeof seed === "object" && seed !== null && "id" in seed
        ? String((seed as { id: unknown }).id)
        : "(unknown)";
    throw new InvalidCatalogDataError(
      id,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const system = parsed.data;
  const issues: string[] = [];

  for (const [path, value] of allValues(system)) {
    if (!sourceExists(value.sourceId)) {
      issues.push(`${path}: sourceId "${value.sourceId}" is not in the source registry`);
    }
    if (value.value !== null && !Number.isFinite(value.value)) {
      issues.push(`${path}: value is not finite`);
    }
  }

  const planetIds = system.planets.map((p) => p.id);
  if (new Set(planetIds).size !== planetIds.length) {
    issues.push(`duplicate planet ids: ${planetIds.join(", ")}`);
  }

  if (issues.length > 0) throw new InvalidCatalogDataError(system.id, issues);
  return system;
}

const systems = new Map<string, SystemSeed>();

for (const seed of SEEDS) {
  const validated = validateSystemSeed(seed);
  if (systems.has(validated.id)) {
    throw new InvalidCatalogDataError(validated.id, ["duplicate system id"]);
  }
  systems.set(validated.id, validated);
}

export interface SystemSummary {
  id: string;
  name: string;
  blurb: string;
  planetCount: number;
  /** Distance in parsecs, as published. Zero for the Solar System. */
  distancePc: number | null;
}

export function listSystems(): readonly SystemSummary[] {
  return [...systems.values()].map((s) => ({
    id: s.id,
    name: s.name,
    blurb: s.blurb,
    planetCount: s.planets.length,
    distancePc: s.star.distance.value,
  }));
}

export function getSystem(id: string): SystemSeed {
  const system = systems.get(id);
  if (!system) {
    throw new UnknownCatalogEntryError("system", id, [...systems.keys()]);
  }
  return system;
}

export function getPlanet(systemId: string, planetId: string): PlanetSeed {
  const system = getSystem(systemId);
  const planet = system.planets.find((p) => p.id === planetId);
  if (!planet) {
    throw new UnknownCatalogEntryError(
      "planet",
      planetId,
      system.planets.map((p) => p.id),
    );
  }
  return planet;
}

/** True when the id pair exists. For callers that want to check rather than catch. */
export function hasPlanet(systemId: string, planetId: string): boolean {
  const system = systems.get(systemId);
  return system?.planets.some((p) => p.id === planetId) ?? false;
}
