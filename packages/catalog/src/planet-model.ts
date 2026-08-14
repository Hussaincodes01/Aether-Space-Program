/**
 * The end-to-end planet model.
 *
 * catalog seed -> SI + provenance -> mission evidence gate -> physics derivations ->
 * inference for what remains -> terrain program -> visual parameters
 *
 * Everything the renderer needs comes out of here, and every number in it can name where it
 * came from. Nothing downstream is allowed to invent a quantity; if a value is absent from
 * this model, the correct rendering is an explicit unknown marker.
 *
 * ## What mission selection is allowed to do
 *
 * Selecting missions **withholds** measurements. It never creates them.
 *
 * That asymmetry is the whole integrity of the mechanic. Deselecting Gaia is a claim about
 * what we would know without Gaia, and hiding a measurement we do in fact have is a fair
 * simulation of that counterfactual. Selecting JWST for a planet JWST has never looked at
 * would be the opposite: manufacturing evidence. So a mission can only reveal a value that
 * is genuinely in the catalog, and `observedBy` bounds which missions could plausibly have
 * contributed at all.
 *
 * A withheld measurement does not vanish. It drops to the inference layer, where the
 * mass-radius prior or a population prior answers instead, carrying its full uncertainty
 * and its own label. That is why the envelope widens rather than the planet disappearing.
 */

import {
  DEFAULT_BOND_ALBEDO,
  FULL_REDISTRIBUTION,
  MOLECULAR_WEIGHT,
  bulkDensity,
  equilibriumTemperature,
  escapeVelocity,
  insolation,
  scaleHeight,
  surfaceGravity,
  type DerivedValue,
} from "@aether/physics";
import { STEFAN_BOLTZMANN } from "@aether/units";
import {
  compileTerrainProgram,
  type CompiledTerrainProgram,
  type PlanetContext,
} from "@aether/terrain";
import { envelopeWidth, isConstrained, type EvidenceProfile } from "@aether/missions";
import type { Distribution, ScientificQuantity } from "@aether/schema";
import { getPlanet, getSystem } from "./catalog.js";
import { toScientificQuantity } from "./convert.js";
import { UnresolvedRequiredFieldError } from "./errors.js";
import { massRadiusPrior } from "./priors.js";
import { planetSeedString, stableSeed } from "./seed.js";
import type { PlanetSeed, StarSeed, SystemSeed } from "./schema.js";

/**
 * Which mission-model parameter gates which catalog field.
 *
 * Written out rather than inferred from names, because the mapping is a scientific claim:
 * a transit gives you a radius *ratio*, and turning that into a radius in metres needs a
 * stellar radius, which needs a distance. Getting this table wrong would let a planet look
 * better measured than the selected missions could possibly make it.
 */
const FIELD_GATES = {
  planetRadius: "planet_radius_ratio",
  planetMass: "planet_mass",
  orbitalPeriod: "orbital_period",
  semiMajorAxis: "orbital_period",
  eccentricity: "eccentricity",
  stellarRadius: "stellar_radius",
  stellarMass: "stellar_mass",
  stellarTemperature: "stellar_effective_temperature",
  stellarDistance: "stellar_distance",
  bondAlbedo: "bond_albedo",
} as const;

export type GatedField = keyof typeof FIELD_GATES;

export interface DerivedEntry {
  quantity: ScientificQuantity;
  derivation: DerivedValue;
}

export interface PlanetModel {
  systemId: string;
  planetId: string;
  name: string;
  systemName: string;

  /** Deterministic; a function of the identity, the data and the evidence profile. */
  seed: string;

  /**
   * Layer 1. Measurements that the selected missions can actually see.
   *
   * A field withheld by the evidence gate is absent here, not zeroed.
   */
  science: Readonly<Record<string, ScientificQuantity>>;

  /** Layer 1, second half: values Aether derived, each naming its formula. */
  derived: Readonly<Record<string, DerivedEntry>>;

  /** Layer 2. Distributions standing in for what the missions cannot constrain. */
  inference: Readonly<Record<string, Distribution>>;

  /** Fields the catalog records as genuinely unmeasured by anyone, with the reason. */
  unknown: Readonly<Record<string, string>>;

  /** Fields a mission selection is hiding that the catalog does in fact contain. */
  withheld: readonly string[];

  /** Layer 3 input. Terrain is a hypothesis and is labelled as one everywhere it appears. */
  terrain: CompiledTerrainProgram | null;
  /** Null terrain has a reason: no solid surface, or no radius to build on. */
  terrainAbsentReason: string | null;

  /** 0..1. How much of this world is inference rather than measurement. */
  speculation: number;

  evidence: EvidenceProfile;
}

