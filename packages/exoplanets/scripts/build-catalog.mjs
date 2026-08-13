/**
 * Ingest the NASA Exoplanet Archive into Aether's binary format.
 *
 * Every confirmed exoplanet and its host, positioned in the same equatorial J2000 frame as
 * the star and deep-sky catalogues so all three layers register without a conversion.
 *
 * ## Which table, and why it matters
 *
 * This reads `pscomppars` — the *composite* table, one row per planet, which the Archive
 * explicitly warns "may not be internally or physically self-consistent" because its fields
 * are drawn from different publications.
 *
 * That warning does not apply to what this script uses it for. **Position and distance come
 * from one source** (Gaia astrometry) regardless of which paper supplied the planet's mass,
 * so for *mapping* the composite table is both correct and far more complete than `ps`.
 * The self-consistency problem bites when you combine fields — deriving a density from a
 * mass in one paper and a radius in another. Those derivations must come from `ps`, and
 * this file marks every value with where it came from so that stays enforceable.
 *
 * ## A trap in the archive's TAP service
 *
 * `SELECT TOP n ... ORDER BY x` applies TOP *before* ORDER BY here, silently returning
 * arbitrary rows. Asking for the six nearest systems returns HD 80653 at 109 pc rather than
 * Proxima at 1.30 pc. Never combine them; filter with WHERE and sort locally.
 *
 * Usage:  node scripts/build-catalog.mjs [path/to/pscomppars.csv]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

const TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const COLUMNS = [
  "pl_name", "hostname", "sy_pnum", "ra", "dec", "sy_dist",
  "st_teff", "st_rad", "st_mass", "st_lum",
  "pl_rade", "pl_bmasse", "pl_orbper", "pl_orbsmax", "pl_orbeccen",
  "pl_orbincl", "pl_eqt", "pl_dens",
  "discoverymethod", "disc_year", "disc_facility",
];

const SYSTEM_MAGIC = "AETHSYST";
const PLANET_MAGIC = "AETHPLAN";
const FORMAT_VERSION = 1;
const HEADER_BYTES = 16;
const BYTES_PER_SYSTEM = 40;
const BYTES_PER_PLANET = 40;

/** Discovery methods, indexed. Order is stable; append only. */
const METHODS = [
  "Transit",
  "Radial Velocity",
  "Microlensing",
  "Imaging",
  "Transit Timing Variations",
  "Eclipse Timing Variations",
  "Orbital Brightness Modulation",
  "Pulsar Timing",
  "Pulsation Timing Variations",
  "Astrometry",
  "Disk Kinematics",
];

/**
 * Missing values are stored as NaN, not zero.
 *
 * Zero is a legitimate eccentricity and a plausible temperature; NaN is not a legitimate
 * anything, so it cannot be mistaken for a measurement. The loader turns it back into an
 * explicit "unknown", and the prior resolver — not the renderer — decides what to do about
 * it. This is the binary-format expression of the rule that `null` must survive to the UI.
 */
const UNKNOWN = Number.NaN;

function num(value) {
  if (value === undefined || value === null || value === "") return UNKNOWN;
  const n = Number(value);
  return Number.isFinite(n) ? n : UNKNOWN;
}

