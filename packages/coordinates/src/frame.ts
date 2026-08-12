/**
 * Hierarchical reference frames.
 *
 * The observable range this product spans is ~27 orders of magnitude — a rock at your feet
 * next to a star 40 light-years away. No single linear coordinate system survives that:
 * subtracting two huge, nearly-equal doubles annihilates the low-order bits
 * (catastrophic cancellation), and f64 runs out at ~15-16 significant digits.
 *
 * The fix is to never form the huge numbers in the first place. Every frame stores its
 * position *relative to its parent*, so each individual offset is small and f64 holds it
 * exactly. To relate two frames we walk to their lowest common ancestor and difference
 * there — so the only large-magnitude subtraction happens between genuinely distant
 * frames, exactly where sub-metre precision is irrelevant.
 *
 * Precision is therefore automatically highest wherever the camera actually is.
 *
 *     universe
 *       └── system:TRAPPIST-1        2.4e17 m from origin
 *             └── planet:TRAPPIST-1e 4.4e9 m from the star
 *                   └── region       6.4e6 m from the planet centre
 *                         └── tile   1e4 m from the region
 */

import { add, clone, sub, vec3 } from "./vec3.js";
import type { Vec3 } from "./vec3.js";

export type FrameId = string;

export interface Frame {
  readonly id: FrameId;
  /** Position relative to the parent frame, in metres. Small by construction. */
  position: Vec3;
  parent: Frame | null;
  readonly children: Frame[];
  /**
   * Approximate radius of what this frame contains, in metres. Used to pick a rebasing
   * target and to choose depth partitions — not for culling.
   */
  scaleHintM: number;
}

export function createFrame(id: FrameId, scaleHintM = 1): Frame {
  return { id, position: vec3(), parent: null, children: [], scaleHintM };
}

export function attach(child: Frame, parent: Frame, positionInParent: Vec3): Frame {
  if (child.parent) detach(child);
  child.parent = parent;
  child.position = clone(positionInParent);
  parent.children.push(child);
  return child;
}

export function detach(child: Frame): void {
  if (!child.parent) return;
  const siblings = child.parent.children;
  const i = siblings.indexOf(child);
  if (i >= 0) siblings.splice(i, 1);
  child.parent = null;
}

/** Chain from `frame` up to the root, root last. */
function ancestry(frame: Frame): Frame[] {
  const chain: Frame[] = [];
  let node: Frame | null = frame;
  while (node) {
    chain.push(node);
    node = node.parent;
  }
  return chain;
}

/**
 * Lowest common ancestor of two frames, or null if they belong to different trees.
 *
 * Linear in depth, and depths here are single digits, so the obvious algorithm is the
 * right one — a set-based version would allocate on every call in the hot path.
 */
export function lowestCommonAncestor(a: Frame, b: Frame): Frame | null {
  const chainA = ancestry(a);
  const chainB = ancestry(b);
  const seen = new Set(chainB);
  for (const node of chainA) {
    if (seen.has(node)) return node;
  }
  return null;
}

/**
 * Position of `target` in the coordinate system of `observer`, in f64 metres.
 *
 * This is the single most important function in the package. Accumulation happens in two
 * short chains that each stay near the magnitude of their own frame, and the only
 * subtraction of large values is between the two sides at the LCA.
 */
export function relativePosition(target: Frame, observer: Frame): Vec3 {
  if (target === observer) return vec3();

  const lca = lowestCommonAncestor(target, observer);
  if (!lca) {
    throw new Error(
      `Frames "${target.id}" and "${observer.id}" are in different trees and cannot be ` +
        `related. Attach both under a common root before resolving.`,
    );
  }

  // Offset of each frame from the LCA, accumulated in its own local magnitude range.
  const offsetFromLca = (frame: Frame): Vec3 => {
    let acc = vec3();
    let node: Frame | null = frame;
    while (node && node !== lca) {
      acc = add(acc, node.position);
      node = node.parent;
    }
    return acc;
  };

  return sub(offsetFromLca(target), offsetFromLca(observer));
}

/** Absolute position relative to the tree root. Diagnostics only — it destroys precision. */
export function absolutePosition(frame: Frame): Vec3 {
  let acc = vec3();
  let node: Frame | null = frame;
  while (node) {
    acc = add(acc, node.position);
    node = node.parent;
  }
  return acc;
}

export function root(frame: Frame): Frame {
  let node = frame;
  while (node.parent) node = node.parent;
  return node;
}

export function depth(frame: Frame): number {
  let d = 0;
  let node: Frame | null = frame.parent;
  while (node) {
    d++;
    node = node.parent;
  }
  return d;
}

/**
 * Choose the frame the camera should rebase into: the deepest frame containing the camera
 * within a few of its own scale hints.
 *
 * Hysteresis is applied by the caller (see `camera.ts`) — switching frames on an exact
 * threshold produces a visible pop every time the camera jitters across it.
 */
export function bestFrameFor(cameraPosition: Vec3, from: Frame, factor = 4): Frame {
  let best = from;
  const visit = (frame: Frame, positionInFrame: Vec3): void => {
    const r = Math.hypot(positionInFrame.x, positionInFrame.y, positionInFrame.z);
    if (r < frame.scaleHintM * factor && depth(frame) >= depth(best)) {
      best = frame;
    }
    for (const child of frame.children) {
      visit(child, sub(positionInFrame, child.position));
    }
  };
  visit(from, cameraPosition);
  return best;
}
