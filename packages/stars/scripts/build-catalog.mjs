/**
 * Convert the HYG stellar database into Aether's compact binary format.
 *
 * HYG (Hipparcos, Yale Bright Star, Gliese) is the same underlying source set that
 * OpenSpace's Digital Universe star catalogue is built from — but under CC BY-SA 4.0
 * rather than the AMNH licence, which forbids redistribution inside software without
 * written permission. Same science, redistributable.
 *
 * Two tiers, because this is a web client and a 2 MB blocking download is a bad first
 * impression:
 *
 *   stars-bright.bin   apparent magnitude <= 6.5 — everything visible to the unaided eye
 *                      from a dark site. ~15k stars, ~300 KB. Loads instantly.
 *   stars-full.bin     every star with a real parallax distance. ~109k stars, ~2.2 MB.
 *                      Streams in afterwards.
 *
 * Usage:  node scripts/build-catalog.mjs [path/to/hyg_v44.csv.gz]
 * Without an argument it downloads the current release from Codeberg.
 */

import { createGunzip } from "node:zlib";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

const HYG_URL =
  "https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz";

/** Magic, so a truncated or wrong-endian file fails loudly instead of rendering garbage. */
const MAGIC = "AETHSTAR";
const FORMAT_VERSION = 1;
const BYTES_PER_STAR = 20; // x, y, z, absmag, colourIndex — all f32 little-endian
const HEADER_BYTES = 16;

/** HYG uses 100000 pc as its placeholder for "no usable parallax". */
const NO_PARALLAX_DISTANCE_PC = 100_000;
const NAKED_EYE_MAGNITUDE = 6.5;

async function openSource(path) {
  if (path) {
    if (!existsSync(path)) throw new Error(`Not found: ${path}`);
    return createReadStream(path).pipe(createGunzip());
  }
  process.stderr.write(`Downloading HYG from ${HYG_URL}\n`);
  const response = await fetch(HYG_URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  return Readable.fromWeb(response.body).pipe(createGunzip());
}

/** Split a CSV line, respecting quoted fields. HYG has quoted names containing commas. */
function splitCsv(line) {
  const out = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

function encode(stars) {
  const buffer = Buffer.alloc(HEADER_BYTES + stars.length * BYTES_PER_STAR);
  buffer.write(MAGIC, 0, "ascii");
  buffer.writeUInt32LE(FORMAT_VERSION, 8);
  buffer.writeUInt32LE(stars.length, 12);

  let offset = HEADER_BYTES;
  for (const s of stars) {
    buffer.writeFloatLE(s.x, offset);
    buffer.writeFloatLE(s.y, offset + 4);
    buffer.writeFloatLE(s.z, offset + 8);
    buffer.writeFloatLE(s.absmag, offset + 12);
    buffer.writeFloatLE(s.ci, offset + 16);
    offset += BYTES_PER_STAR;
  }
  return buffer;
}

async function main() {
  const stream = await openSource(process.argv[2]);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let columns = null;
  const all = [];
  const bright = [];

  let rows = 0;
  let skippedNoParallax = 0;
  let skippedBadData = 0;
  const named = [];

  for await (const line of lines) {
    if (!line.trim()) continue;
    const fields = splitCsv(line);

    if (!columns) {
      columns = Object.fromEntries(fields.map((name, i) => [name.trim(), i]));
      for (const required of ["x", "y", "z", "absmag", "ci", "mag", "dist", "proper"]) {
        if (columns[required] === undefined) {
          throw new Error(
            `HYG column "${required}" is missing. The upstream schema has changed — ` +
              `fix the mapping rather than guessing at column order.`,
          );
        }
      }
      continue;
    }

    rows++;

    const distance = Number(fields[columns.dist]);
    // The Sun is row 0 at distance 0; it is rendered as the local star, not as a background
    // point, so it is excluded here rather than special-cased in the renderer.
    if (!Number.isFinite(distance) || distance <= 0 || distance >= NO_PARALLAX_DISTANCE_PC) {
      skippedNoParallax++;
      continue;
    }

    const x = Number(fields[columns.x]);
    const y = Number(fields[columns.y]);
    const z = Number(fields[columns.z]);
    const absmag = Number(fields[columns.absmag]);
    const mag = Number(fields[columns.mag]);
    // Colour index is genuinely missing for some stars. Default to roughly solar rather
    // than to zero, which would render a red dwarf as blue-white.
    const ciRaw = fields[columns.ci];
    const ci = ciRaw === "" || ciRaw === undefined ? 0.656 : Number(ciRaw);

    if (![x, y, z, absmag, mag, ci].every(Number.isFinite)) {
      skippedBadData++;
      continue;
    }

    const star = { x, y, z, absmag, ci };
    all.push(star);
    if (mag <= NAKED_EYE_MAGNITUDE) bright.push(star);

    const proper = fields[columns.proper]?.trim();
    if (proper && named.length < 8) named.push(`${proper} (mag ${mag.toFixed(2)})`);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "stars-bright.bin"), encode(bright));
  writeFileSync(join(DATA_DIR, "stars-full.bin"), encode(all));

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  process.stderr.write(
    [
      ``,
      `HYG rows read          ${rows.toLocaleString()}`,
      `  no usable parallax   ${skippedNoParallax.toLocaleString()}`,
      `  unparseable          ${skippedBadData.toLocaleString()}`,
      ``,
      `stars-bright.bin       ${bright.length.toLocaleString()} stars  ` +
        `${kb(HEADER_BYTES + bright.length * BYTES_PER_STAR)}`,
      `stars-full.bin         ${all.length.toLocaleString()} stars  ` +
        `${kb(HEADER_BYTES + all.length * BYTES_PER_STAR)}`,
      ``,
      `sample named stars: ${named.join(", ")}`,
      ``,
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
