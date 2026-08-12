/**
 * Depth precision across astronomical dynamic range.
 *
 * A single depth buffer cannot span 0.1 m to 1e20 m. Three cooperating techniques:
 *
 *  1. **Reversed-Z** — map near to 1.0 and far to 0.0. Because f32 has far more precision
 *     near zero, and 1/z already concentrates precision near the camera, reversing them
 *     cancels out and distributes precision almost uniformly. Preferred on WebGPU.
 *  2. **Logarithmic depth** — the WebGL2 fallback. Must be applied per-*fragment*: doing it
 *     per-vertex interpolates wrongly across large triangles, which is exactly the bug the
 *     C++ reference implementation hit and listed as its top outstanding item.
 *  3. **Cascaded frusta** — render distant, mid and near ranges in separate passes with
 *     their own near/far planes into one framebuffer. This is what actually makes 20+
 *     orders of magnitude work; the first two only buy a few orders each.
 */

export interface DepthPartition {
  nearM: number;
  farM: number;
  /** Draw order: highest index first, so nearer passes overwrite. */
  index: number;
}

/**
 * Build logarithmically-spaced depth partitions.
 *
 * Each partition covers a fixed *ratio* of range rather than a fixed distance, because
 * depth precision is scale-relative. Adjacent partitions overlap slightly so a primitive
 * straddling a boundary is drawn in both rather than falling through the crack.
 */
export function buildDepthPartitions(
  nearM: number,
  farM: number,
  count: number,
  overlap = 1.05,
): DepthPartition[] {
  if (nearM <= 0) throw new Error("near plane must be positive");
  if (farM <= nearM) throw new Error("far plane must exceed near plane");
  if (count < 1) throw new Error("need at least one partition");

  const ratio = Math.pow(farM / nearM, 1 / count);
  const partitions: DepthPartition[] = [];
  for (let i = 0; i < count; i++) {
    const partNear = nearM * Math.pow(ratio, i);
    const partFar = partNear * ratio * overlap;
    partitions.push({ nearM: partNear, farM: Math.min(partFar, farM), index: i });
  }
  return partitions;
}

/**
 * Default partitioning for a system-to-surface scene.
 *
 * 0.1 m to 1e20 m in six partitions — enough to stand on a planet and see the galactic
 * background in the same frame.
 */
export function defaultDepthPartitions(): DepthPartition[] {
  return buildDepthPartitions(0.1, 1e20, 6);
}

/**
 * Reversed-Z projection matrix, column-major, for a right-handed view space looking down
 * -Z. Maps near to 1 and far to 0.
 *
 * Pair with a depth clear of 0.0 and a `greater` depth test.
 */
export function reversedZPerspective(
  fovYRadians: number,
  aspect: number,
  nearM: number,
  farM: number,
): Float32Array {
  const f = 1 / Math.tan(fovYRadians / 2);
  const range = nearM - farM;

  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0,                     0,
    0,          f, 0,                     0,
    0,          0, -farM / range - 1,    -1,
    0,          0, -(nearM * farM) / range, 0,
  ]);
}

/**
 * Infinite reversed-Z projection — no far plane at all.
 *
 * The cleanest option when the scene has no meaningful far bound, which is the usual case
 * once a galactic background is in view.
 */
export function infiniteReversedZPerspective(
  fovYRadians: number,
  aspect: number,
  nearM: number,
): Float32Array {
  const f = 1 / Math.tan(fovYRadians / 2);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0,  0,
    0,          f, 0,  0,
    0,          0, 0, -1,
    0,          0, nearM, 0,
  ]);
}

/**
 * Coefficient for the logarithmic-depth fallback:
 *   `FC = 2 / log2(far + 1)`
 * The fragment shader then writes `log2(max(1e-6, w + 1)) * FC * 0.5`.
 */
export function logDepthCoefficient(farM: number): number {
  return 2 / Math.log2(farM + 1);
}

/**
 * Pick the partition a camera-relative distance belongs to, so a body can be assigned to
 * the correct pass.
 */
export function partitionFor(
  distanceM: number,
  partitions: readonly DepthPartition[],
): DepthPartition | undefined {
  return partitions.find((p) => distanceM >= p.nearM && distanceM <= p.farM);
}
