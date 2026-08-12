/**
 * Endogenic operators — processes driven by the planet's own internal heat.
 *
 * The gate is a heat-flux budget: radiogenic heating from mass and age, plus tidal heating
 * from eccentricity and orbital distance. Earth's surface heat flux is ~0.087 W/m2 and Io's
 * tidal heating reaches ~2 W/m2, which brackets the interesting range.
 */

import { defineOperator } from "../registry.js";
import { frequencyForScale } from "../evaluate.js";
import { fbm, ridged, smoothstep, worley3 } from "../noise.js";
import { hasSolidSurface, noSolidSurface } from "../types.js";

/** Roughly Earth-like heat flux. Below this, resurfacing is too slow to matter visually. */
const ACTIVE_HEAT_FLUX_WM2 = 0.02;
/** Io-like. Above this the surface is being repaved continuously. */
const EXTREME_HEAT_FLUX_WM2 = 0.5;
/** Dry basalt solidus at low pressure. Above this the surface is molten. */
const BASALT_SOLIDUS_K = 1400;

function totalHeatFlux(ctx: { tidalHeatingWm2: number; radiogenicHeatingWm2: number }): number {
  return ctx.tidalHeatingWm2 + ctx.radiogenicHeatingWm2;
}

export const volcanicConstructs = defineOperator({
  id: "volcanic_constructs",
  name: "Volcanic constructs",
  description: "Shield volcanoes, calderas and flood-basalt provinces.",
  references: [],
  layerOrder: 20,
  parameters: {
    coverage: { min: 0, max: 1, default: 0.2, description: "Fraction of surface resurfaced." },
    edificeHeightM: { min: 0, max: 25_000, default: 4_000, description: "Typical edifice height." },
    scaleKm: { min: 20, max: 2_000, default: 400, description: "Province width." },
  },
  gate: (ctx) => {
    if (!hasSolidSurface(ctx)) return noSolidSurface(ctx);

    const flux = totalHeatFlux(ctx);
    const admissible = flux >= ACTIVE_HEAT_FLUX_WM2 && ctx.surfaceTemperatureK < BASALT_SOLIDUS_K;
    const intensity = Math.min(1, flux / EXTREME_HEAT_FLUX_WM2);

    if (ctx.surfaceTemperatureK >= BASALT_SOLIDUS_K) {
      return {
        admissible: false,
        gatedBy: "equilibrium_temperature",
        reason: `Surface at ${ctx.surfaceTemperatureK.toFixed(0)} K is above the basalt solidus; the surface is molten rather than constructed.`,
        intensityRange: [0, 0],
        confidence: 0.6,
      };
    }

    return {
      admissible,
      gatedBy: "tidal_heating_rate",
      reason: admissible
        ? `Heat flux ${flux.toFixed(3)} W/m2 (tidal ${ctx.tidalHeatingWm2.toFixed(3)}, radiogenic ${ctx.radiogenicHeatingWm2.toFixed(3)}) supports active volcanism.`
        : `Heat flux ${flux.toFixed(3)} W/m2 is below the ${ACTIVE_HEAT_FLUX_WM2} W/m2 needed for visible resurfacing; any volcanism is ancient.`,
      intensityRange: [intensity * 0.3, intensity],
      // Interior heat is poorly constrained without an age, and age is often missing.
      confidence: ctx.systemAgeS === null ? 0.2 : 0.4,
    };
  },
  /**
   * Shield edifices on flood-basalt provinces.
   *
   * Worley feature points become volcanic centres; a low-frequency mask decides which
   * regions are volcanically active, so edifices cluster into provinces instead of
   * sprinkling uniformly over the globe the way raw cellular noise would.
   */
  evaluate: ({ dir, params, seed, radiusM }) => {
    const scaleKm = params.scaleKm ?? 400;
    const freq = frequencyForScale(scaleKm, radiusM);

    const province = fbm(dir.x * freq * 0.3, dir.y * freq * 0.3, dir.z * freq * 0.3, seed + 11, {
      octaves: 3,
    });
    // Coverage sets how much of the surface is inside a province.
    const active = smoothstep(0.6 - (params.coverage ?? 0.2) * 1.4, 0.75, province * 0.5 + 0.5);
    if (active <= 0) return 0;

    const { f1 } = worley3(dir.x * freq, dir.y * freq, dir.z * freq, seed);
    // Shields are broad and low-sloped; the exponent controls the flank profile.
    const cone = Math.max(0, 1 - f1 / 0.45);
    return Math.pow(cone, 2.2) * (params.edificeHeightM ?? 0) * active;
  },
});

