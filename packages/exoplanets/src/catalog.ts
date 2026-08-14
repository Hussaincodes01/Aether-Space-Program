/**
 * Exoplanet catalogue binary format.
 *
 * Two buffers plus a name sidecar. Systems are ordered by distance, and each system's
 * planets are contiguous, so a system reads as a single range rather than a scatter-gather
 * through six thousand records.
 *
 *   systems.bin
 *     offset  0   char[8]  "AETHSYST"
 *     offset  8   uint32   version
 *     offset 12   uint32   count
 *     offset 16   record[] { f32 x, y, z, distancePc, teff, radiusSun, massSun,
 *                            logLuminosity, u32 firstPlanet, u8 planetCount, u8, u16 }
 *
 *   planets.bin
 *     offset 16   record[] { f32 radiusEarth, massEarth, periodDays, semiMajorAu,
 *                            eccentricity, inclinationDeg, eqTempK, densityGcc,
 *                            u8 method, u16 discYear, u8, u32 }
 *
 * Positions are equatorial J2000 cartesian in parsecs — the same frame as the star and
 * deep-sky catalogues, so all three layers register with no conversion.
 *
 * **Unmeasured values are NaN, not zero.** Zero is a legitimate eccentricity and a plausible
 * temperature; NaN is not a legitimate anything. That is what lets `null` survive from the
 * archive all the way to the UI instead of quietly becoming a number somebody might believe.
 */

import { PARSEC } from "@aether/units";

export const SYSTEM_MAGIC = "AETHSYST";
export const PLANET_MAGIC = "AETHPLAN";
export const CATALOG_VERSION = 1;
export const BYTES_PER_SYSTEM = 40;
export const BYTES_PER_PLANET = 40;
const HEADER_BYTES = 16;

export interface SystemCatalog {
  count: number;
  /** Equatorial J2000 cartesian, parsecs. Three per system. */
  positionsPc: Float32Array;
  distancesPc: Float32Array;
  /** NaN where unmeasured. */
  effectiveTemperatures: Float32Array;
  stellarRadiiSun: Float32Array;
  stellarMassesSun: Float32Array;
  /** log10(L / L_sun), NOT the ratio. */
  logLuminosities: Float32Array;
  firstPlanet: Uint32Array;
  planetCount: Uint8Array;
}

export interface PlanetCatalog {
  count: number;
  radiiEarth: Float32Array;
  massesEarth: Float32Array;
  periodsDays: Float32Array;
  semiMajorAxesAu: Float32Array;
  eccentricities: Float32Array;
  inclinationsDeg: Float32Array;
  equilibriumTemperatures: Float32Array;
  densitiesGcc: Float32Array;
  discoveryMethods: Uint8Array;
  discoveryYears: Uint16Array;
}

export interface CatalogNames {
  methods: string[];
  systems: string[];
  planets: string[];
  facilities: string[];
}

export class ExoplanetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExoplanetFormatError";
  }
}

function checkHeader(buffer: ArrayBuffer, magic: string): { view: DataView; count: number } {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new ExoplanetFormatError(
      `Buffer is ${buffer.byteLength} bytes, too short for a header. Truncated download?`,
    );
  }
  const found = String.fromCharCode(...new Uint8Array(buffer).subarray(0, 8));
  if (found !== magic) {
    throw new ExoplanetFormatError(`Bad magic "${found}" (expected "${magic}").`);
  }
  const view = new DataView(buffer);
  const version = view.getUint32(8, true);
  if (version !== CATALOG_VERSION) {
    throw new ExoplanetFormatError(
      `Format version ${version}, expected ${CATALOG_VERSION}. Rebuild the catalogue.`,
    );
  }
  return { view, count: view.getUint32(12, true) };
}

