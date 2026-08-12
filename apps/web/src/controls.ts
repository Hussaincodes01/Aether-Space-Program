/**
 * Pointer-lock flight controls with scale-aware speed.
 *
 * The camera never translates in Three.js — it sits at the origin permanently. Movement
 * mutates the f64 position held in `CameraState`; only orientation reaches Three.
 */

import * as THREE from "three";
import { scaleAwareSpeed, type CameraState } from "@aether/coordinates";

export interface ControlState {
  /** Multiplier on scale-aware speed, adjusted with the wheel. */
  throttle: number;
  pointerLocked: boolean;
}

const KEY_BINDINGS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  up: "KeyR",
  down: "KeyF",
  boost: "ShiftLeft",
} as const;

export function createControls(canvas: HTMLCanvasElement): {
  state: ControlState;
  update: (camera: CameraState, threeCamera: THREE.Camera, altitudeM: number, dt: number) => void;
  dispose: () => void;
} {
  const state: ControlState = { throttle: 1, pointerLocked: false };
  const pressed = new Set<string>();

  // Yaw/pitch tracked separately and recomposed each frame — accumulating into a quaternion
  // drifts and eventually rolls the horizon.
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
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
    // Clamp just short of vertical; exactly vertical loses the yaw reference.
    const limit = Math.PI / 2 - 0.001;
    pitch = Math.min(Math.max(pitch, -limit), limit);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    state.throttle = Math.min(Math.max(state.throttle * (e.deltaY > 0 ? 0.8 : 1.25), 0.001), 1000);
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
   * Browsers reject a lock request made too soon after Escape released the previous one,
   * and they reject silently unless this fires. Without it the overlay just sits there
   * looking unresponsive with no explanation.
   */
  const onPointerLockError = (): void => {
    setOverlay(true, "Mouse capture blocked - wait a moment and click again");
  };

  const onClick = (): void => {
    if (state.pointerLocked) return;
    const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    // Older browsers return void; newer ones return a promise that can reject.
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
  // fall through to the canvas beneath it — otherwise the overlay would swallow the very
  // click that is meant to dismiss it, and the prompt could never be satisfied.
  canvas.addEventListener("click", onClick);

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const move = new THREE.Vector3();

  const update = (
    camera: CameraState,
    threeCamera: THREE.Camera,
    altitudeM: number,
    dt: number,
  ): void => {
    threeCamera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

    forward.set(0, 0, -1).applyQuaternion(threeCamera.quaternion);
    right.set(1, 0, 0).applyQuaternion(threeCamera.quaternion);

    move.set(0, 0, 0);
    if (pressed.has(KEY_BINDINGS.forward)) move.add(forward);
    if (pressed.has(KEY_BINDINGS.back)) move.sub(forward);
    if (pressed.has(KEY_BINDINGS.right)) move.add(right);
    if (pressed.has(KEY_BINDINGS.left)) move.sub(right);
    if (pressed.has(KEY_BINDINGS.up)) move.add(up);
    if (pressed.has(KEY_BINDINGS.down)) move.sub(up);

    if (move.lengthSq() === 0) return;
    move.normalize();

    // Speed proportional to altitude: walking pace at the surface, interplanetary in
    // space. Without this the camera either crawls across a system or overshoots a planet
    // between two frames.
    const boost = pressed.has(KEY_BINDINGS.boost) ? 8 : 1;
    const speed = scaleAwareSpeed(altitudeM) * state.throttle * boost;
    const step = speed * dt;

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

  return { state, update, dispose };
}
