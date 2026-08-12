/**
 * Branded numeric types.
 *
 * Every physical quantity in Aether is stored in SI base units. The brand exists so the
 * compiler rejects `gravity(massEarthUnits, radiusMetres)` — the class of bug that has
 * embarrassed more than one planetary visualisation.
 *
 * Brands are erased at runtime: a `Metres` *is* a `number`. There is no boxing cost.
 */

declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

/** Length, metres. */
export type Metres = Brand<number, "m">;
/** Mass, kilograms. */
export type Kilograms = Brand<number, "kg">;
/** Time, seconds. */
export type Seconds = Brand<number, "s">;
/** Thermodynamic temperature, kelvin. */
export type Kelvin = Brand<number, "K">;
/** Power, watts. */
export type Watts = Brand<number, "W">;
/** Acceleration, metres per second squared. */
export type MetresPerSecondSquared = Brand<number, "m/s^2">;
/** Velocity, metres per second. */
export type MetresPerSecond = Brand<number, "m/s">;
/** Mass density, kilograms per cubic metre. */
export type KgPerCubicMetre = Brand<number, "kg/m^3">;
/** Pressure, pascals. */
export type Pascals = Brand<number, "Pa">;
/** Irradiance, watts per square metre. */
export type WattsPerSquareMetre = Brand<number, "W/m^2">;
/** Plane angle, radians. */
export type Radians = Brand<number, "rad">;
/** Dimensionless ratio (albedo, eccentricity, mixing ratio, …). */
export type Dimensionless = Brand<number, "1">;

/**
 * The unit tag carried alongside every runtime value. Kept as a string so it survives
 * JSON serialisation into the EnvironmentSpec, where the compiler cannot help us.
 */
export type UnitTag =
  | "m"
  | "kg"
  | "s"
  | "K"
  | "W"
  | "m/s^2"
  | "m/s"
  | "kg/m^3"
  | "Pa"
  | "W/m^2"
  | "rad"
  | "1";

/**
 * Assert a raw number is already in the given SI unit.
 *
 * Use this only at a boundary where the unit has been verified — an ingestion adapter that
 * has just converted, or a literal constant. Reaching for it mid-calculation defeats the
 * whole point of the brands.
 */
export function si<T extends number>(value: number): T {
  return value as T;
}

/** Strip the brand. Prefer keeping quantities branded until the render or display boundary. */
export function raw(value: number): number {
  return value;
}
