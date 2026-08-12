/**
 * Exogenic operators — processes driven from outside the planet: impacts, and erosion by
 * whatever fluid the surface conditions permit.
 *
 * The erosion gates are phase-diagram questions, not stylistic ones. Titan has rivers and
 * dunes because methane is liquid at 94 K, not because it is Earth-like. Getting these
 * gates right is what stops every rocky world looking like a reskinned Mars.
 */

import { defineOperator } from "../registry.js";
import { frequencyForScale } from "../evaluate.js";
import { fbm, ridged, smoothstep, worley3 } from "../noise.js";

/**
 * One crater's radial profile, normalised so the rim sits at r = 1.
 *
 * A bowl alone reads as a dent. Real craters are recognisable because of the raised rim and
 * the ejecta blanket outside it, so the profile is a parabolic depression plus a Gaussian
 * ring plus a decaying skirt.
 */
function craterProfile(r: number): number {
  if (r > 2.2) return 0;
  const bowl = r < 1 ? -(1 - r * r) : 0;
  const rim = Math.exp(-(((r - 0.94) / 0.11) ** 2)) * 0.55;
  const ejecta = r > 1 ? Math.exp(-(((r - 1) / 0.7) ** 2)) * 0.12 : 0;
  return bowl + rim + ejecta;
}

/**
 * Minimum surface pressure for aeolian transport.
 *
 * Deliberately low: Mars sustains the solar system's most extensive dune fields at ~600 Pa,
 * and Pluto has methane dunes at ~1 Pa. A 1-bar threshold would wrongly exclude both.
 */
const MIN_AEOLIAN_PRESSURE_PA = 10;
/** Above this, aeolian transport is unambiguously vigorous. */
const STRONG_AEOLIAN_PRESSURE_PA = 10_000;

export const impactPopulation = defineOperator({
  id: "impact_population",
  name: "Impact population",
  description: "Crater population with size-frequency distribution and degradation state.",
  references: [],
  layerOrder: 10,
  parameters: {
    density: { min: 0, max: 1, default: 0.4, description: "Crater areal density, 1 = saturated." },
    degradation: {
      min: 0,
      max: 1,
      default: 0.3,
      description: "Erosional softening, 0 = fresh rims, 1 = ghost craters.",
    },
    largestCraterKm: { min: 1, max: 2_000, default: 120, description: "Largest basin diameter." },
  },
  gate: (ctx) => {
    // Impacts always happen. The interesting question is retention: an atmosphere screens
    // small impactors, and resurfacing erases the record.
    const heatFlux = ctx.tidalHeatingWm2 + ctx.radiogenicHeatingWm2;
    const atmosphericScreening = Math.min(1, ctx.surfacePressurePa / 1e5);
    const resurfacing = Math.min(1, heatFlux / 0.5);
    const erosion = ctx.stableLiquid !== "none" ? 0.5 : 0;

    const retention = Math.max(0, 1 - atmosphericScreening * 0.5 - resurfacing * 0.6 - erosion * 0.4);

    return {
      admissible: true,
      gatedBy: "jeans_parameter",
      reason:
        ctx.surfacePressurePa < MIN_AEOLIAN_PRESSURE_PA
          ? "Airless body: the full impact record is preserved with sharp rims."
          : `Surface pressure ${(ctx.surfacePressurePa / 1e5).toFixed(3)} bar screens small impactors; ` +
            `heat flux ${heatFlux.toFixed(3)} W/m2 and ${ctx.stableLiquid} erosion degrade the record.`,
      intensityRange: [Math.max(0, retention - 0.2), Math.min(1, retention + 0.2)],
      confidence: 0.4,
    };
  },
  /**
   * Two crater populations, large and small.
   *
   * Impactor size-frequency distributions are steep power laws: small craters vastly
   * outnumber large ones. A single Worley layer gives every crater the same size and reads
   * as golf-ball dimpling, so we superimpose a sparse large population on a dense small one.
   */
  evaluate: ({ dir, params, seed, radiusM }) => {
    const largestKm = params.largestCraterKm ?? 120;
    const density = params.density ?? 0.4;
    const freshness = 1 - (params.degradation ?? 0.3);

    let total = 0;
    // Depth-to-diameter for fresh simple craters is roughly 1:5, shallower once degraded.
    for (const [scaleKm, weight] of [
      [largestKm, 1],
      [largestKm / 4.5, 0.45],
    ] as const) {
      const freq = frequencyForScale(scaleKm, radiusM);
      const { f1 } = worley3(dir.x * freq, dir.y * freq, dir.z * freq, seed + scaleKm);
      const depthM = scaleKm * 1000 * 0.12;
      total += craterProfile(f1 / 0.5) * depthM * weight;
    }

    return total * density * freshness;
  },
});

