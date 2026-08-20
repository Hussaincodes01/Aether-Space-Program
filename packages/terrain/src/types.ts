/**
 * Terrain operators and their admissibility gates.
 *
 * The critical design point, from the PRD: **accuracy comes from the gates, uniqueness
 * comes from operator combinatorics, coherence comes from the composer.** An operator may
 * only run when physics permits it, and every gate cites the formula that decided.
 *
 * This is also why generic fBm is not the geology model. Noise is the last detail layer;
 * large-scale structure comes from named processes that are switched on by evidence. A
 * generator with four scalar knobs produces the same world every time, however good the
 * noise is.
 */

/** The physical facts a gate is allowed to read. Derived entirely from ScienceSpec/InferenceSpec. */
export interface PlanetContext {
  /** Equilibrium or retrieved surface temperature, K. */
  surfaceTemperatureK: number;
  /** Surface pressure in pascals; 0 for an airless body. */
  surfacePressurePa: number;
  /** Jeans escape parameter for the dominant heavy species. */
  jeansParameter: number;
  surfaceGravityMs2: number;
  bulkDensityKgM3: number;
  radiusM: number;
  /** Tidal heating flux, W/m². */
  tidalHeatingWm2: number;
  /** Radiogenic heating flux, W/m². Depends on mass and system age. */
  radiogenicHeatingWm2: number;
  /** System age in seconds; null when unconstrained. */
  systemAgeS: number | null;
  /** Whether a liquid is thermodynamically stable at the surface, and which. */
  stableLiquid: "water" | "methane" | "co2" | "none";
  /** Whether the dominant volatile has a stable solid phase somewhere on the surface. */
  hasStableIce: boolean;
  /** True when the body is tidally locked, so there is a permanent cold trap. */
  tidallyLocked: boolean;
  /** Fraction of the surface plausibly covered by liquid, 0..1. */
  hydrosphereFraction: number;
}

/**
 * Whether a body has a solid surface is a question about a retained envelope, not density.
 *
 * A bare density threshold of 1500 kg/m3 was used here, and it is wrong in the direction that
 * matters: water ice is 917 kg/m3, so it excluded five genuinely solid bodies from having any
 * terrain generated at all -- Mimas at 1150, Iapetus 1088, Miranda 1200, Rhea 1236 and Deimos
 * 1479. Mimas's Herschel crater spans a third of its diameter and Iapetus has an equatorial
 * ridge 13 km high; these are not featureless.
 *
 * The bodies that genuinely have nowhere to stand are the ones massive enough to have held on
 * to hydrogen and helium, and that takes both size and low density. Jupiter is 1240 kg/m3 at
 * 11.2 Earth radii; Mimas is 1150 at 0.03. Density alone cannot separate them, radius can.
 *
 * Below the floor there is no condensed matter at all. Water ice sits at 917 and even a
 * porous rubble pile is above 500, so nothing real is excluded by it.
 */
export const MIN_CONDENSED_DENSITY_KG_M3 = 500;

/** Above this radius, with a low density, a body has kept a hydrogen/helium envelope. */
export const ENVELOPE_RADII_EARTH = 2;
export const ENVELOPE_MAX_DENSITY_KG_M3 = 2500;

const EARTH_RADIUS_M = 6.3781e6;

/** Why an operator may or may not run. Rendered verbatim in the provenance inspector. */
export interface Admissibility {
  admissible: boolean;
  /** Formula id that decided. Must resolve in the physics registry. */
  gatedBy: string;
  /** Plain-language explanation, shown to the user. */
  reason: string;
  /**
   * Intensity range the physics permits, 0..1. The composer picks a value inside this and
   * the validator clamps to it regardless of what was proposed.
   */
  intensityRange: [number, number];
  /** Confidence in the gate decision itself, 0..1. */
  confidence: number;
}

export interface ParameterSpec {
  /** Inclusive bounds. Proposals outside are clamped, and the clamp is logged. */
  min: number;
  max: number;
  /** Typical value, at gate intensity 0.5. */
  default: number;
  description: string;
  /**
   * Whether the deterministic fallback modulates this parameter by the gate's intensity.
   *
   * True for anything representing how strongly a process operated — relief, coverage,
   * incision depth. False for structural constants like noise octave count, where a
   * physics-driven value would be meaningless.
   *
   * This matters more than it looks. If every parameter falls back to a constant, two
   * worlds with the same admissible operators compile to the *same planet*, and the AI
   * composer becomes load-bearing for basic variety — which would break the requirement
   * that the full experience works with AI generation disabled.
   */
  scalesWithIntensity?: boolean;
}

/**
 * Everything an operator needs to compute its height contribution at one point.
 *
 * Operators run in layer order and each sees `heightSoFarM`, so erosional processes can
 * cut into what construction laid down — which is how the real sequence works, and why
 * simply summing independent noise fields never looks like geology.
 */
export interface EvalContext {
  /** Unit direction on the sphere, in planet-fixed coordinates. */
  dir: Readonly<{ x: number; y: number; z: number }>;
  /** Resolved and clamped parameters for this operator. */
  params: Readonly<Record<string, number>>;
  /** Per-operator seed, derived from the world seed and the operator id. */
  seed: number;
  /** Planet radius in metres, for turning a feature size in km into an angular frequency. */
  radiusM: number;
  /** Latitude, -pi/2 to pi/2. */
  latitude: number;
  /**
   * Angle from the substellar point, 0 to pi.
   *
   * On a tidally locked world this replaces latitude as the axis along which climate
   * varies: the cold trap is at the antistellar point, not at the poles.
   */
  substellarAngle: number;
  /** True when the climate axis is substellar angle rather than latitude. */
  tidallyLocked: boolean;
  /** Height accumulated by earlier operators, in metres. */
  heightSoFarM: number;
}