export function parseSystems(buffer: ArrayBuffer): SystemCatalog {
  const { view, count } = checkHeader(buffer, SYSTEM_MAGIC);
  const expected = HEADER_BYTES + count * BYTES_PER_SYSTEM;
  if (buffer.byteLength !== expected) {
    throw new ExoplanetFormatError(
      `Header declares ${count} systems (${expected} bytes), buffer is ${buffer.byteLength}.`,
    );
  }

  const positionsPc = new Float32Array(count * 3);
  const distancesPc = new Float32Array(count);
  const effectiveTemperatures = new Float32Array(count);
  const stellarRadiiSun = new Float32Array(count);
  const stellarMassesSun = new Float32Array(count);
  const logLuminosities = new Float32Array(count);
  const firstPlanet = new Uint32Array(count);
  const planetCount = new Uint8Array(count);

  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    positionsPc[i * 3] = view.getFloat32(o, true);
    positionsPc[i * 3 + 1] = view.getFloat32(o + 4, true);
    positionsPc[i * 3 + 2] = view.getFloat32(o + 8, true);
    distancesPc[i] = view.getFloat32(o + 12, true);
    effectiveTemperatures[i] = view.getFloat32(o + 16, true);
    stellarRadiiSun[i] = view.getFloat32(o + 20, true);
    stellarMassesSun[i] = view.getFloat32(o + 24, true);
    logLuminosities[i] = view.getFloat32(o + 28, true);
    firstPlanet[i] = view.getUint32(o + 32, true);
    planetCount[i] = view.getUint8(o + 36);
    o += BYTES_PER_SYSTEM;
  }

  return {
    count,
    positionsPc,
    distancesPc,
    effectiveTemperatures,
    stellarRadiiSun,
    stellarMassesSun,
    logLuminosities,
    firstPlanet,
    planetCount,
  };
}

export function parsePlanets(buffer: ArrayBuffer): PlanetCatalog {
  const { view, count } = checkHeader(buffer, PLANET_MAGIC);
  const expected = HEADER_BYTES + count * BYTES_PER_PLANET;
  if (buffer.byteLength !== expected) {
    throw new ExoplanetFormatError(
      `Header declares ${count} planets (${expected} bytes), buffer is ${buffer.byteLength}.`,
    );
  }

  const radiiEarth = new Float32Array(count);
  const massesEarth = new Float32Array(count);
  const periodsDays = new Float32Array(count);
  const semiMajorAxesAu = new Float32Array(count);
  const eccentricities = new Float32Array(count);
  const inclinationsDeg = new Float32Array(count);
  const equilibriumTemperatures = new Float32Array(count);
  const densitiesGcc = new Float32Array(count);
  const discoveryMethods = new Uint8Array(count);
  const discoveryYears = new Uint16Array(count);

  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    radiiEarth[i] = view.getFloat32(o, true);
    massesEarth[i] = view.getFloat32(o + 4, true);
    periodsDays[i] = view.getFloat32(o + 8, true);
    semiMajorAxesAu[i] = view.getFloat32(o + 12, true);
    eccentricities[i] = view.getFloat32(o + 16, true);
    inclinationsDeg[i] = view.getFloat32(o + 20, true);
    equilibriumTemperatures[i] = view.getFloat32(o + 24, true);
    densitiesGcc[i] = view.getFloat32(o + 28, true);
    discoveryMethods[i] = view.getUint8(o + 32);
    discoveryYears[i] = view.getUint16(o + 33, true);
    o += BYTES_PER_PLANET;
  }

  return {
    count,
    radiiEarth,
    massesEarth,
    periodsDays,
    semiMajorAxesAu,
    eccentricities,
    inclinationsDeg,
    equilibriumTemperatures,
    densitiesGcc,
    discoveryMethods,
    discoveryYears,
  };
}

/** Position in metres, for the f64 frame tree. */
export function systemPositionMetres(
  systems: SystemCatalog,
  index: number,
): { x: number; y: number; z: number } {
  const i = index * 3;
  return {
    x: systems.positionsPc[i]! * PARSEC,
    y: systems.positionsPc[i + 1]! * PARSEC,
    z: systems.positionsPc[i + 2]! * PARSEC,
  };
}

/** Planet indices belonging to a system. They are contiguous by construction. */
export function planetsOfSystem(systems: SystemCatalog, index: number): number[] {
  const first = systems.firstPlanet[index]!;
  const n = systems.planetCount[index]!;
  return Array.from({ length: n }, (_, k) => first + k);
}

export const EXOPLANET_FILES = {
  systems: "systems.bin",
  planets: "planets.bin",
  names: "names.json",
} as const;

export async function loadSystems(url: string): Promise<SystemCatalog> {
  const response = await fetch(url);
  if (!response.ok) throw new ExoplanetFormatError(`Failed to load ${url}: ${response.status}`);
  return parseSystems(await response.arrayBuffer());
}

export async function loadPlanets(url: string): Promise<PlanetCatalog> {
  const response = await fetch(url);
  if (!response.ok) throw new ExoplanetFormatError(`Failed to load ${url}: ${response.status}`);
  return parsePlanets(await response.arrayBuffer());
}

export async function loadNames(url: string): Promise<CatalogNames> {
  const response = await fetch(url);
  if (!response.ok) throw new ExoplanetFormatError(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as CatalogNames;
}