export const aeolianTransport = defineOperator({
  id: "aeolian_transport",
  name: "Aeolian transport",
  description: "Dune fields, yardangs and ventifacts, from wind-driven sediment transport.",
  references: [],
  layerOrder: 50,
  parameters: {
    coverage: { min: 0, max: 1, default: 0.15, description: "Fraction covered by dune fields." },
    duneHeightM: { min: 1, max: 400, default: 30, description: "Typical dune height." },
    wavelengthM: { min: 10, max: 5_000, default: 400, description: "Dune spacing." },
  },
  gate: (ctx) => {
    const hasAtmosphere = ctx.surfacePressurePa >= MIN_AEOLIAN_PRESSURE_PA;
    const notDrowned = ctx.hydrosphereFraction < 0.95;
    const admissible = hasAtmosphere && notDrowned;
    const pressureStrength = Math.min(
      1,
      Math.log10(Math.max(ctx.surfacePressurePa, 1) / MIN_AEOLIAN_PRESSURE_PA) /
        Math.log10(STRONG_AEOLIAN_PRESSURE_PA / MIN_AEOLIAN_PRESSURE_PA),
    );
    // Dunes need exposed sediment as well as wind. Two worlds at the same pressure but
    // with different ocean coverage are genuinely different places, and this is where that
    // difference enters the terrain.
    const exposedLand = 1 - ctx.hydrosphereFraction;
    const strength = pressureStrength * exposedLand;

    return {
      admissible,
      gatedBy: "jeans_parameter",
      reason: !hasAtmosphere
        ? `Surface pressure ${ctx.surfacePressurePa.toFixed(1)} Pa is below the ~${MIN_AEOLIAN_PRESSURE_PA} Pa needed to move sediment. No wind-formed features.`
        : !notDrowned
          ? "Surface is almost entirely covered by liquid; no exposed sediment to transport."
          : `Surface pressure ${(ctx.surfacePressurePa / 1e5).toFixed(4)} bar permits aeolian transport.`,
      intensityRange: [strength * 0.2, strength],
      // Surface pressure is assumed rather than measured for almost every planet.
      confidence: 0.25,
    };
  },
  /**
   * Transverse dune fields.
   *
   * The vertical axis is compressed before sampling, which stretches the noise into
   * roughly east-west bands — dunes form perpendicular to the prevailing wind, and on a
   * rotating body that wind is zonal. Sediment also collects in low ground, so the field
   * fades out over highlands.
   */
  evaluate: ({ dir, params, seed, radiusM, heightSoFarM }) => {
    const wavelengthKm = Math.max((params.wavelengthM ?? 400) / 1000, 0.05);
    const freq = frequencyForScale(wavelengthKm, radiusM);

    // Compressing y stretches features along latitude lines.
    const n = fbm(dir.x * freq, dir.y * freq * 0.22, dir.z * freq, seed, { octaves: 3 });
    const ripple = Math.abs(Math.sin(n * Math.PI * 3));

    const lowland = smoothstep(900, -400, heightSoFarM);
    return ripple * (params.duneHeightM ?? 0) * (params.coverage ?? 0) * lowland;
  },
});

