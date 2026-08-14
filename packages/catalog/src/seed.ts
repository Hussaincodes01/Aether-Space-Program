/**
 * Deterministic seeds for a planet under an evidence profile.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *   1. The **same** planet under the **same** evidence must always produce the same world.
 *      Otherwise a deep link is meaningless and a screenshot cannot be reproduced.
 *   2. A **different** evidence profile must be able to produce a different world, because
 *      that is the entire mechanic — new observations narrow the envelope and the
 *      hypothesis changes.
 *
 * So the evidence profile is part of the seed, reduced to a canonical string that depends
 * only on what is actually constrained and how well. Two selections that constrain the same
 * parameters to the same quality give the same seed even if the user ticked different
 * boxes to get there, which is right: the world depends on the evidence, not on the route
 * taken to it.
 */

import type { EvidenceProfile } from "@aether/missions";

/**
 * Canonical string for a planet + evidence pair.
 *
 * Coverage entries are sorted, so key insertion order cannot change the seed. This is the
 * same class of bug as unsorted compile warnings: it would work locally and diverge
 * somewhere else for no visible reason.
 */
export function planetSeedString(
  systemId: string,
  planetId: string,
  evidence: EvidenceProfile,
): string {
  const coverage = Object.entries(evidence.coverage)
    .filter(([, quality]) => quality !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    // `quality` is an object, so interpolating it directly would render "[object Object]"
    // and collapse every constraint quality onto the same seed. Better evidence has to be
    // able to change the world, or the central mechanic silently stops working.
    .map(([parameter, quality]) => `${parameter}=${quality!.quality.toFixed(3)}`)
    .join(",");

  return `aether:v1|${systemId}|${planetId}|${coverage}`;
}

/**
 * A stable 64-bit-ish hash, rendered as hex, prefixed so its origin is visible in logs.
 *
 * Not cryptographic and does not need to be. Its job is to spread similar inputs apart and
 * to be identical across platforms and runs, which a hand-written FNV-1a variant does and
 * `Math.random` or object iteration order emphatically do not.
 */
export function stableSeed(canonical: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
  }

  const hex = (n: number): string => n.toString(16).padStart(8, "0");
  return `seed:${hex(h1)}${hex(h2)}`;
}
