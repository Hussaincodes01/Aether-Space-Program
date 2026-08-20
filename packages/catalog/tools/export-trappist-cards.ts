/**
 * Export TRAPPIST-1 planets as aether-harness data cards.
 *
 * The Solar System is where the generator gets calibrated; TRAPPIST-1 is where it gets used.
 * Seven terrestrial planets around one M8V dwarf, all with measured radii and TTV masses,
 * spanning insolation from roughly four times Earth's down to a tenth of it -- so a single
 * system exercises most of the archetype range without changing host star, distance or age.
 *
 * Run: pnpm --filter @aether/catalog run export:trappist
 */

import { writeFileSync } from "node:fs";
import { TRAPPIST_1 } from "../src/seed/trappist-1.js";

interface Q {
  value: number;
  unit: string;
  sigma?: number;
  provenance: "measured" | "derived" | "assumed";
  source: string;
}

type Measured = {
  value: number;
  sourceId: string;
  method: string;
  uncertainty?: { minus: number; plus: number };
};

const star = TRAPPIST_1.star;

/** Widest half of an asymmetric interval; the card format carries a single sigma. */
function sigmaOf(m: Measured): number | undefined {
  return m.uncertainty ? Math.max(m.uncertainty.minus, m.uncertainty.plus) : undefined;
}

function toQ(m: Measured, unit: string): Q {
  const sigma = sigmaOf(m);
  const provenance = (m.method === "measured" ? "measured" : "derived") as Q["provenance"];
  const base: Q = { value: m.value, unit, provenance, source: m.sourceId };
  return sigma === undefined ? base : { ...base, sigma };
}

// Luminosity from the star's own measured radius and effective temperature, so insolation is
// derived here rather than assumed. TRAPPIST-1 is about 0.00055 L_sun: a planet at 0.029 AU
// still receives roughly Earth's light, and assuming a Sun-like host would overstate it by
// three orders of magnitude.
const rSun = star.radius.value;
const teff = star.effectiveTemperature.value;
const luminositySun = rSun ** 2 * (teff / 5772) ** 4;

const cards = TRAPPIST_1.planets.map((p) => {
  const obs: Record<string, Q> = {
    radius_earth: toQ(p.radius as Measured, "R_earth"),
    mass_earth: toQ(p.mass as Measured, "M_earth"),
    orbital_period_days: toQ(p.orbitalPeriod as Measured, "d"),
    stellar_teff_k: toQ(star.effectiveTemperature as Measured, "K"),
    stellar_radius_sun: toQ(star.radius as Measured, "R_sun"),
    stellar_mass_sun: toQ(star.mass as Measured, "M_sun"),
  };

  if (p.semiMajorAxis) {
    const a = p.semiMajorAxis.value;
    obs.semi_major_axis_au = toQ(p.semiMajorAxis as Measured, "AU");
    obs.insolation_earth = {
      value: luminositySun / (a * a),
      unit: "S_earth",
      provenance: "derived",
      source: "inverse square law against the measured host luminosity",
    };
  }
  if (p.eccentricity) obs.eccentricity = toQ(p.eccentricity as Measured, "-");
  if (p.bondAlbedo) obs.bond_albedo = toQ(p.bondAlbedo as Measured, "-");

  const notes = [TRAPPIST_1.blurb];
  if (p.atmosphereNote) notes.push(p.atmosphereNote);
  notes.push(
    "tidal locking is likely at this separation; the harness derives the probability",
    "no exoplanet surface has ever been resolved -- everything generated here is hypothesis",
  );

  return { planet_id: p.name, host_star: star.name, notes, obs };
});

const out = process.argv[2] ?? "trappist-cards.json";
writeFileSync(out, JSON.stringify(cards, null, 2) + "\n");

console.log(`${cards.length} TRAPPIST-1 cards -> ${out}`);
console.log(`host luminosity ${luminositySun.toExponential(3)} L_sun, Teff ${teff} K`);
for (const c of cards) {
  const s = c.obs.insolation_earth?.value;
  const r = c.obs.radius_earth.value;
  console.log(
    `  ${c.planet_id.padEnd(14)} R=${r.toFixed(2)} Re  S=${s === undefined ? "?" : s.toFixed(3)} S_earth`,
  );
}
