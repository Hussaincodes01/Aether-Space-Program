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
}

/** An operator that passed its gate, with parameters resolved and clamped. */
export interface CompiledOperator {
  op: string;
  params: Record<string, number>;
  gatedBy: string;
  reason: string;
  confidence: number;
}

export interface CompileWarning {
  op: string;
  parameter: string;
  requested: number;
  clamped: number;
  bound: "min" | "max";
}

export interface CompiledTerrainProgram {
  version: string;
  seed: string;
  operators: CompiledOperator[];
  /** Operators that were rejected, kept so the inspector can explain the absences too. */
  rejected: Array<{ op: string; reason: string; gatedBy: string }>;
  warnings: CompileWarning[];
}

export const TERRAIN_VERSION = "terrain-physics-0.1.0" as const;
