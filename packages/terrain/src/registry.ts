/**
 * Terrain operator registry.
 *
 * Adding a geological process means creating one file in `operators/` and exporting it
 * from `operators/index.ts`. Nothing else in the codebase changes — no switch statement,
 * no shader dispatch table to keep in sync by hand.
 */

import type { TerrainOperator } from "./types.js";

const registry = new Map<string, TerrainOperator>();

export function defineOperator(op: TerrainOperator): TerrainOperator {
  if (registry.has(op.id)) {
    throw new Error(
      `Terrain operator "${op.id}" is already registered. Ids appear in every compiled ` +
        `terrain program and in provenance records, so they must be unique and stable.`,
    );
  }
  registry.set(op.id, op);
  return op;
}

export function getOperator(id: string): TerrainOperator | undefined {
  return registry.get(id);
}

/** All operators, in layer order — the order a renderer should apply them. */
export function listOperators(): readonly TerrainOperator[] {
  return [...registry.values()].sort((a, b) => a.layerOrder - b.layerOrder);
}

export function operatorIds(): readonly string[] {
  return [...registry.keys()].sort();
}
