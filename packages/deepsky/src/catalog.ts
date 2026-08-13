/**
 * Deep-sky catalogue binary format.
 *
 * Directions are equatorial J2000 unit vectors — the same convention the star catalogue
 * uses, so the two layers register against each other with no frame conversion.
 *
 *   offset  0   char[8]  "AETHDSKY"
 *   offset  8   uint32   format version
 *   offset 12   uint32   object count
 *   offset 16   record[] { f32 dx, dy, dz, distanceMpc, vMag, majAxArcmin,
 *                          u8 type, u8 distanceMethod, u16 pad }
 *
 * Objects are stored brightest-first, so a renderer can draw a prefix of the buffer as a
 * quality tier without sorting 12,000 records every time the setting changes.
 *
 * `distanceMpc` of 0 means genuinely unknown — most nebulae and clusters have neither a
 * redshift nor a parallax in the source. Those are placed on the celestial sphere at a
 * nominal radius and flagged, rather than given an invented depth.
 */

import { DeepSkyType } from "./types.js";
import type { DistanceMethod } from "./distance.js";

export const DEEPSKY_MAGIC = "AETHDSKY";
export const DEEPSKY_VERSION = 1;
export const BYTES_PER_OBJECT = 28;
const HEADER_BYTES = 16;

/** Conventional "not measured" magnitude in OpenNGC. */
export const UNKNOWN_MAGNITUDE = 99;

const METHODS: readonly DistanceMethod[] = ["unknown", "parallax", "redshift"];

export interface DeepSkyCatalog {
  count: number;
  /** Equatorial J2000 unit vectors, three components per object. */
  directions: Float32Array;
  /** Megaparsecs; 0 means unknown. */
  distancesMpc: Float32Array;
  /** Visual magnitude; 99 means not measured. */
  magnitudes: Float32Array;
  /** Major axis in arcminutes; 0 means unknown. */
  majorAxes: Float32Array;
  types: Uint8Array;
  distanceMethods: Uint8Array;
}

export interface NamedObject {
  /** Index into the catalogue arrays. */
  i: number;
  /** NGC/IC designation. */
  name: string;
  /** Messier number, where the object has one. */
  m?: number;
  /** Common name, first only. */
  common?: string;
}

export class DeepSkyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSkyFormatError";
  }
}

export function parseDeepSky(buffer: ArrayBuffer): DeepSkyCatalog {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new DeepSkyFormatError(
      `Buffer is ${buffer.byteLength} bytes, too short to hold a header. Truncated download?`,
    );
  }

  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== DEEPSKY_MAGIC) {
    throw new DeepSkyFormatError(
      `Bad magic "${magic}" (expected "${DEEPSKY_MAGIC}"). Not a deep-sky catalogue.`,
    );
  }

  const view = new DataView(buffer);
  const version = view.getUint32(8, true);
  if (version !== DEEPSKY_VERSION) {
    throw new DeepSkyFormatError(
      `Format version ${version}, expected ${DEEPSKY_VERSION}. Rebuild with ` +
        `scripts/build-catalog.mjs rather than reading it with the wrong layout.`,
    );
  }

  const count = view.getUint32(12, true);
  const expected = HEADER_BYTES + count * BYTES_PER_OBJECT;
  if (buffer.byteLength !== expected) {
    throw new DeepSkyFormatError(
      `Header declares ${count} objects (${expected} bytes) but the buffer is ` +
        `${buffer.byteLength} bytes. Truncated or corrupt.`,
    );
  }

  const directions = new Float32Array(count * 3);
  const distancesMpc = new Float32Array(count);
  const magnitudes = new Float32Array(count);
  const majorAxes = new Float32Array(count);
  const types = new Uint8Array(count);
  const distanceMethods = new Uint8Array(count);

  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    directions[i * 3] = view.getFloat32(offset, true);
    directions[i * 3 + 1] = view.getFloat32(offset + 4, true);
    directions[i * 3 + 2] = view.getFloat32(offset + 8, true);
    distancesMpc[i] = view.getFloat32(offset + 12, true);
    magnitudes[i] = view.getFloat32(offset + 16, true);
    majorAxes[i] = view.getFloat32(offset + 20, true);
    types[i] = view.getUint8(offset + 24);
    distanceMethods[i] = view.getUint8(offset + 25);
    offset += BYTES_PER_OBJECT;
  }

  return { count, directions, distancesMpc, magnitudes, majorAxes, types, distanceMethods };
}

export function distanceMethodOf(catalog: DeepSkyCatalog, index: number): DistanceMethod {
  return METHODS[catalog.distanceMethods[index]!] ?? "unknown";
}

export function typeOf(catalog: DeepSkyCatalog, index: number): DeepSkyType {
  return catalog.types[index] as DeepSkyType;
}

export function hasMagnitude(catalog: DeepSkyCatalog, index: number): boolean {
  return catalog.magnitudes[index]! < UNKNOWN_MAGNITUDE;
}

export function hasDistance(catalog: DeepSkyCatalog, index: number): boolean {
  return catalog.distancesMpc[index]! > 0;
}

export const DEEPSKY_FILES = {
  catalog: "deepsky.bin",
  names: "deepsky-names.json",
} as const;

export async function loadDeepSky(url: string): Promise<DeepSkyCatalog> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new DeepSkyFormatError(`Failed to load deep-sky catalogue from ${url}: ${response.status}`);
  }
  return parseDeepSky(await response.arrayBuffer());
}

export async function loadNames(url: string): Promise<NamedObject[]> {
  const response = await fetch(url);
  if (!response.ok) return [];
  return (await response.json()) as NamedObject[];
}
