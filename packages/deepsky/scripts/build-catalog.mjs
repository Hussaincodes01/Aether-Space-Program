/**
 * Convert OpenNGC into Aether's compact deep-sky binary.
 *
 * OpenNGC (CC BY-SA 4.0) merges NGC and IC with cross-checks against NED, HyperLEDA and
 * SIMBAD. It is explicitly built to be redistributable, which most NGC compilations are not.
 *
 * Distances are *derived* here, not supplied: OpenNGC carries redshift and parallax, and
 * this script turns them into megaparsecs while recording which method was used. Most
 * objects have neither, and those keep distance 0 — placed on the celestial sphere at a
 * nominal radius and flagged as such, rather than being given an invented depth.
 *
 * Usage:  node scripts/build-catalog.mjs [path/to/NGC.csv]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");
const SOURCE_URLS = [
  "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
  // Messier and other famous objects with no NGC/IC designation: the Pleiades, the Large
  // Magellanic Cloud, the Horsehead, the Hyades, Stephan's Quintet. Omitting the addendum
  // leaves the catalogue missing some of the best-known objects in the sky.
  "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv",
];

const MAGIC = "AETHDSKY";
const FORMAT_VERSION = 1;
const BYTES_PER_OBJECT = 28;
const HEADER_BYTES = 16;

const TYPE_MAP = {
  G: 0,
  GPair: 1,
  GTrpl: 2,
  GGroup: 3,
  GCl: 4,
  OCl: 5,
  PN: 6,
  EmN: 7,
  RfN: 8,
  DrkN: 9,
  HII: 10,
  SNR: 11,
  "Cl+N": 12,
  "*Ass": 13,
  Neb: 14,
};

const METHOD = { unknown: 0, parallax: 1, redshift: 2 };

const C_KM_S = 299_792.458;
const H0 = 67.4; // Planck 2018. Every redshift distance below scales as 1/H0.

/** "00:08:27.05" -> radians. Hours, not degrees: RA is 24h across the sky. */
function parseRa(text) {
  const [h, m, s] = text.split(":").map(Number);
  if ([h, m, s].some((v) => !Number.isFinite(v))) return null;
  return ((h + m / 60 + s / 3600) * 15 * Math.PI) / 180;
}

/** "+27:43:03.6" -> radians. The sign belongs to the whole value, not just the degrees. */
function parseDec(text) {
  const sign = text.trim().startsWith("-") ? -1 : 1;
  const [d, m, s] = text.replace("+", "").replace("-", "").split(":").map(Number);
  if ([d, m, s].some((v) => !Number.isFinite(v))) return null;
  return (sign * ((d + m / 60 + s / 3600) * Math.PI)) / 180;
}

/** Galaxy-like OpenNGC types. These can never have a real trigonometric parallax. */
const EXTRAGALACTIC = new Set(["G", "GPair", "GTrpl", "GGroup"]);

/**
 * 50 mas is 20 pc. The nearest objects here are the Hyades (~47 pc) and the Coalsack
 * (~180 pc); anything apparently closer is a foreground star in the cross-match.
 */
const MAX_PLAUSIBLE_PARALLAX_MAS = 50;

function distanceMpc(parallaxMas, redshift, rawType) {
  // A galaxy with a parallax is contamination, not a measurement. OpenNGC lists M31 at
  // 6 mas, which would put Andromeda 167 pc away - inside the Milky Way - instead of
  // 780 kpc. See distance.ts for the full note.
  const parallaxUsable =
    !EXTRAGALACTIC.has(rawType) &&
    Number.isFinite(parallaxMas) &&
    parallaxMas > 0 &&
    parallaxMas <= MAX_PLAUSIBLE_PARALLAX_MAS;

  if (parallaxUsable) {
    return { mpc: 1000 / parallaxMas / 1e6, method: METHOD.parallax };
  }
  if (Number.isFinite(redshift) && redshift > 0) {
    // Relativistic Doppler before Hubble's law; the naive cz/H0 drifts high with z.
    const ratio = (1 + redshift) ** 2;
    const v = C_KM_S * ((ratio - 1) / (ratio + 1));
    return { mpc: v / H0, method: METHOD.redshift };
  }
  return { mpc: 0, method: METHOD.unknown };
}

async function readSources(paths) {
  if (paths.length > 0) {
    for (const p of paths) if (!existsSync(p)) throw new Error(`Not found: ${p}`);
    return paths.map((p) => readFileSync(p, "utf8"));
  }
  const out = [];
  for (const url of SOURCE_URLS) {
    process.stderr.write(`Downloading ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status} for ${url}`);
    out.push(await response.text());
  }
  return out;
}