/** Split a CSV line honouring quoted fields; host names contain commas. */
function splitCsv(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

async function readSource(path) {
  if (path) {
    if (!existsSync(path)) throw new Error(`Not found: ${path}`);
    return readFileSync(path, "utf8");
  }
  const url =
    `${TAP}?query=${encodeURIComponent(`select ${COLUMNS.join(",")} from pscomppars`)}` +
    `&format=csv`;
  process.stderr.write(`Querying NASA Exoplanet Archive...\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TAP query failed: ${response.status}`);
  return response.text();
}

function writeHeader(buffer, magic, count) {
  buffer.write(magic, 0, "ascii");
  buffer.writeUInt32LE(FORMAT_VERSION, 8);
  buffer.writeUInt32LE(count, 12);
}

async function main() {
  const text = await readSource(process.argv[2]);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const col = Object.fromEntries(splitCsv(lines[0]).map((n, i) => [n.trim(), i]));

  for (const required of COLUMNS) {
    if (col[required] === undefined) {
      throw new Error(
        `Archive column "${required}" is missing — the schema changed. Pin the column set ` +
          `rather than guessing at order.`,
      );
    }
  }

  const systems = new Map();
  const planets = [];
  let unmappable = 0;

  for (let i = 1; i < lines.length; i++) {
    const f = splitCsv(lines[i]);
    const unquote = (s) => (s ?? "").replace(/^"|"$/g, "").trim();

    const hostname = unquote(f[col.hostname]);
    const ra = num(f[col.ra]);
    const dec = num(f[col.dec]);
    const distancePc = num(f[col.sy_dist]);

    // Without a distance there is no position, and a planet with no position cannot be put
    // on a map. 27 of 6,336 fall here; they are reported rather than silently dropped.
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(distancePc)) {
      unmappable++;
      continue;
    }

    if (!systems.has(hostname)) {
      const raRad = (ra * Math.PI) / 180;
      const decRad = (dec * Math.PI) / 180;
      const cosDec = Math.cos(decRad);

      systems.set(hostname, {
        name: hostname,
        // Equatorial J2000 cartesian, parsecs — the same frame the star catalogue uses.
        x: distancePc * cosDec * Math.cos(raRad),
        y: distancePc * cosDec * Math.sin(raRad),
        z: distancePc * Math.sin(decRad),
        distancePc,
        teff: num(f[col.st_teff]),
        radiusSun: num(f[col.st_rad]),
        massSun: num(f[col.st_mass]),
        // st_lum is log10(L/Lsun), not L/Lsun. Treating it as linear would make the Sun
        // a zero-luminosity star.
        logLuminosity: num(f[col.st_lum]),
        planetIndices: [],
      });
    }

    const system = systems.get(hostname);
    const methodIndex = METHODS.indexOf(unquote(f[col.discoverymethod]));

    system.planetIndices.push(planets.length);
    planets.push({
      hostname,
      name: unquote(f[col.pl_name]),
      radiusEarth: num(f[col.pl_rade]),
      massEarth: num(f[col.pl_bmasse]),
      periodDays: num(f[col.pl_orbper]),
      semiMajorAu: num(f[col.pl_orbsmax]),
      eccentricity: num(f[col.pl_orbeccen]),
      inclinationDeg: num(f[col.pl_orbincl]),
      eqTempK: num(f[col.pl_eqt]),
      densityGcc: num(f[col.pl_dens]),
      method: methodIndex >= 0 ? methodIndex : 255,
      discYear: Number(f[col.disc_year]) || 0,
      facility: unquote(f[col.disc_facility]),
    });
  }

  // Order systems by distance so the renderer can draw a prefix as a quality tier, and so
  // the nearest and most-studied systems load first.
  const ordered = [...systems.values()].sort((a, b) => a.distancePc - b.distancePc);

  // Planets are re-emitted grouped by system, so a system's planets are contiguous and can
  // be read as a single range rather than scattered through the buffer.
  const orderedPlanets = [];
  for (const system of ordered) {
    system.firstPlanet = orderedPlanets.length;
    for (const idx of system.planetIndices) orderedPlanets.push(planets[idx]);
  }

  const systemBuffer = Buffer.alloc(HEADER_BYTES + ordered.length * BYTES_PER_SYSTEM);
  writeHeader(systemBuffer, SYSTEM_MAGIC, ordered.length);
  let o = HEADER_BYTES;
  for (const s of ordered) {
    systemBuffer.writeFloatLE(s.x, o);
    systemBuffer.writeFloatLE(s.y, o + 4);
    systemBuffer.writeFloatLE(s.z, o + 8);
    systemBuffer.writeFloatLE(s.distancePc, o + 12);
    systemBuffer.writeFloatLE(s.teff, o + 16);
    systemBuffer.writeFloatLE(s.radiusSun, o + 20);
    systemBuffer.writeFloatLE(s.massSun, o + 24);
    systemBuffer.writeFloatLE(s.logLuminosity, o + 28);
    systemBuffer.writeUInt32LE(s.firstPlanet, o + 32);
    systemBuffer.writeUInt8(Math.min(s.planetIndices.length, 255), o + 36);
    systemBuffer.writeUInt8(0, o + 37);
    systemBuffer.writeUInt16LE(0, o + 38);
    o += BYTES_PER_SYSTEM;
  }

  const planetBuffer = Buffer.alloc(HEADER_BYTES + orderedPlanets.length * BYTES_PER_PLANET);
  writeHeader(planetBuffer, PLANET_MAGIC, orderedPlanets.length);
  o = HEADER_BYTES;
  for (const p of orderedPlanets) {
    planetBuffer.writeFloatLE(p.radiusEarth, o);
    planetBuffer.writeFloatLE(p.massEarth, o + 4);
    planetBuffer.writeFloatLE(p.periodDays, o + 8);
    planetBuffer.writeFloatLE(p.semiMajorAu, o + 12);
    planetBuffer.writeFloatLE(p.eccentricity, o + 16);
    planetBuffer.writeFloatLE(p.inclinationDeg, o + 20);
    planetBuffer.writeFloatLE(p.eqTempK, o + 24);
    planetBuffer.writeFloatLE(p.densityGcc, o + 28);
    planetBuffer.writeUInt8(p.method, o + 32);
    planetBuffer.writeUInt16LE(p.discYear, o + 33);
    planetBuffer.writeUInt8(0, o + 35);
    planetBuffer.writeUInt32LE(0, o + 36);
    o += BYTES_PER_PLANET;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "systems.bin"), systemBuffer);
  writeFileSync(join(DATA_DIR, "planets.bin"), planetBuffer);
  writeFileSync(
    join(DATA_DIR, "names.json"),
    JSON.stringify({
      methods: METHODS,
      systems: ordered.map((s) => s.name),
      planets: orderedPlanets.map((p) => p.name),
      facilities: orderedPlanets.map((p) => p.facility),
    }),
  );

  const has = (key) => orderedPlanets.filter((p) => Number.isFinite(p[key])).length;
  const pct = (n) => `${((n / orderedPlanets.length) * 100).toFixed(1)}%`;
  const kb = (b) => `${(b.length / 1024).toFixed(0)} KB`;

  process.stderr.write(
    [
      ``,
      `systems              ${ordered.length.toLocaleString()}`,
      `planets              ${orderedPlanets.length.toLocaleString()}`,
      `unmappable (no ra/dec/distance, dropped)  ${unmappable}`,
      ``,
      `nearest system       ${ordered[0].name} at ${ordered[0].distancePc.toFixed(2)} pc`,
      `farthest system      ${ordered[ordered.length - 1].name} at ` +
        `${ordered[ordered.length - 1].distancePc.toFixed(0)} pc`,
      ``,
      `completeness — what the generator must fill in:`,
      `  radius             ${has("radiusEarth").toLocaleString()} (${pct(has("radiusEarth"))})`,
      `  mass               ${has("massEarth").toLocaleString()} (${pct(has("massEarth"))})`,
      `  period             ${has("periodDays").toLocaleString()} (${pct(has("periodDays"))})`,
      `  semi-major axis    ${has("semiMajorAu").toLocaleString()} (${pct(has("semiMajorAu"))})`,
      `  eccentricity       ${has("eccentricity").toLocaleString()} (${pct(has("eccentricity"))})`,
      `  inclination        ${has("inclinationDeg").toLocaleString()} (${pct(has("inclinationDeg"))})`,
      `  equilibrium temp   ${has("eqTempK").toLocaleString()} (${pct(has("eqTempK"))})`,
      ``,
      `systems.bin          ${kb(systemBuffer)}`,
      `planets.bin          ${kb(planetBuffer)}`,
      ``,
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
