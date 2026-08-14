/**
 * Free-flight camera, ported from the C++ reference implementation's flight model.
 *
 * ## Why the previous model could not get anywhere
 *
 * The first version derived speed *from altitude* and treated the throttle as a small
 * multiplier on top. That inverts the relationship: near Earth the altitude is ~10,000 km,
 * so speed was pinned around 5,000 km/s and the wheel could not meaningfully change it.
 * Reaching Mars took hours of real time.
 *
 * The C++ engine does the opposite, and it is right: **throttle is the control, altitude is
 * only the ceiling.**
 *
 *   speed  — persistent, in m/s, multiplied by 1.25 per wheel notch
 *   max    — nearestSurfaceDistance * 2, so you can always cross the gap ahead in ~0.5 s
 *   min    — 0.1 m/s, slow enough to inspect a rock
 *
 * The ceiling rises as you climb away from a surface, so accelerating outward keeps
 * working, and it collapses as you approach one, which stops you flying through a planet.
 * Speed is retained rather than recomputed, so the throttle is a setting you fly with
 * rather than something the terrain decides for you.
 */

import * as THREE from "three";
import type { CameraState } from "@aether/coordinates";

export interface ControlState {
  /** Current throttle in metres per second. Persistent across frames. */
  speedMs: number;
  /** Speed actually achieved last frame, for the HUD. */
  actualSpeedMs: number;
  pointerLocked: boolean;
}

const KEY_BINDINGS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  up: "KeyR",
  down: "KeyF",
  rollLeft: "KeyQ",
  rollRight: "KeyE",
  boost: "ShiftLeft",
  brake: "Space",
} as const;

/** Slow enough to examine something at arm's length. */
const MIN_SPEED_MS = 0.1;
/** Absolute ceiling regardless of altitude — about 30 light-years per second. */
const ABSOLUTE_MAX_SPEED_MS = 3e17;