export const lavaOcean = defineOperator({
  id: "lava_ocean",
  name: "Lava ocean",
  description: "A globally or hemispherically molten silicate surface.",
  references: [],
  /**
   * Runs last, after every solid-shaping process including microdetail.
   *
   * A liquid surface is level by definition. Flooding earlier let fractures and detail
   * noise roughen the sea afterwards, which produced a visibly and physically wrong
   * corrugated lava ocean. Anything submerged is simply covered — that is what a melt does.
   */
  layerOrder: 110,
  parameters: {
    coverage: { min: 0, max: 1, default: 0.5, description: "Molten fraction of the surface." },
    emissiveStrength: { min: 0, max: 1, default: 0.6, description: "Thermal emission strength." },
  },
  gate: (ctx) => {
    if (!hasSolidSurface(ctx)) return noSolidSurface(ctx);

    const admissible = ctx.surfaceTemperatureK >= BASALT_SOLIDUS_K;
    // A tidally locked lava world melts on the dayside only — the 55 Cancri e case.
    const coverage = ctx.tidallyLocked ? 0.5 : 1;
    return {
      admissible,
      gatedBy: "equilibrium_temperature",
      reason: admissible
        ? `Surface at ${ctx.surfaceTemperatureK.toFixed(0)} K exceeds the basalt solidus (${BASALT_SOLIDUS_K} K)${ctx.tidallyLocked ? "; tidal locking confines melting to the dayside" : ""}.`
        : `Surface at ${ctx.surfaceTemperatureK.toFixed(0)} K is below the basalt solidus.`,
      intensityRange: [coverage * 0.5, coverage],
      confidence: 0.5,
    };
  },
  /**
   * Molten sea filling the low ground.
   *
   * Flooding to a level rather than adding a noise field: a liquid surface is flat, and the
   * visual signature of a lava world is exactly that contrast between a dead-level sea and
   * the ridges standing out of it.
   */
  evaluate: ({ params, heightSoFarM }) => {
    const seaLevelM = ((params.coverage ?? 0.5) - 0.5) * 3000;
    return heightSoFarM < seaLevelM ? seaLevelM - heightSoFarM : 0;
  },
});

export const fractureFields = defineOperator({
  id: "fracture_fields",
  name: "Fracture fields",
  description:
    "Extensional fracture networks, chasmata and lineae, from tidal stress or tectonic strain.",
  references: [],
  layerOrder: 30,
  parameters: {
    density: { min: 0, max: 1, default: 0.3, description: "Areal fracture density." },
    depthM: { min: 0, max: 8_000, default: 800, description: "Typical fracture depth." },
    lengthScaleKm: { min: 10, max: 3_000, default: 300, description: "Characteristic length." },
  },
  gate: (ctx) => {
    if (!hasSolidSurface(ctx)) return noSolidSurface(ctx);

    // Two independent routes: tidal flexing of an icy shell (the Europa case), or
    // endogenic tectonics on a rocky body.
    const tidalRoute = ctx.tidalHeatingWm2 >= ACTIVE_HEAT_FLUX_WM2 && ctx.hasStableIce;
    const tectonicRoute = totalHeatFlux(ctx) >= ACTIVE_HEAT_FLUX_WM2;
    const admissible = tidalRoute || tectonicRoute;

    return {
      admissible,
      gatedBy: tidalRoute ? "tidal_heating_rate" : "surface_gravity",
      reason: tidalRoute
        ? `Tidal heating ${ctx.tidalHeatingWm2.toFixed(3)} W/m2 flexes a stable ice shell, producing lineae.`
        : tectonicRoute
          ? `Interior heat flux ${totalHeatFlux(ctx).toFixed(3)} W/m2 sustains tectonic strain.`
          : "Interior is too cold for either tidal flexing or tectonic fracturing.",
      intensityRange: [0.05, tidalRoute ? 0.9 : 0.5],
      confidence: 0.3,
    };
  },
  /**
   * Narrow extensional fractures.
   *
   * Ridged noise thresholded hard near its crests, which leaves thin linear troughs rather
   * than broad valleys — the difference between Valles Marineris and a river system.
   */
  evaluate: ({ dir, params, seed, radiusM }) => {
    const freq = frequencyForScale(params.lengthScaleKm ?? 300, radiusM);
    const r = ridged(dir.x * freq, dir.y * freq, dir.z * freq, seed, { octaves: 4 });
    const crack = smoothstep(0.86, 1.0, r);
    return -crack * (params.depthM ?? 0) * (params.density ?? 0);
  },
});