/**
 * The largest relief a body can physically carry, in metres.
 *
 * Two bounds, whichever is tighter.
 *
 * **Strength.** Topography is held up against its own weight, so the ceiling scales as
 * 1/(rho*g), normalised to Earth's 8850 m. That alone is what the generator used, and it
 * diverges as gravity falls: on Phobos it evaluates to 3,057 km.
 *
 * **Size.** A body cannot carry relief approaching its own radius and still be that body.
 * This is the bound that was missing, and its absence was visible: the generator gave
 * Phobos 15.9 km of relief on an 11.3 km radius -- 141% -- so at true scale the
 * displacement pushed vertices through the centre and the moon rendered inside out.
 *
 * Five percent is generous against the real Solar System (Earth spans 0.31% of its radius,
 * Mars 0.87%, the Moon 1.1%) and only binds on small bodies, which is exactly where the
 * strength limit has stopped saying anything. It also puts this in agreement with the
 * harness, which reaches 562 m for Phobos where this reaches 564 m.
 */
export function maxReliefM(context: PlanetContext): number {
  const strengthLimitM =
    8850 *
    (EARTH_SURFACE_GRAVITY / Math.max(context.surfaceGravityMs2, 0.05)) *
    Math.sqrt(EARTH_BULK_DENSITY / Math.max(context.bulkDensityKgM3, 1000));

  return Math.min(strengthLimitM, RELIEF_RADIUS_FRACTION * context.radiusM);
}

const EARTH_SURFACE_GRAVITY = 9.80665;
const EARTH_BULK_DENSITY = 5514;

/** Relief may not exceed this fraction of a body's radius. See `maxReliefM`. */
export const RELIEF_RADIUS_FRACTION = 0.05;

export function hasSolidSurface(context: PlanetContext): boolean {
  if (context.bulkDensityKgM3 < MIN_CONDENSED_DENSITY_KG_M3) return false;

  // Big and light: the mass is in a fluid envelope and there is nothing to shape.
  const radiiEarth = context.radiusM / EARTH_RADIUS_M;
  if (
    radiiEarth > ENVELOPE_RADII_EARTH &&
    context.bulkDensityKgM3 < ENVELOPE_MAX_DENSITY_KG_M3
  ) {
    return false;
  }
  return true;
}

/** The rejection every surface operator returns on an envelope-dominated body. */
export function noSolidSurface(context: PlanetContext): Admissibility {
  return {
    admissible: false,
    gatedBy: "bulk_density",
    reason:
      `Bulk density ${(context.bulkDensityKgM3 / 1000).toFixed(2)} g/cm3 implies a volatile ` +
      `envelope with no solid surface for this process to act on.`,
    intensityRange: [0, 0],
    confidence: 0.9,
  };
}

export interface TerrainOperator {
  id: string;
  name: string;
  /** What geological process this represents. */
  description: string;
  references: readonly string[];
  /**
   * Layer order hint. Lower values run earlier, so a later operator can carve into an
   * earlier one's output. Isostasy shapes the datum; microdetail comes last.
   */
  layerOrder: number;
  parameters: Readonly<Record<string, ParameterSpec>>;
  /** Decide whether this process could operate on this world, and how strongly. */
  gate(context: PlanetContext): Admissibility;
  /**
   * Height contribution at a point, in metres, to be **added** to what came before.
   *
   * Constructional processes return positive values, erosional ones negative. Omit it and
   * the operator contributes nothing to geometry — legitimate for a purely cosmetic layer,
   * but for anything else it means the process is declared and not implemented.
   */
  evaluate?: (context: EvalContext) => number;
}

/** An operator that passed its gate, with parameters resolved and clamped. */
export interface CompiledOperator {
  op: string;
  params: Record<string, number>;
  gatedBy: string;
  reason: string;
  confidence: number;
}

/**
 * Something the compiler had to correct, kept rather than discarded.
 *
 * A discriminated union because the four cases mean genuinely different things and a caller
 * that treats them alike will mislead somebody. A clamp says a proposal overreached and was
 * pulled back to the physically admissible range. An unknown operator says a model invented
 * a geological process that does not exist. Those deserve different words in the inspector
 * and, in strict mode, different outcomes.
 */
export type CompileWarning =
  /** A proposed parameter fell outside the operator's admissible range and was clamped. */
  | {
      kind: "clamped";
      op: string;
      parameter: string;
      requested: number;
      clamped: number;
      bound: "min" | "max";
    }
  /** The proposal named an operator that is not in the registry. */
  | { kind: "unknown_operator"; op: string; message: string }
  /** The proposal set a parameter the named operator does not define. */
  | { kind: "unknown_parameter"; op: string; parameter: string; message: string }
  /**
   * The proposal targeted a real operator that this world's physics rules out.
   *
   * Not an error: a composer proposing dunes for a planet that turns out to be airless is
   * behaving reasonably, and the gate is what makes the proposal harmless. Worth recording
   * because a composer that does it constantly is being given bad context.
   */
  | { kind: "proposal_for_inadmissible_operator"; op: string; message: string };

export interface CompiledTerrainProgram {
  version: string;
  seed: string;
  operators: CompiledOperator[];
  /** Operators that were rejected, kept so the inspector can explain the absences too. */
  rejected: Array<{ op: string; reason: string; gatedBy: string }>;
  warnings: CompileWarning[];
}

export const TERRAIN_VERSION = "terrain-physics-0.1.0" as const;