export function createControls(canvas: HTMLCanvasElement): {
  state: ControlState;
  update: (
    camera: CameraState,
    threeCamera: THREE.Camera,
    nearestSurfaceDistanceM: number,
    dt: number,
  ) => void;
  /** Aim along a direction, snapping rather than easing. Used on spawn and on arrival. */
  lookAt: (dx: number, dy: number, dz: number) => void;
  dispose: () => void;
} {
  const state: ControlState = {
    speedMs: 1e7,
    actualSpeedMs: 0,
    pointerLocked: false,
  };
  const pressed = new Set<string>();

  // Yaw, pitch and roll tracked separately and recomposed each frame. Accumulating straight
  // into a quaternion drifts and eventually tilts the horizon for no visible reason.
  let targetYaw = 0;
  let targetPitch = 0;
  let roll = 0;
  let yaw = 0;
  let pitch = 0;

  const onKeyDown = (e: KeyboardEvent): void => {
    pressed.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    pressed.delete(e.code);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!state.pointerLocked) return;
    const sensitivity = 0.0022;
    targetYaw -= e.movementX * sensitivity;
    targetPitch -= e.movementY * sensitivity;
    const limit = Math.PI / 2 - 0.001;
    targetPitch = Math.min(Math.max(targetPitch, -limit), limit);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Multiplicative, exactly as the C++ engine does it: a fixed number of notches always
    // changes speed by the same factor, whether you are crawling or crossing a system.
    state.speedMs *= Math.pow(1.25, e.deltaY > 0 ? -1 : 1);
  };

  const overlay = document.getElementById("click-to-start");
  const overlayMessage = overlay?.querySelector("span");

  const setOverlay = (visible: boolean, message?: string): void => {
    if (!overlay) return;
    overlay.style.display = visible ? "grid" : "none";
    if (overlayMessage && message) overlayMessage.textContent = message;
  };

  const onPointerLockChange = (): void => {
    state.pointerLocked = document.pointerLockElement === canvas;
    setOverlay(!state.pointerLocked, "Click to capture mouse");
  };

  /**
   * Browsers reject a lock requested too soon after Escape released the previous one, and
   * they reject silently unless this fires. Without it the overlay just sits there looking
   * unresponsive with no explanation.
   */
  const onPointerLockError = (): void => {
    setOverlay(true, "Mouse capture blocked - wait a moment and click again");
  };

  const onClick = (): void => {
    if (state.pointerLocked) return;
    const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (request && typeof request.catch === "function") {
      request.catch(() => onPointerLockError());
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onPointerLockError);
  // Listen on the canvas, not the overlay. The overlay is `pointer-events: none` so clicks
  // fall through to it — otherwise the overlay swallows the very click meant to dismiss it.
  canvas.addEventListener("click", onClick);

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const move = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  /**
   * Frame-rate-independent smoothing expressed as a half-life.
   *
   * The usual `value += (target - value) * 0.1` is tied to frame rate and feels sluggish at
   * 30 fps and twitchy at 144. This behaves identically at any rate.
   */
  const smooth = (
    current: number,
    target: number,
    halfLifeSeconds: number,
    dt: number,
  ): number => {
    const k = 1 - Math.pow(2, -dt / halfLifeSeconds);
    return current + (target - current) * k;
  };

  const update = (
    camera: CameraState,
    threeCamera: THREE.Camera,
    nearestSurfaceDistanceM: number,
    dt: number,
  ): void => {
    // Look: chase the raw pointer target. ~28 ms absorbs polling jitter without feeling laggy.
    yaw = smooth(yaw, targetYaw, 0.028, dt);
    pitch = smooth(pitch, targetPitch, 0.028, dt);

    if (pressed.has(KEY_BINDINGS.rollLeft)) roll += dt * 1.2;
    if (pressed.has(KEY_BINDINGS.rollRight)) roll -= dt * 1.2;

    euler.set(pitch, yaw, roll);
    threeCamera.quaternion.setFromEuler(euler);

    forward.set(0, 0, -1).applyQuaternion(threeCamera.quaternion);
    right.set(1, 0, 0).applyQuaternion(threeCamera.quaternion);
    up.set(0, 1, 0).applyQuaternion(threeCamera.quaternion);

    // Throttle ceiling: cross the gap to whatever is nearest in about half a second. Rises
    // as you climb away from a surface, collapses as you approach one.
    const maxSpeed = Math.min(Math.max(nearestSurfaceDistanceM, 1) * 2, ABSOLUTE_MAX_SPEED_MS);
    state.speedMs = Math.min(Math.max(state.speedMs, MIN_SPEED_MS), maxSpeed);

    move.set(0, 0, 0);
    if (pressed.has(KEY_BINDINGS.forward)) move.add(forward);
    if (pressed.has(KEY_BINDINGS.back)) move.sub(forward);
    if (pressed.has(KEY_BINDINGS.right)) move.add(right);
    if (pressed.has(KEY_BINDINGS.left)) move.sub(right);
    if (pressed.has(KEY_BINDINGS.up)) move.add(up);
    if (pressed.has(KEY_BINDINGS.down)) move.sub(up);

    if (pressed.has(KEY_BINDINGS.brake)) {
      // A hard brake matters at these speeds: at 1e12 m/s a moment's inattention puts you
      // outside the system entirely.
      state.speedMs = Math.max(state.speedMs * 0.02, MIN_SPEED_MS);
    }

    if (move.lengthSq() === 0) {
      state.actualSpeedMs = 0;
      return;
    }

    move.normalize();
    const boost = pressed.has(KEY_BINDINGS.boost) ? 8 : 1;
    const step = state.speedMs * boost * dt;
    state.actualSpeedMs = state.speedMs * boost;

    // The f64 position is the authority. Three.js never learns where the camera is.
    camera.position.x += move.x * step;
    camera.position.y += move.y * step;
    camera.position.z += move.z * step;
  };

  const dispose = (): void => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("wheel", onWheel);
    document.removeEventListener("pointerlockchange", onPointerLockChange);
    document.removeEventListener("pointerlockerror", onPointerLockError);
    canvas.removeEventListener("click", onClick);
  };

  /**
   * Aim the camera along a direction.
   *
   * Inverts the same Euler convention `update` composes with (YXZ, forward = -Z), so the
   * heading it produces is exactly what the flight model would have had to be turned to.
   */
  const lookAt = (dx: number, dy: number, dz: number): void => {
    const length = Math.hypot(dx, dy, dz);
    if (length === 0) return;
    const x = dx / length;
    const y = dy / length;
    const z = dz / length;

    targetPitch = Math.asin(Math.min(Math.max(y, -1), 1));
    targetYaw = Math.atan2(-x, -z);
    // Snap rather than ease: this is used on arrival, and easing across a jump would swing
    // the view through whatever happens to lie between two unrelated headings.
    pitch = targetPitch;
    yaw = targetYaw;
  };

  return { state, update, lookAt, dispose };
}
