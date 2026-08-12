/**
 * Telemetry readout.
 *
 * The scale readout is the point of the spike: watching the units count down
 * AU -> Gm -> km -> m while the frame rebases underneath is how you tell whether the
 * traversal is actually continuous.
 */

import { AU, LIGHT_YEAR, toAstronomicalUnits } from "@aether/units";
import { WATERMARK_TEXT } from "@aether/schema";

/** Format a distance in whichever unit a human would actually use at that magnitude. */
export function formatDistance(metres: number): string {
  const m = Math.abs(metres);
  if (m >= LIGHT_YEAR) return `${(metres / LIGHT_YEAR).toFixed(3)} ly`;
  if (m >= 0.01 * AU) return `${toAstronomicalUnits(metres as never).toFixed(5)} AU`;
  if (m >= 1e9) return `${(metres / 1e9).toFixed(3)} Gm`;
  if (m >= 1e6) return `${(metres / 1e6).toFixed(3)} Mm`;
  if (m >= 1000) return `${(metres / 1000).toFixed(3)} km`;
  if (m >= 1) return `${metres.toFixed(2)} m`;
  return `${(metres * 100).toFixed(1)} cm`;
}

export function formatSpeed(metresPerSecond: number): string {
  const c = 299_792_458;
  if (metresPerSecond >= c) return `${(metresPerSecond / c).toFixed(2)} c`;
  if (metresPerSecond >= 1000) return `${(metresPerSecond / 1000).toFixed(1)} km/s`;
  return `${metresPerSecond.toFixed(2)} m/s`;
}

export interface HudData {
  frameId: string;
  frameDepth: number;
  altitudeM: number;
  distanceToStarM: number;
  speedMs: number;
  throttle: number;
  fps: number;
  localPositionMagnitudeM: number;
  rebasedThisFrame: boolean;
  /** 0..1 — how much of the rendered world is inferred rather than measured. */
  speculationFraction: number;
}

const row = (key: string, value: string, cls = "v"): string =>
  `<div class="row"><span class="k">${key}</span><span class="${cls}">${value}</span></div>`;

export function renderHud(data: HudData): void {
  const hud = document.getElementById("hud");
  if (!hud) return;

  // Working-coordinate magnitude is the diagnostic that matters. If rebasing is doing its
  // job this stays small no matter where in the universe the camera is; if it climbs into
  // the 1e12+ range, f32 upload will start to visibly jitter.
  const local = data.localPositionMagnitudeM;
  const localHealth = local < 1e12 ? "ok" : "warn";

  hud.innerHTML = [
    "<h1>Precision Spike — TRAPPIST-1</h1>",
    row("frame", `${data.frameId} (depth ${data.frameDepth})`),
    row("local coords", formatDistance(local), localHealth),
    row("altitude", formatDistance(data.altitudeM)),
    row("to star", formatDistance(data.distanceToStarM)),
    row("speed", formatSpeed(data.speedMs)),
    row("throttle", `${data.throttle.toFixed(3)}x`),
    row("fps", data.fps.toFixed(0), data.fps >= 55 ? "ok" : "warn"),
    row("speculation", `${(data.speculationFraction * 100).toFixed(0)}%`, "warn"),
    data.rebasedThisFrame ? row("", "rebased", "ok") : "",
  ].join("");
}

export function renderWatermark(): void {
  const el = document.getElementById("watermark");
  // The real thing burns this into the framebuffer, where the UI cannot remove it. Here it
  // is DOM text, so the requirement is visible from day one rather than retrofitted.
  if (el) el.textContent = WATERMARK_TEXT;
}