/** Read an SI value out of the science layer, or undefined when absent or unknown. */
function value(science: Record<string, ScientificQuantity>, field: string): number | undefined {
  const q = science[field];
  return q && q.valueSI !== null ? q.valueSI : undefined;
}

function confidence(science: Record<string, ScientificQuantity>, field: string): number {
  return science[field]?.confidence ?? 0;
}

/**
 * Stellar luminosity from radius and effective temperature.
 *
 * Preferred over a published luminosity when both exist, because it keeps the model
 * internally consistent: a luminosity from one paper and a radius from another can disagree
 * by more than either uncertainty, and an insolation computed from mismatched inputs is
 * wrong in a way no error bar reports.
 */
function luminosityFrom(radiusM: number, teffK: number): number {
  return 4 * Math.PI * radiusM * radiusM * STEFAN_BOLTZMANN * teffK ** 4;
}

export interface BuildOptions {
  /**
   * Composer proposals for the terrain program.
   *
   * Validated inside `compileTerrainProgram`, which cannot be bypassed, so an invented
   * operator here is recorded rather than obeyed.
   */
  terrainProposal?: Record<string, Record<string, number>>;
}

export function buildPlanetModel(
  systemId: string,
  planetId: string,
  evidence: EvidenceProfile,
  options: BuildOptions = {},
): PlanetModel {
  const system = getSystem(systemId);
  const planet = getPlanet(systemId, planetId);

  const science: Record<string, ScientificQuantity> = {};
  const inference: Record<string, Distribution> = {};
  const unknown: Record<string, string> = {};
  const withheld: string[] = [];

  ingest(system, planet, evidence, science, unknown, withheld);

  const derived = derivePhysics(science);
  fillInference(planet, science, derived, inference, unknown);

  const seed = stableSeed(planetSeedString(systemId, planetId, evidence));
  const { terrain, terrainAbsentReason } = buildTerrain(
    science,
    derived,
    inference,
    seed,
    options,
  );

  return {
    systemId,
    planetId,
    name: planet.name,
    systemName: system.name,
    seed,
    science,
    derived,
    inference,
    unknown,
    withheld,
    terrain,
    terrainAbsentReason,
    speculation: speculationOf(evidence, science, inference),
    evidence,
  };
}

// -- Stage 1: ingestion, through the evidence gate -----------------------------------------

function ingest(
  system: SystemSeed,
  planet: PlanetSeed,
  evidence: EvidenceProfile,
  science: Record<string, ScientificQuantity>,
  unknown: Record<string, string>,
  withheld: string[],
): void {
  const star: StarSeed = system.star;

  const fields: Array<[GatedField, string, (typeof planet)["radius"] | undefined]> = [
    ["planetRadius", "planet_radius", planet.radius],
    ["planetMass", "planet_mass", planet.mass],
    ["orbitalPeriod", "orbital_period", planet.orbitalPeriod],
    ["semiMajorAxis", "semi_major_axis", planet.semiMajorAxis],
    ["eccentricity", "eccentricity", planet.eccentricity],
    ["bondAlbedo", "bond_albedo", planet.bondAlbedo],
    ["stellarRadius", "stellar_radius", star.radius],
    ["stellarMass", "stellar_mass", star.mass],
    ["stellarTemperature", "stellar_effective_temperature", star.effectiveTemperature],
    ["stellarDistance", "stellar_distance", star.distance],
  ];

  for (const [gate, field, catalogValue] of fields) {
    if (catalogValue === undefined) {
      unknown[field] = "Not present in the catalog entry.";
      continue;
    }

    if (catalogValue.value === null) {
      // Measured to be unknown. This is a fact about the world, not about the selection,
      // so it is recorded whatever missions are chosen.
      unknown[field] = catalogValue.note ?? "No published measurement.";
      continue;
    }

    if (!isConstrained(evidence, FIELD_GATES[gate])) {
      // The value exists; the selected missions could not have obtained it. Withheld, not
      // deleted — the inference layer will answer instead, with its uncertainty visible.
      withheld.push(field);
      continue;
    }

    science[field] = toScientificQuantity(catalogValue);
  }
}

// -- Stage 2: deterministic derivations ----------------------------------------------------

/**
 * Run every formula whose inputs are available.
 *
 * A formula whose inputs are missing is skipped silently — that is the normal case, not an
 * error. A formula whose inputs are present but outside its stated domain is also skipped,
 * and that *is* worth knowing about, so the domain check runs before `compute`.
 */
