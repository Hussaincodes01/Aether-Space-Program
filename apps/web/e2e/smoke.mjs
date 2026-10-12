/**
 * Browser smoke test.
 *
 * Every defect this file exists for passed the unit suite and a clean build: a far plane
 * that clipped the whole universe, a camera spawned on the night side, exoplanets parked
 * inside their own star, the Sun lighting worlds forty light-years away. None of them is
 * visible to anything short of running the client, so this runs the client.
 *
 * It drives the *built* app in headless Chromium with software WebGL (SwiftShader), so it
 * needs no GPU and behaves the same on a laptop and in CI:
 *
 *   pnpm build:web && pnpm --filter @aether/web test:browser
 *
 * Set CHROMIUM_EXECUTABLE_PATH to use a Chromium other than the one Playwright installed.
 * The rendered canvas at each stop is written to e2e/output/ so a failure can be looked at
 * rather than guessed at.
 *
 * Every check runs and is reported, rather than stopping at the first failure: when several
 * things break at once, the full list is the useful diagnosis.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(APP_DIR, "e2e", "output");

/** Above this an f32 camera-relative offset can no longer resolve a metre. */
const F32_METRE_PRECISION_LIMIT_M = 1e12;

/**
 * Every TRAPPIST-1 planet receives between 0.14 (h) and 4.2 (b) times Earth's insolation,
 * about 190 to 5,700 W/m^2. The band is deliberately wider than that; what it must reject
 * is a readout taken from the wrong star, which is off by six orders of magnitude.
 */
const TRAPPIST_INSOLATION_BAND_WM2 = [100, 10_000];

/**
 * Mean luminance (0..1) the centre of the frame must exceed when a lit world fills it. The
 * failures this guards against -- a clipped scene, an unlit sphere -- measure near zero.
 */
const MIN_LIT_CENTRE_LUMINANCE = 0.03;

/** The host star must put at least one near-white pixel in the middle of the frame. */
const MIN_STAR_PEAK_LUMINANCE = 0.6;

const UNIT_METRES = {
  cm: 0.01,
  m: 1,
  km: 1e3,
  Mm: 1e6,
  Gm: 1e9,
  AU: 1.495978707e11,
  ly: 9.4607304725808e15,
};

/** Parse a HUD distance such as "18.496 Mm" or "0.02617 AU" back into metres. */
function parseDistance(text) {
  const match = /^(-?[\d.]+)\s*(cm|m|km|Mm|Gm|AU|ly)$/.exec(text.trim());
  return match ? Number(match[1]) * UNIT_METRES[match[2]] : NaN;
}

/** Parse "883.2 W/m²"; "unknown" and anything else becomes NaN. */
function parseIrradiance(text) {
  const match = /^([\d.]+)\s*W\/m²$/.exec(text.trim());
  return match ? Number(match[1]) : NaN;
}

const results = [];

function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

/** The HUD as a key -> value map, plus its heading and blurb. */
async function readPanel(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const rows = {};
    for (const row of root?.querySelectorAll(".row") ?? []) {
      const spans = row.querySelectorAll("span");
      if (spans.length >= 2) rows[spans[0].textContent.trim()] = spans[1].textContent.trim();
    }
    return {
      heading: root?.querySelector("h1")?.textContent.trim() ?? "",
      blurb: root?.querySelector(".blurb")?.textContent.trim() ?? "",
      rows,
    };
  }, selector);
}

/** Resolve after `count` animation frames, however slow software rendering makes them. */
async function waitFrames(page, count) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/**
 * Read the WebGL canvas back and measure it.
 *
 * The callback is registered after the app's own frame callback, so it runs in the same
 * frame, after the scene is drawn and before the drawing buffer is presented and cleared.
 * That reads the canvas itself rather than a page screenshot, so DOM panels and the capture
 * prompt cannot affect the numbers -- and it avoids the compositor, which under software
 * rendering can take longer than a screenshot is allowed to wait.
 */
async function sampleCanvas(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const source = document.querySelector("canvas");
          const full = document.createElement("canvas");
          full.width = source.width;
          full.height = source.height;
          const ctx = full.getContext("2d");
          ctx.drawImage(source, 0, 0);
          const { data, width, height } = ctx.getImageData(0, 0, full.width, full.height);

          // The central fifth of the frame, which is where the camera is pointed.
          const x0 = Math.floor(width * 0.4);
          const x1 = Math.ceil(width * 0.6);
          const y0 = Math.floor(height * 0.4);
          const y1 = Math.ceil(height * 0.6);
          let sum = 0;
          let peak = 0;
          let n = 0;
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const i = (y * width + x) * 4;
              const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
              sum += l;
              if (l > peak) peak = l;
              n++;
            }
          }
          resolve({ centreMean: sum / n, centrePeak: peak, png: full.toDataURL("image/png") });
        });
      }),
  );
}

