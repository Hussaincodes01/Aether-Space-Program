/**
 * Structural operators: the datum and the large-scale relief everything else carves into.
 */

import { defineOperator } from "../registry.js";
import { frequencyForScale } from "../evaluate.js";
import { fbm, warp } from "../noise.js";
import { hasSolidSurface } from "../types.js";

export const referenceEllipsoid = defineOperator({
  id: "reference_ellipsoid",
  name: "Reference ellipsoid",
  description:
    "The rotational figure of the body — the datum every other operator displaces from.",
  references: [],
  layerOrder: 0,
  parameters: {
    flattening: {
      min: 0,
      max: 0.1,
      default: 0.003,
      description: "Polar flattening from rotation. Earth is 0.00335, Jupiter 0.065.",
      scalesWithIntensity: false,
    },
  },
  gate: (ctx) => {
    // One rule, shared, so the datum and the operators that displace from it cannot
    // disagree about whether there is a surface at all.
    const solid = hasSolidSurface(ctx);
    return {
      admissible: solid,
      gatedBy: "bulk_density",
      reason: solid
        ? `Bulk density ${(ctx.bulkDensityKgM3 / 1000).toFixed(2)} g/cm3 is consistent with a solid surface.`
        : `Bulk density ${(ctx.bulkDensityKgM3 / 1000).toFixed(2)} g/cm3 implies a volatile envelope with no solid surface to stand on.`,
      intensityRange: [1, 1],
      confidence: 0.9,
    };
  },
  // Rotational flattening: r(lat) = R(1 - f sin^2 lat). Small, but it is the datum every
  // other operator displaces from, so getting it wrong tilts everything above it.
  evaluate: ({ params, radiusM, latitude }) => {
    const f = params.flattening ?? 0;
    return -f * radiusM * Math.sin(latitude) ** 2;
  },
});

export const longWavelengthIsostasy = defineOperator({
  id: "long_wavelength_isostasy",
  name: "Long-wavelength isostasy",
  description:
    "Continent-scale highs and lows from crustal thickness variation, floating on the mantle.",
  references: [],
  layerOrder: 1,
  parameters: {
    reliefAmplitudeM: {
      min: 0,
      max: 20_000,
      default: 2_000,
      description: "RMS relief of the long-wavelength field, metres.",
    },
    continentalScaleKm: {
      min: 200,
      max: 8_000,
      default: 1_800,
      description: "Characteristic width of isostatic provinces.",
    },
  },
  gate: (ctx) => {
    const solid = hasSolidSurface(ctx);
    // Maximum supportable topography scales as sigma/(rho*g), so relief goes inversely
    // with gravity. This is why Olympus Mons is on Mars and not on Earth. Normalised so
    // Earth sits at 0.5, leaving headroom in both directions rather than saturating.
    const gravityFactor = Math.min(
      Math.max(9.81 / Math.max(ctx.surfaceGravityMs2, 0.1) / 2, 0.05),
      1,
    );
    return {
      admissible: solid,
      gatedBy: "surface_gravity",
      reason: solid
        ? `Surface gravity ${ctx.surfaceGravityMs2.toFixed(1)} m/s2 supports relief up to roughly ${(gravityFactor * 24).toFixed(0)} km.`
        : "No solid surface.",
      intensityRange: [0.1 * gravityFactor, gravityFactor],
      confidence: 0.5,
    };
  },
  /**
   * Domain-warped fBm.
   *
   * The warp is what separates continents from noise. Plain fBm gives isotropic blobs;
   * offsetting the sample point by another noise field introduces the meandering,
   * directional structure that reads as coastline and mountain belt.
   */
  evaluate: ({ dir, params, seed, radiusM }) => {
    const freq = frequencyForScale(params.continentalScaleKm ?? 1800, radiusM);
    const [wx, wy, wz] = warp(dir.x * freq, dir.y * freq, dir.z * freq, seed, 0.35);
    const n = fbm(wx, wy, wz, seed, { octaves: 6, gain: 0.5 });
    return n * (params.reliefAmplitudeM ?? 0);
  },
});

export const microdetail = defineOperator({
  id: "microdetail",
  name: "Microdetail",
  description:
    "Final-layer noise: grain, small-scale roughness, sub-metre texture. Purely cosmetic.",
  references: [],
  layerOrder: 100,
  parameters: {
    amplitudeM: { min: 0, max: 50, default: 2, description: "Sub-metre roughness amplitude." },
    octaves: {
      min: 1,
      max: 8,
      default: 4,
      description: "Noise octaves.",
      scalesWithIntensity: false,
    },
  },
  gate: (ctx) => ({
    admissible: hasSolidSurface(ctx),
    gatedBy: "bulk_density",
    reason: "Cosmetic detail layer; carries no scientific claim.",
    intensityRange: [0, 1],
    confidence: 0.2,
  }),
  // Roughness at roughly 20 km features — the finest scale a global mesh can resolve.
  // True sub-metre grain belongs in the shader's detail-normal pass, not in geometry.
  evaluate: ({ dir, params, seed, radiusM }) => {
    const freq = frequencyForScale(20, radiusM);
    const n = fbm(dir.x * freq, dir.y * freq, dir.z * freq, seed, {
      octaves: Math.round(params.octaves ?? 4),
      gain: 0.55,
    });
    return n * (params.amplitudeM ?? 0);
  },
});