function derivePhysics(
  science: Record<string, ScientificQuantity>,
): Record<string, DerivedEntry> {
  const out: Record<string, DerivedEntry> = {};

  const record = (field: string, d: DerivedValue): void => {
    out[field] = {
      derivation: d,
      quantity: {
        valueSI: d.value,
        unit: d.unit,
        uncertainty: d.uncertainty,
        method: "derived",
        sourceId: `formula:${d.formulaId}`,
        retrievedAt: new Date(0).toISOString(),
        confidence: d.confidence,
      },
    };
  };

  const radiusM = value(science, "planet_radius");
  const massKg = value(science, "planet_mass");

  if (radiusM !== undefined && massKg !== undefined) {
    const inputs = {
      massKg,
      radiusM,
      massUncertainty: science.planet_mass?.uncertainty,
      radiusUncertainty: science.planet_radius?.uncertainty,
      massConfidence: confidence(science, "planet_mass"),
      radiusConfidence: confidence(science, "planet_radius"),
    };

    for (const formula of [bulkDensity, surfaceGravity, escapeVelocity]) {
      if (formula.domain?.(inputs)) continue;
      record(formula.id, formula.compute(inputs));
    }
  }

  const stellarRadiusM = value(science, "stellar_radius");
  const teffK = value(science, "stellar_effective_temperature");
  const axisM = value(science, "semi_major_axis");

  if (stellarRadiusM !== undefined && teffK !== undefined && axisM !== undefined) {
    const luminosityW = luminosityFrom(stellarRadiusM, teffK);
    const inputs = {
      luminosityW,
      semimajorAxisM: axisM,
      luminosityConfidence: Math.min(
        confidence(science, "stellar_radius"),
        confidence(science, "stellar_effective_temperature"),
      ),
      axisConfidence: confidence(science, "semi_major_axis"),
    };

    if (!insolation.domain?.(inputs)) {
      record("insolation", insolation.compute(inputs));

      // Bond albedo is measured for almost nothing, so equilibrium temperature is an
      // assumption-bearing derivation. The formula records the assumption itself, and
      // `derived()` caps the confidence because of it.
      const albedo = value(science, "bond_albedo");
      const eqInputs = {
        starEffectiveTemperatureK: teffK,
        starRadiusM: stellarRadiusM,
        semimajorAxisM: axisM,
        bondAlbedo: albedo ?? DEFAULT_BOND_ALBEDO,
        bondAlbedoIsMeasured: albedo !== undefined,
        redistributionFactor: FULL_REDISTRIBUTION,
        starTempUncertainty: science.stellar_effective_temperature?.uncertainty,
        starRadiusUncertainty: science.stellar_radius?.uncertainty,
        axisUncertainty: science.semi_major_axis?.uncertainty,
        starTempConfidence: confidence(science, "stellar_effective_temperature"),
        starRadiusConfidence: confidence(science, "stellar_radius"),
        axisConfidence: confidence(science, "semi_major_axis"),
      };
      if (!equilibriumTemperature.domain?.(eqInputs)) {
        record("equilibrium_temperature", equilibriumTemperature.compute(eqInputs));
      }
    }
  }

  // Scale height needs gravity and a temperature, both of which may themselves be derived.
  const gravity = out.surface_gravity?.derivation.value;
  const temperature = out.equilibrium_temperature?.derivation.value;

  if (gravity !== undefined && temperature !== undefined) {
    const inputs = {
      temperatureK: temperature,
      // No exoplanet atmospheric composition here is retrieved, so this is an assumption
      // and is flagged as one. N2 is the least-committal choice for a terrestrial world:
      // it neither inflates the atmosphere like H2 nor compresses it like CO2.
      meanMolecularWeightAmu: MOLECULAR_WEIGHT.N2,
      surfaceGravityMs2: gravity,
      temperatureConfidence: out.equilibrium_temperature!.derivation.confidence,
      gravityConfidence: out.surface_gravity!.derivation.confidence,
      compositionIsRetrieved: false,
    };
    if (!scaleHeight.domain?.(inputs)) {
      record("scale_height", scaleHeight.compute(inputs));
    }
  }

  return out;
}

// -- Stage 3: inference for what remains ---------------------------------------------------

/**
 * Fill gaps with distributions, never with scalars.
 *
 * Only one prior is implemented so far — mass to radius — and it is the one that matters,
 * because it is what lets a radial-velocity planet like Proxima b be drawn at all. It is
 * labelled `prior`, carries quantiles rather than a point estimate, and flags itself
 * out-of-distribution outside the mass range the relation was fitted over.
 */