async function saveFrame(sample, name) {
  const base64 = sample.png.replace(/^data:image\/png;base64,/, "");
  await writeFile(join(OUTPUT_DIR, `${name}.png`), Buffer.from(base64, "base64"));
}

async function main() {
  if (!existsSync(join(APP_DIR, "dist", "index.html"))) {
    console.error("No build found at apps/web/dist. Run `pnpm build:web` first.");
    process.exit(2);
  }
  await mkdir(OUTPUT_DIR, { recursive: true });

  // `open: false` matters: the Vite config opens a browser for `pnpm dev`, and preview
  // inherits that unless told otherwise.
  const server = await preview({
    root: APP_DIR,
    logLevel: "warn",
    preview: { port: 4319, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local[0];

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });

  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // Software WebGL renders a frame in anything from milliseconds to seconds.
    page.setDefaultTimeout(180_000);
    page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        problems.push(`HTTP ${response.status()}: ${response.url()}`);
    });

    console.log(`Aether smoke test against ${url}\n`);
    await page.goto(url, { waitUntil: "load" });

    // Ready means the star catalogue has streamed in and the exoplanet map can be searched.
    await page.waitForFunction(() =>
      /stars\s*[\d,]+/.test(document.getElementById("hud")?.innerText ?? ""),
    );
    await page.waitForFunction(
      () => document.querySelector('input.search[placeholder*="systems"]') !== null,
    );

    // The precision overlay carries the diagnostics read below.
    await page.keyboard.press("KeyG");
    await waitFrames(page, 3);

    // ── Launch: low Earth orbit ─────────────────────────────────────────────────────────
    console.log("Launch, Earth orbit");
    const home = await readPanel(page, "#hud");
    const homeDebug = await readPanel(page, "#debug");
    const homeFrame = await sampleCanvas(page);
    await saveFrame(homeFrame, "01-earth");

    check("HUD names Earth", /earth/i.test(home.heading), home.heading);
    const homeLocal = parseDistance(home.rows["local coords"] ?? "");
    check(
      "camera-local coordinates stay inside f32 metre precision",
      homeLocal < F32_METRE_PRECISION_LIMIT_M,
      home.rows["local coords"],
    );
    check(
      "Earth fills the centre of the frame and is lit",
      homeFrame.centreMean > MIN_LIT_CENTRE_LUMINANCE,
      `centre luminance ${homeFrame.centreMean.toFixed(3)}`,
    );
    check("the Sun is the light source", homeDebug.rows.light === "Sun", homeDebug.rows.light);
    check(
      "Earth draws its atmosphere",
      homeDebug.rows.atmosphere === "Earth",
      homeDebug.rows.atmosphere ?? "row missing",
    );

    // ── Interstellar travel: TRAPPIST-1 ──────────────────────────────────────────────────
    console.log("\nTravel to TRAPPIST-1");
    await page.keyboard.press("KeyK");
    await page.locator('input.search[placeholder*="systems"]').fill("TRAPPIST-1");
    await page.locator("button.system", { hasText: "TRAPPIST-1" }).first().click();
    await page.evaluate(() =>
      document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined,
    );
    await page.waitForFunction(() =>
      /TRAPPIST-1 ·/.test(document.getElementById("hud")?.innerText ?? ""),
    );
    await waitFrames(page, 5);

    const away = await readPanel(page, "#hud");
    const awayDebug = await readPanel(page, "#debug");
    const awayFrame = await sampleCanvas(page);
    await saveFrame(awayFrame, "02-trappist-1");

    check("HUD is in the TRAPPIST-1 system", /TRAPPIST-1/.test(away.blurb), away.heading);
    const awayLocal = parseDistance(away.rows["local coords"] ?? "");
    check(
      "camera-local coordinates stay inside f32 metre precision",
      awayLocal < F32_METRE_PRECISION_LIMIT_M,
      away.rows["local coords"],
    );

    const starlight = parseIrradiance(away.rows.starlight ?? "");
    const [low, high] = TRAPPIST_INSOLATION_BAND_WM2;
    check(
      "starlight is read from TRAPPIST-1, not from the Sun",
      starlight >= low && starlight <= high,
      away.rows.starlight !== undefined
        ? `starlight ${away.rows.starlight}`
        : `no starlight row; sunlight ${away.rows.sunlight ?? "missing"}`,
    );
    check(
      "the Sun no longer lights another star's planets",
      /TRAPPIST-1/.test(awayDebug.rows.light ?? "") &&
        !/^Sun$/.test(awayDebug.rows.light ?? ""),
      awayDebug.rows.light ?? "row missing",
    );
    check(
      "the host star is drawn where the camera is pointed",
      awayFrame.centrePeak > MIN_STAR_PEAK_LUMINANCE,
      `centre peak ${awayFrame.centrePeak.toFixed(3)}`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }

  check(
    "no page errors, console errors or failed requests",
    problems.length === 0,
    problems.join(" | "),
  );

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed. Frames: ${OUTPUT_DIR}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