async function main() {
  const sources = await readSources(process.argv.slice(2));

  // Each file carries its own header. The addendum shares NGC.csv's schema but its column
  // order is not guaranteed to match, so it is parsed against its own header rather than
  // assumed — a silent column shift here would misplace every object in the file.
  const parsed = sources.map((text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const col = Object.fromEntries(lines[0].split(";").map((n, i) => [n.trim(), i]));

    for (const required of ["Name", "Type", "RA", "Dec", "V-Mag", "M", "Redshift", "Pax"]) {
      if (col[required] === undefined) {
        throw new Error(
          `OpenNGC column "${required}" is missing — the upstream schema changed. Fix the ` +
            `mapping rather than guessing at column order.`,
        );
      }
    }

    return { col, rows: lines.slice(1) };
  });

  const objects = [];
  const named = [];
  const skipped = {};
  let noPosition = 0;

  for (const { col, rows } of parsed) {
    for (let i = 0; i < rows.length; i++) {
      const f = rows[i].split(";");
      const rawType = (f[col.Type] ?? "").trim();

      const type = TYPE_MAP[rawType];
      if (type === undefined) {
        skipped[rawType] = (skipped[rawType] ?? 0) + 1;
        continue;
      }

      const ra = parseRa(f[col.RA] ?? "");
      const dec = parseDec(f[col.Dec] ?? "");
      if (ra === null || dec === null) {
        noPosition++;
        continue;
      }

      // Equatorial J2000 unit vector — the same convention the star catalogue uses, so the
      // two layers register against each other without a frame conversion.
      const cosDec = Math.cos(dec);
      const x = cosDec * Math.cos(ra);
      const y = cosDec * Math.sin(ra);
      const z = Math.sin(dec);

      const vmag = Number(f[col["V-Mag"]]);
      const majAx = Number(f[col.MajAx]);
      const { mpc, method } = distanceMpc(Number(f[col.Pax]), Number(f[col.Redshift]), rawType);

      objects.push({
        x,
        y,
        z,
        distanceMpc: mpc,
        // 99 is the conventional "not measured" magnitude; keeping NaN out of the buffer
        // means the renderer never has to test for it.
        vmag: Number.isFinite(vmag) ? vmag : 99,
        majAxArcmin: Number.isFinite(majAx) ? majAx : 0,
        type,
        method,
      });

      const messier = (f[col.M] ?? "").trim();
      const common = (f[col["Common names"]] ?? "").trim();
      if (messier || common) {
        named.push({
          i: objects.length - 1,
          name: (f[col.Name] ?? "").trim(),
          ...(messier ? { m: Number(messier) } : {}),
          ...(common ? { common: common.split(",")[0].trim() } : {}),
        });
      }
    }
  }

  // Brightest first: the renderer can then draw a prefix of the buffer as a quality tier
  // without sorting 13k objects at runtime.
  const order = objects.map((_, i) => i).sort((a, b) => objects[a].vmag - objects[b].vmag);
  const remap = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const sorted = order.map((i) => objects[i]);
  for (const n of named) n.i = remap.get(n.i);
  named.sort((a, b) => a.i - b.i);

  const buffer = Buffer.alloc(HEADER_BYTES + sorted.length * BYTES_PER_OBJECT);
  buffer.write(MAGIC, 0, "ascii");
  buffer.writeUInt32LE(FORMAT_VERSION, 8);
  buffer.writeUInt32LE(sorted.length, 12);

  let offset = HEADER_BYTES;
  for (const o of sorted) {
    buffer.writeFloatLE(o.x, offset);
    buffer.writeFloatLE(o.y, offset + 4);
    buffer.writeFloatLE(o.z, offset + 8);
    buffer.writeFloatLE(o.distanceMpc, offset + 12);
    buffer.writeFloatLE(o.vmag, offset + 16);
    buffer.writeFloatLE(o.majAxArcmin, offset + 20);
    buffer.writeUInt8(o.type, offset + 24);
    buffer.writeUInt8(o.method, offset + 25);
    buffer.writeUInt16LE(0, offset + 26);
    offset += BYTES_PER_OBJECT;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "deepsky.bin"), buffer);
  writeFileSync(join(DATA_DIR, "deepsky-names.json"), JSON.stringify(named));

  const withDistance = sorted.filter((o) => o.distanceMpc > 0).length;
  const byMethod = (m) => sorted.filter((o) => o.method === m).length;
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

  process.stderr.write(
    [
      ``,
      `objects kept          ${sorted.length.toLocaleString()}`,
      `  with a distance     ${withDistance.toLocaleString()} ` +
        `(${byMethod(METHOD.redshift).toLocaleString()} redshift, ` +
        `${byMethod(METHOD.parallax).toLocaleString()} parallax)`,
      `  on the sphere only  ${(sorted.length - withDistance).toLocaleString()}`,
      `named objects         ${named.length.toLocaleString()} ` +
        `(${named.filter((n) => n.m).length} Messier)`,
      `unparseable position  ${noPosition}`,
      ``,
      `skipped by type:      ${Object.entries(skipped)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}=${n}`)
        .join(" ")}`,
      ``,
      `deepsky.bin           ${kb(buffer.length)}`,
      ``,
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