function fillInference(
  planet: PlanetSeed,
  science: Record<string, ScientificQuantity>,
  derived: Record<string, DerivedEntry>,
  inference: Record<string, Distribution>,
  unknown: Record<string, string>,
): void {
  const massKg = value(science, "planet_mass");
  const hasRadius = value(science, "planet_radius") !== undefined;

  if (!hasRadius && massKg !== undefined) {
    inference.planet_radius = massRadiusPrior(massKg);
    delete unknown.planet_radius;
  }

  // A planet with neither a radius nor a mass cannot be given one honestly. It stays
  // unknown, and the renderer is expected to show an explicit marker rather than a sphere.
  if (!hasRadius && massKg === undefined && !inference.planet_radius) {
    unknown.planet_radius =
      unknown.planet_radius ??
      "No radius measurement, and no mass from which to infer one under the mass-radius relation.";
  }

  if (planet.surfacePressure === undefined || planet.surfacePressure.value === null) {
    unknown.surface_pressure =
      "No surface pressure has been measured for any exoplanet. Atmospheric thickness here is a hypothesis.";
  }

  if (!derived.equilibrium_temperature) {
    unknown.equilibrium_temperature =
      "Needs a stellar radius, effective temperature and orbital distance; at least one is unavailable under this evidence profile.";
  }
}

// -- Stage 4: terrain ----------------------------------------------------------------------

function buildTerrain(
  science: Record<string, ScientificQuantity>,
  derived: Record<string, DerivedEntry>,
  inference: Record<string, Distribution>,
  seed: string,
  options: BuildOptions,
): { terrain: CompiledTerrainProgram | null; terrainAbsentReason: string | null } {
  const radiusM = value(science, "planet_radius") ?? inference.planet_radius?.median;
  const density = derived.bulk_density?.derivation.value;
  const gravity = derived.surface_gravity?.derivation.value;
  const temperature = derived.equilibrium_temperature?.derivation.value;

  if (radiusM === undefined) {
    return {
      terrain: null,
      terrainAbsentReason:
        "No radius is available from measurement or inference, so there is no surface to generate.",
    };
  }
  if (density === undefined || gravity === undefined || temperature === undefined) {
    return {
      terrain: null,
      terrainAbsentReason:
        "Terrain generation needs a bulk density, surface gravity and equilibrium temperature. " +
        "Under this evidence profile at least one cannot be derived, so no surface hypothesis is offered.",
    };
  }

  const context: PlanetContext = {
    surfaceTemperatureK: temperature,
    // No exoplanet surface pressure has ever been measured. Zero is the honest input: it
    // means the gates that require an atmosphere will refuse, which is the correct outcome
    // for a world whose atmosphere is unknown.
    surfacePressurePa: 0,
    jeansParameter: Number.NaN,
    surfaceGravityMs2: gravity,
    bulkDensityKgM3: density,
    radiusM,
    tidalHeatingWm2: 0,
    radiogenicHeatingWm2: 0.087,
    systemAgeS: 4.5e9 * 3.15576e7,
    stableLiquid: "none",
    hasStableIce: false,
    tidallyLocked: false,
    hydrosphereFraction: 0,
  };

  return {
    terrain: compileTerrainProgram({
      context,
      seed,
      proposal: options.terrainProposal,
    }),
    terrainAbsentReason: null,
  };
}

// -- Speculation ---------------------------------------------------------------------------

/**
 * How much of this world is inference rather than measurement.
 *
 * The maximum of two things, never the average: the evidence profile's envelope width, and
 * the fraction of this planet's own fields that came from inference. Averaging would let a
 * well-observed system launder a badly-constrained planet, which is the same failure the
 * missions package refuses when it takes the best quality across missions rather than the
 * sum.
 *
 * The floor is the envelope width's floor, and it is never zero. No exoplanet surface has
 * been resolved, so no exoplanet surface is ever fully certain.
 */
function speculationOf(
  evidence: EvidenceProfile,
  science: Record<string, ScientificQuantity>,
  inference: Record<string, Distribution>,
): number {
  const measured = Object.keys(science).length;
  const inferred = Object.keys(inference).length;
  const total = measured + inferred;
  const inferredFraction = total === 0 ? 1 : inferred / total;

  return Math.min(1, Math.max(envelopeWidth(evidence), inferredFraction));
}

/** A required field, or a typed error naming it. For callers that cannot proceed without one. */
export function requireValue(model: PlanetModel, field: string): number {
  const measured = model.science[field]?.valueSI;
  if (measured !== null && measured !== undefined) return measured;

  const derivedValue = model.derived[field]?.derivation.value;
  if (derivedValue !== undefined) return derivedValue;

  const inferred = model.inference[field]?.median;
  if (inferred !== undefined) return inferred;

  throw new UnresolvedRequiredFieldError(
    field,
    model.unknown[field] ?? "Not present in measurement, derivation or inference.",
  );
}
