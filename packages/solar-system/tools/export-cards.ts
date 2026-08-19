/**
 * Export the Solar System as aether-harness data cards.
 *
 * The harness generates a surface from observations. Our 33 Solar System bodies are the only
 * place where the answer is already known, so they are where the generator can be falsified
 * rather than merely admired -- which is why the demo starts here rather than with exoplanets.
 *
 * Two conversions are easy to get wrong, and both would corrupt the calibration:
 *
 *  1. **A moon's insolation comes from its planet's orbit, not its own.** Europa's semi-major
 *     axis is 671,000 km around Jupiter; its sunlight is set by Jupiter's 5.2 AU. Feeding the
 *     local orbit would compute an insolation about 60,000 times too high and classify an ice
 *     moon as a lava world. So the heliocentric distance is resolved by walking up the parent
 *     chain.
 *
 *  2. **Measured surface temperature is not equilibrium temperature.** Venus is 737 K at the
 *     surface and about 230 K at equilibrium; the difference is the greenhouse effect, which
 *     is exactly the sort of thing the harness derives. Mapping our measured surface value
 *     onto `equilibrium_temp_k` would hand the model an answer that already contains the
 *     physics it is supposed to compute, and Venus would be the only body it got "right".
 *     Surface temperature is passed as a note instead, so it stays visible without being
 *     laundered into an input.
 *
 * Run: pnpm --filter @aether/solar-system run export:cards
 */

import { writeFileSync } from "node:fs";
import { AU, EARTH_MASS, EARTH_RADIUS } from "@aether/units";
import { SOLAR_SYSTEM, getBody, orbitalPeriod, type SolarBody } from "../src/index.js";

/** One observation, in the harness's Quantity shape. */
interface Q {
  value: number;
  unit: string;
  sigma?: number;
  provenance: "measured" | "derived" | "assumed";
  source: string;
}

const JPL = "JPL Solar System Dynamics / IAU 2015 nominal values";

const q = (
  value: number,
  unit: string,
  provenance: Q["provenance"] = "measured",
  source = JPL,
): Q => ({ value, unit, provenance, source });

/**
 * Heliocentric semi-major axis, walking up through any parent.
 *
 * A moon returns its planet's orbit; a planet returns its own. This is the fix for (1) above.
 */
function heliocentricAxisM(body: SolarBody): number | null {
  let cursor: SolarBody | undefined = body;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.parentId === "sun") return cursor.elements?.semiMajorAxisM ?? null;
    if (!cursor.parentId) return null;
    cursor = getBody(cursor.parentId);
  }
  return null;
}

function toCard(body: SolarBody) {
  const helioM = heliocentricAxisM(body);
  const helioAu = helioM === null ? null : helioM / AU;

  const obs: Record<string, Q> = {
    radius_earth: q(body.radiusM / EARTH_RADIUS, "R_earth"),
    mass_earth: q(body.massKg / EARTH_MASS, "M_earth"),
    bond_albedo: q(body.bondAlbedo, "-"),
    // The Sun, measured. Every body here orbits the same star, so these are not assumptions.
    stellar_teff_k: q(5772, "K"),
    stellar_radius_sun: q(1, "R_sun"),
    stellar_mass_sun: q(1, "M_sun"),
    stellar_age_gyr: q(4.568, "Gyr"),
  };

  /**
   * `semi_major_axis_au` carries the orbit around the *primary*, not around the Sun.
   *
   * The harness uses this one field for two different physical purposes, and for a moon they
   * disagree by three orders of magnitude:
   *
   *   - insolation wants the heliocentric distance
   *   - tidal heating and tidal locking want the orbit around the body it actually orbits
   *
   * Supplying the heliocentric value for both is what made Io come out as an ice world. Its
   * tidal flux was computed as though it orbited the Sun at 5.203 AU rather than Jupiter at
   * 0.00282 AU, and the relation goes as a^-7.5, so the result collapsed to zero. The harness
   * is calibrated correctly -- its own comment cites Io at a = 0.00282 AU -- so the error was
   * entirely in what this exporter handed it.
   *
   * Insolation is therefore supplied explicitly below from the heliocentric distance, and
   * `derive()` prefers a supplied insolation over deriving one from the axis, so each
   * consumer gets the distance it actually needs.
   */
  if (body.elements) {
    obs.semi_major_axis_au = q(body.elements.semiMajorAxisM / AU, "AU");
    obs.eccentricity = q(body.elements.eccentricity, "-");
    obs.orbital_period_days = q(orbitalPeriod(body.elements) / 86_400, "d");
  }

  if (helioAu !== null) {
    // Inverse square from the heliocentric distance resolved up the parent chain, so a moon
    // is lit by its planet's orbit rather than by its own.
    obs.insolation_earth = q(
      1 / (helioAu * helioAu),
      "S_earth",
      "derived",
      "inverse square law",
    );
  }

  if (body.rotationPeriodS !== 0) {
    // Negative means retrograde in our tables; the harness wants a magnitude.
    obs.rotation_period_hours = q(Math.abs(body.rotationPeriodS) / 3600, "h");
  }
  obs.obliquity_deg = q((body.axialTiltRad * 180) / Math.PI, "deg");

  const notes = [body.blurb];
  // Deliberately a note, not an observation. See (2) in the file header.
  notes.push(
    `measured mean surface temperature ${body.surfaceTemperatureK} K ` +
      `(not supplied as equilibrium_temp_k: the difference is the greenhouse effect, ` +
      `which the harness derives)`,
  );
  if (body.surfacePressurePa > 0) {
    notes.push(
      `measured surface pressure ${(body.surfacePressurePa / 1e5).toPrecision(3)} bar`,
    );
  } else {
    notes.push("airless: no measurable surface pressure");
  }
  if (body.stableLiquid !== "none") notes.push(`stable surface liquid: ${body.stableLiquid}`);
  if (body.tidallyLocked) notes.push("tidally locked");
  if (body.parentId && body.parentId !== "sun") {
    notes.push(
      `moon of ${getBody(body.parentId)?.name ?? body.parentId}; ` +
        `insolation taken from the parent's heliocentric distance`,
    );
  }

  return { planet_id: body.name, host_star: "Sun", notes, obs };
}

// The Sun is the light source, not a surface to generate. Everything else goes through,
// including the giants -- refusing to hand them to the harness would hide whether its own
// gates classify them correctly, which is precisely what a calibration run is for.
const bodies = SOLAR_SYSTEM.filter((b) => b.kind !== "star");
const cards = bodies.map(toCard);

const out = process.argv[2] ?? "solar-system-cards.json";
writeFileSync(out, JSON.stringify(cards, null, 2) + "\n");

console.log(`${cards.length} cards -> ${out}`);
for (const c of cards.slice(0, 4)) {
  const a = c.obs.semi_major_axis_au?.value;
  const s = c.obs.insolation_earth?.value;
  console.log(
    `  ${c.planet_id.padEnd(10)} a=${a?.toFixed(3).padStart(7)} AU  S=${s?.toExponential(2)}`,
  );
}