export const fluvialErosion = defineOperator({
  id: "fluvial_erosion",
  name: "Fluvial erosion",
  description: "Valley networks, deltas and alluvial fans carved by a stable surface liquid.",
  references: [],
  layerOrder: 60,
  parameters: {
    incisionM: { min: 0, max: 4_000, default: 300, description: "Typical valley incision." },
    networkDensity: { min: 0, max: 1, default: 0.4, description: "Drainage network density." },
  },
  gate: (ctx) => {
    const admissible = ctx.stableLiquid !== "none" && ctx.hydrosphereFraction < 0.98;
    // Drainage networks need both a liquid and land to run over. A near-ocean world has
    // little subaerial drainage; a world with a trace hydrosphere has little liquid.
    // The product peaks around half-and-half, which is where Earth sits.
    const land = 1 - ctx.hydrosphereFraction;
    const vigour = Math.min(1, 4 * ctx.hydrosphereFraction * land);
    return {
      admissible,
      gatedBy: "equilibrium_temperature",
      reason: admissible
        ? `${ctx.stableLiquid} is thermodynamically stable at ${ctx.surfaceTemperatureK.toFixed(0)} K and ` +
          `${(ctx.surfacePressurePa / 1e5).toFixed(3)} bar, so it can flow and incise.`
        : ctx.stableLiquid === "none"
          ? `No liquid is stable at ${ctx.surfaceTemperatureK.toFixed(0)} K and ${(ctx.surfacePressurePa / 1e5).toFixed(3)} bar.`
          : "Surface is entirely submerged; no subaerial drainage.",
      intensityRange: [0.1 * vigour, Math.max(0.15, 0.8 * vigour)],
      confidence: 0.25,
    };
  },
  /**
   * Dendritic valley incision.
   *
   * Ridged noise inverted into channels, gated on elevation because water runs downhill:
   * there is no drainage network below the datum, and incision deepens with the relief
   * available to cut into.
   */
  evaluate: ({ dir, params, seed, radiusM, heightSoFarM }) => {
    const freq = frequencyForScale(70, radiusM);
    const r = ridged(dir.x * freq, dir.y * freq, dir.z * freq, seed, { octaves: 5 });
    const channel = smoothstep(0.72, 1.0, r);
    const highland = smoothstep(0, 1600, heightSoFarM);
    return -channel * (params.incisionM ?? 0) * (params.networkDensity ?? 0) * highland;
  },
});

export const glacialErosion = defineOperator({
  id: "glacial_erosion",
  name: "Glacial erosion",
  description: "U-shaped valleys, moraines and polar caps where a volatile is solid.",
  references: [],
  layerOrder: 65,
  parameters: {
    capExtent: { min: 0, max: 1, default: 0.15, description: "Fraction under permanent ice." },
    scourDepthM: { min: 0, max: 2_000, default: 200, description: "Glacial scour depth." },
  },
  gate: (ctx) => {
    const admissible = ctx.hasStableIce;
    // A tidally locked world traps volatiles on the permanent nightside — a much larger
    // and differently shaped cap than a rotating world's polar caps.
    const extent = ctx.tidallyLocked ? 0.5 : 0.3;
    return {
      admissible,
      gatedBy: "equilibrium_temperature",
      reason: admissible
        ? ctx.tidallyLocked
          ? "Tidal locking creates a permanent anti-stellar cold trap where volatiles accumulate."
          : `A solid volatile phase is stable at ${ctx.surfaceTemperatureK.toFixed(0)} K near the poles.`
        : `No volatile has a stable solid phase at ${ctx.surfaceTemperatureK.toFixed(0)} K.`,
      intensityRange: [0.02, extent],
      confidence: 0.3,
    };
  },
  /**
   * Ice accumulation and glacial scour.
   *
   * The climate axis is the interesting part. On a rotating world the cold trap is polar,
   * so extent follows latitude. On a tidally locked world it is the antistellar point, so
   * extent follows the substellar angle and the cap is a hemisphere rather than two poles.
   * The same operator, two very different-looking worlds, decided by physics upstream.
   */
  evaluate: ({ params, seed, dir, radiusM, latitude, substellarAngle, tidallyLocked }) => {
    const climate = tidallyLocked
      ? substellarAngle / Math.PI
      : Math.abs(latitude) / (Math.PI / 2);

    const extent = params.capExtent ?? 0.15;
    const cold = smoothstep(1 - extent * 1.8, 1 - extent * 0.3, climate);
    if (cold <= 0) return 0;

    const scour = params.scourDepthM ?? 0;
    // Ice piles up in the cap interior; the margin is where scour cuts hardest.
    const margin = 4 * cold * (1 - cold);
    const freq = frequencyForScale(180, radiusM);
    const roughness = fbm(dir.x * freq, dir.y * freq, dir.z * freq, seed, { octaves: 3 });

    return cold * scour * 0.6 - margin * scour * 0.35 + roughness * scour * 0.15 * cold;
  },
});
