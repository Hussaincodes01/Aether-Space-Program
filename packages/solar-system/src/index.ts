export * from "./kepler.js";
export * from "./bodies.js";
export * from "./moons.js";
export * from "./dwarf-planets.js";
export * from "./context.js";

import { CORE_BODIES, solidSurfaceBodies, type SolarBody } from "./bodies.js";
import { MAJOR_MOONS } from "./moons.js";
import { DWARF_PLANETS } from "./dwarf-planets.js";

/**
 * Every body Aether models: the Sun, eight planets, seventeen major moons, and six dwarf
 * planets including Charon.
 *
 * Assembled here rather than in `bodies.ts` so that file stays a data table and the moon and
 * dwarf tables can reference planetary GM values without a circular import.
 */
export const SOLAR_SYSTEM: readonly SolarBody[] = [
  ...CORE_BODIES,
  ...MAJOR_MOONS,
  ...DWARF_PLANETS,
];

export function getBody(id: string): SolarBody | undefined {
  return SOLAR_SYSTEM.find((b) => b.id === id);
}

/** Bodies with a solid surface worth generating terrain for. */
export function terrestrialBodies(): readonly SolarBody[] {
  return solidSurfaceBodies(SOLAR_SYSTEM);
}
