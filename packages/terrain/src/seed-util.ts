/**
 * Local copy of the 32-bit string hash.
 *
 * Duplicated from `@aether/schema` deliberately: the terrain package is the one piece that
 * may eventually be ported to WGSL and to a CPU reference generator, and it should not drag
 * the whole contract package along for one small function. The two implementations are
 * asserted identical in the tests.
 */

/** FNV-1a, 32-bit. Integer arithmetic only, so it is identical on every platform. */
export function hash32(input: string | number): number {
  const text = typeof input === "number" ? String(input >>> 0) : input;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
