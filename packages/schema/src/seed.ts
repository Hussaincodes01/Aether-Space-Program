/**
 * Deterministic seeding and content addressing.
 *
 * Two different jobs, deliberately kept apart:
 *
 *   contentHash()  async SHA-256 over the canonical version tuple. This is the cache key
 *                  and the export checksum. Correctness matters more than speed.
 *   hash32()       synchronous 32-bit hash for per-tile / per-feature noise seeding, where
 *                  it is called millions of times and must never allocate.
 *
 * Note what is *not* promised: byte-identical GPU output. Shader floating point differs
 * across drivers. What is promised is identical canonical inputs, identical terrain
 * commands, identical topology and feature placement, and heights within a documented
 * tolerance — see PRD §13.2.
 */

/** The complete set of inputs that determine a world. Changing any of them changes the world. */
export interface SeedComponents {
  canonicalObjectId: string;
  dataSnapshotHash: string;
  inferenceModelHashes: readonly string[];
  terrainModelVersion: string;
  hypothesisId: string;
  userOverrideHash: string;
  /** Present from v1.1, when observations narrow the envelope during play. */
  observationState?: string;
}

/**
 * Canonical string form of the seed tuple.
 *
 * Order is fixed and model hashes are sorted, so two runs that used the same models in a
 * different order produce the same seed rather than two spuriously different worlds.
 */
export function canonicalSeedString(c: SeedComponents): string {
  return [
    c.canonicalObjectId,
    c.dataSnapshotHash,
    [...c.inferenceModelHashes].sort().join(","),
    c.terrainModelVersion,
    c.hypothesisId,
    c.userOverrideHash,
    c.observationState ?? "",
  ].join("|");
}

/** SHA-256 of the canonical seed string, hex encoded. Works in Node 18+ and browsers. */
export async function contentHash(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seedHash(c: SeedComponents): Promise<string> {
  return `sha256:${await contentHash(canonicalSeedString(c))}`;
}

/**
 * FNV-1a, 32-bit. Synchronous, allocation-free, adequate for noise seeding.
 *
 * Not a cryptographic hash and not used as one — `contentHash` covers that.
 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, via shifts to stay in 32-bit integer range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Mix integer coordinates into a seed. Used for per-tile determinism:
 * `hashCoords(worldSeed, face, x, y, lod)` gives the same mountain in the same place,
 * every time, on every machine — because it is integer arithmetic, not float.
 */
export function hashCoords(seed: number, ...coords: number[]): number {
  let h = seed >>> 0;
  for (const c of coords) {
    h ^= (c | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h >>>= 0;
  }
  return h >>> 0;
}

/** Map a 32-bit hash into [0, 1). Deterministic across platforms — integer ops only. */
export function unitFloat(h: number): number {
  return (h >>> 0) / 0x1_0000_0000;
}

/** SplitMix32 — a small, fast, well-distributed PRNG for deterministic sampling. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
  };
}
