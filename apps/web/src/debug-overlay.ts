/**
 * Precision debug overlay.
 *
 * The floating-origin machinery is invisible when it works and produces *subtly* wrong
 * pictures when it does not — geometry that shimmers at the millimetre scale, or a planet
 * that jitters once per second as the camera rebases. Both are easy to mistake for a shader
 * problem and very hard to diagnose without seeing the numbers.
 *
 * So the numbers are available on a keypress. The one that matters most is the local
 * coordinate magnitude: everything handed to Three.js is camera-relative and narrowed to
 * f32, which holds about 7 significant digits, so an offset beyond roughly 1e12 m starts
 * losing metre-scale precision. If that figure climbs, something has stopped rebasing and
 * the picture is about to degrade.
 */

export interface DebugSample {
  /** Id of the frame the camera is currently attached to. */
  frameId: string;
  /** Depth of that frame in the hierarchy. */
  frameDepth: number;
  /** Magnitude of the camera's position within its frame, metres. */
  localMagnitudeM: number;
  /** Largest camera-relative offset handed to Three.js this frame, metres. */
  maxRelativeM: number;
  /** Altitude above the nearest surface, metres. */
  altitudeM: number;
  /** True on the frame a rebase happened. */
  rebasedThisFrame: boolean;
  /** Which depth strategy is running. */
  depthStrategy: string;
  /** Active depth partition index, where partitioned rendering is on. */
  partition: number | null;
  fps: number;
  /**
   * Which star is lighting the scene. Neither light falls off with distance, so the wrong
   * one left on lights a whole system from the wrong direction and nothing on screen says so.
   */
  light?: string;
  /** Body whose atmosphere shell is attached, or "none". */
  atmosphere?: string;
}

export interface DebugOverlay {
  element: HTMLElement;
  update: (sample: DebugSample) => void;
  toggle: () => void;
  readonly visible: boolean;
}

/**
 * Above this, an f32 camera-relative offset can no longer resolve a metre.
 *
 * f32 carries ~24 bits of mantissa, so the representable step at magnitude x is about
 * x / 2^23. At 1e12 m that step is roughly 0.12 m — still fine for a planet seen from
 * orbit, and the point at which the readout turns amber rather than the point at which
 * anything breaks.
 */
export const F32_METRE_PRECISION_LIMIT_M = 1e12;

const format = (metres: number): string => {
  if (!Number.isFinite(metres)) return "—";
  const abs = Math.abs(metres);
  if (abs < 1e3) return `${metres.toFixed(2)} m`;
  if (abs < 1e9) return `${(metres / 1e3).toFixed(2)} km`;
  if (abs < 1e15) return `${(metres / 1.495978707e11).toFixed(4)} AU`;
  return `${(metres / 9.4607e15).toFixed(4)} ly`;
};

export function createDebugOverlay(): DebugOverlay {
  const element = document.createElement("aside");
  element.id = "debug";
  element.style.display = "none";
  let visible = false;

  const row = (key: string, value: string, warn = false): string =>
    `<div class="row"><span class="k">${key}</span><span class="v${warn ? " warn" : ""}">${value}</span></div>`;

  return {
    element,
    update: (s) => {
      if (!visible) return;

      const overLimit = s.maxRelativeM > F32_METRE_PRECISION_LIMIT_M;

      element.innerHTML = `
        <h1>Precision</h1>
        ${row("frame", `${s.frameId} (depth ${s.frameDepth})`)}
        ${row("local coords", format(s.localMagnitudeM))}
        ${row("max relative", format(s.maxRelativeM), overLimit)}
        ${row("altitude", format(s.altitudeM))}
        ${row("rebased", s.rebasedThisFrame ? "this frame" : "no")}
        ${row("depth", s.depthStrategy)}
        ${row("partition", s.partition === null ? "n/a" : String(s.partition))}
        ${row("fps", s.fps.toFixed(0))}
        ${s.light !== undefined ? row("light", s.light) : ""}
        ${s.atmosphere !== undefined ? row("atmosphere", s.atmosphere) : ""}
        ${
          overLimit
            ? `<p class="pv-note pv-warn">Camera-relative offsets exceed ${format(
                F32_METRE_PRECISION_LIMIT_M,
              )}. An f32 upload can no longer resolve a metre here, so expect visible jitter.</p>`
            : ""
        }`;
    },
    toggle: () => {
      visible = !visible;
      element.style.display = visible ? "" : "none";
    },
    get visible() {
      return visible;
    },
  };
}
