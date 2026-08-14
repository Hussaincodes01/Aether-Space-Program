/**
 * The star catalogue binary format, and how to read it.
 *
 * Positions are **equatorial J2000 cartesian, in parsecs**, exactly as HYG supplies them:
 * +x toward the vernal equinox, +z toward the north celestial pole. Keeping the catalogue's
 * own frame rather than converting on import means a position can always be checked against
 * the source row, which matters when someone asks why a star is where it is.
 *
 * Layout, little-endian throughout:
 *
 *   offset  0   char[8]  "AETHSTAR"
 *   offset  8   uint32   format version
 *   offset 12   uint32   star count
 *   offset 16   record[] { f32 x, f32 y, f32 z, f32 absMag, f32 colourIndex }
 *
 * The magic exists so a truncated download or a wrong-endian platform fails loudly rather
 * than rendering a sky full of garbage, which is the kind of bug that wastes an afternoon.
 */

import { PARSEC } from "@aether/units";

export const CATALOG_MAGIC = "AETHSTAR";
export const CATALOG_VERSION = 1;
export const BYTES_PER_STAR = 20;
const HEADER_BYTES = 16;

/**
 * Stars as parallel typed arrays rather than an array of objects.
 *
 * 109,389 objects would be 109,389 allocations and a cache miss per star during upload.
 * Typed arrays go straight into GPU buffers with no copy.
 */
export interface StarCatalog {
  count: number;
  /** Equatorial J2000 cartesian, parsecs. Three components per star. */
  positionsPc: Float32Array;
  absoluteMagnitudes: Float32Array;
  /** B-V colour index. */
  colourIndices: Float32Array;
}

export class CatalogFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogFormatError";
  }
}

export function parseCatalog(buffer: ArrayBuffer): StarCatalog {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new CatalogFormatError(
      `Buffer is ${buffer.byteLength} bytes, too short to contain a header. Truncated download?`,
    );
  }

  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== CATALOG_MAGIC) {
    throw new CatalogFormatError(
      `Bad magic "${magic}" (expected "${CATALOG_MAGIC}"). This is not a star catalogue, ` +
        `or it was served as text and mangled.`,
    );
  }

  const view = new DataView(buffer);
  const version = view.getUint32(8, true);
  if (version !== CATALOG_VERSION) {
    throw new CatalogFormatError(
      `Catalogue format version ${version}, expected ${CATALOG_VERSION}. Rebuild it with ` +
        `scripts/build-catalog.mjs rather than reading it with the wrong layout.`,
    );
  }

  const count = view.getUint32(12, true);
  const expected = HEADER_BYTES + count * BYTES_PER_STAR;
  if (buffer.byteLength !== expected) {
    throw new CatalogFormatError(
      `Header declares ${count} stars (${expected} bytes) but the buffer is ` +
        `${buffer.byteLength} bytes. Truncated or corrupt.`,
    );
  }

  const positionsPc = new Float32Array(count * 3);
  const absoluteMagnitudes = new Float32Array(count);
  const colourIndices = new Float32Array(count);

  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    positionsPc[i * 3] = view.getFloat32(offset, true);
    positionsPc[i * 3 + 1] = view.getFloat32(offset + 4, true);
    positionsPc[i * 3 + 2] = view.getFloat32(offset + 8, true);
    absoluteMagnitudes[i] = view.getFloat32(offset + 12, true);
    colourIndices[i] = view.getFloat32(offset + 16, true);
    offset += BYTES_PER_STAR;
  }

  return { count, positionsPc, absoluteMagnitudes, colourIndices };
}

/** Distance from the Sun in parsecs. */
export function distanceParsecs(catalog: StarCatalog, index: number): number {
  const i = index * 3;
  return Math.hypot(
    catalog.positionsPc[i]!,
    catalog.positionsPc[i + 1]!,
    catalog.positionsPc[i + 2]!,
  );
}

/** Position in metres, for the f64 frame tree. Parsecs are the catalogue's unit, not ours. */
export function positionMetres(
  catalog: StarCatalog,
  index: number,
): { x: number; y: number; z: number } {
  const i = index * 3;
  return {
    x: catalog.positionsPc[i]! * PARSEC,
    y: catalog.positionsPc[i + 1]! * PARSEC,
    z: catalog.positionsPc[i + 2]! * PARSEC,
  };
}

export interface CatalogTier {
  /** Naked-eye stars. Small, loads instantly. */
  bright: string;
  /** Everything with a real parallax distance. Streams in afterwards. */
  full: string;
}

export const CATALOG_FILES: CatalogTier = {
  bright: "stars-bright.bin",
  full: "stars-full.bin",
};

/**
 * Fetch and parse a catalogue tier.
 *
 * Progressive by design: load `bright` first so the sky is populated within a frame or two,
 * then load `full` in the background. A 2 MB blocking download before anything renders is a
 * bad first impression, and the naked-eye sky is what a user actually recognises.
 */
export async function loadCatalog(url: string): Promise<StarCatalog> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new CatalogFormatError(
      `Failed to load star catalogue from ${url}: ${response.status}`,
    );
  }
  return parseCatalog(await response.arrayBuffer());
}
