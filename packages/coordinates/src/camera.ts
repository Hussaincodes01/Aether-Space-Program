/**
 * Floating-origin camera.
 *
 * The camera sits at the origin and the universe moves around it. Every frame we compute
 * each body's position *relative to the camera* in f64 and hand the GPU only that small
 * offset, so the f32 the shader sees never carries an astronomical magnitude.
 *
 * The camera also rebases: as it descends toward a planet it adopts that planet's frame,
 * keeping its own working coordinates small. Rebasing uses hysteresis, because switching
 * on an exact threshold makes the world pop every time the camera jitters across it.
 */

import { bestFrameFor, createFrame, relativePosition } from "./frame.js";
import type { Frame } from "./frame.js";
import { add, clone, length, scale, sub, vec3 } from "./vec3.js";
import type { Vec3 } from "./vec3.js";

export interface CameraState {
  /** The frame the camera's position is expressed in. */
  frame: Frame;
  /** Position within `frame`, f64 metres. Kept small by rebasing. */
  position: Vec3;
  /** Orientation as a unit quaternion (x, y, z, w). */
  orientation: [number, number, number, number];
}

export function createCamera(frame: Frame, position: Vec3 = vec3()): CameraState {
  return { frame, position: clone(position), orientation: [0, 0, 0, 1] };
}

/**
 * Move the camera into a new frame without moving it in space.
 *
 * The position is re-expressed relative to the new frame; the camera does not shift by so
 * much as a millimetre, which is what makes rebasing invisible to the user.
 */
export function rebase(camera: CameraState, newFrame: Frame): void {
  if (newFrame === camera.frame) return;
  // Where the camera currently is, as seen from the new frame.
  const frameOffset = relativePosition(camera.frame, newFrame);
  camera.position = add(frameOffset, camera.position);
  camera.frame = newFrame;
}

export interface RebaseOptions {
  /** Adopt a child frame when within this multiple of its scale hint. */
  enterFactor?: number;
  /** Fall back to the parent only beyond this multiple — the hysteresis gap. */
  exitFactor?: number;
}

/**
 * Rebase if the camera has moved far enough to warrant it.
 *
 * `exitFactor` must exceed `enterFactor`, or the camera will oscillate between two frames
 * on consecutive frames and the whole scene will shimmer.
 */
export function maybeRebase(
  camera: CameraState,
  sceneRoot: Frame,
  options: RebaseOptions = {},
): boolean {
  const enterFactor = options.enterFactor ?? 4;
  const exitFactor = options.exitFactor ?? 8;
  if (exitFactor <= enterFactor) {
    throw new Error("exitFactor must exceed enterFactor, or rebasing will oscillate");
  }

  const distanceFromOwnFrame = length(camera.position);

  // Still comfortably inside the current frame: stay put.
  if (distanceFromOwnFrame < camera.frame.scaleHintM * exitFactor) {
    const candidate = bestFrameFor(camera.position, camera.frame, enterFactor);
    if (candidate !== camera.frame) {
      rebase(camera, candidate);
      return true;
    }
    return false;
  }

  // Drifted out of the current frame — climb toward the root and re-descend.
  const parent = camera.frame.parent ?? sceneRoot;
  if (parent !== camera.frame) {
    rebase(camera, parent);
    return true;
  }
  return false;
}

/**
 * Position of a body relative to the camera, in f64 metres.
 *
 * This is the value that gets narrowed to f32 and uploaded. Nothing else should be.
 */
export function cameraRelative(camera: CameraState, target: Frame): Vec3 {
  return sub(relativePosition(target, camera.frame), camera.position);
}

/**
 * Movement speed that scales with how far the camera is from the nearest surface.
 *
 * Without this the camera either crawls across a solar system or overshoots a planet in a
 * single frame. Users must never feel they are swimming.
 *
 * @param altitudeM  Height above the nearest surface, metres.
 */
export function scaleAwareSpeed(
  altitudeM: number,
  options: { minSpeedMs?: number; maxSpeedMs?: number; factor?: number } = {},
): number {
  const minSpeed = options.minSpeedMs ?? 2; // walking pace at the surface
  const maxSpeed = options.maxSpeedMs ?? 3e10; // ~100 c, for crossing a system
  const factor = options.factor ?? 0.5;
  return Math.min(Math.max(Math.abs(altitudeM) * factor, minSpeed), maxSpeed);
}

/** Advance the camera along a direction, using scale-aware speed. */
export function moveCamera(
  camera: CameraState,
  directionUnit: Vec3,
  altitudeM: number,
  deltaSeconds: number,
  throttle = 1,
): void {
  const speed = scaleAwareSpeed(altitudeM) * throttle;
  camera.position = add(camera.position, scale(directionUnit, speed * deltaSeconds));
}

/** A scene root suitable for hanging star systems from. */
export function createUniverseRoot(): Frame {
  // Scale hint of ~1 Gly: the camera should essentially never leave this frame.
  return createFrame("universe", 1e25);
}
