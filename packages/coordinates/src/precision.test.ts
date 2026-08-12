import { describe, expect, it } from "vitest";
import { AU, LIGHT_YEAR, earthRadii, solarRadii } from "@aether/units";
import {
  absolutePosition,
  attach,
  buildDepthPartitions,
  cameraRelative,
  createCamera,
  createFrame,
  createUniverseRoot,
  defaultDepthPartitions,
  length,
  lowestCommonAncestor,
  maybeRebase,
  rebase,
  relativePosition,
  scaleAwareSpeed,
  sub,
  vec3,
} from "./index.js";

/**
 * TRAPPIST-1 sits ~40.7 ly away. This mirrors the assertion in the C++ reference
 * implementation's `test_core.cpp`, which validated a 1 m offset surviving at 27 ly.
 */
describe("PRD §14.3 — precision at interstellar distance", () => {
  const buildScene = () => {
    const universe = createUniverseRoot();

    const system = createFrame("system:TRAPPIST-1", AU * 100);
    attach(system, universe, vec3(40.7 * LIGHT_YEAR, 0, 0));

    const planet = createFrame("planet:TRAPPIST-1e", earthRadii(1));
    attach(planet, system, vec3(0.02925 * AU, 0, 0));

    const surface = createFrame("surface:landing-site", 1000);
    attach(surface, planet, vec3(earthRadii(0.92), 0, 0));

    return { universe, system, planet, surface };
  };

  it("preserves a 1 metre offset 40 light-years from the origin", () => {
    const { surface } = buildScene();

    // A rock one metre from the landing site.
    const rock = createFrame("rock", 1);
    attach(rock, surface, vec3(1, 0, 0));

    const observed = relativePosition(rock, surface);
    expect(observed.x).toBeCloseTo(1, 9);
    expect(length(observed)).toBeCloseTo(1, 9);
  });

  it("demonstrates why the hierarchy is necessary — naive absolute subtraction fails", () => {
    const { surface } = buildScene();
    const rock = createFrame("rock", 1);
    attach(rock, surface, vec3(1, 0, 0));

    // The wrong way: resolve both to absolute coordinates, then subtract. At ~3.85e17 m
    // the gap between adjacent representable f64 values is ~64 m, so a one-metre offset
    // rounds away before the subtraction ever happens.
    const naive = sub(absolutePosition(rock), absolutePosition(surface));
    const hierarchical = relativePosition(rock, surface);

    expect(Math.abs(hierarchical.x - 1)).toBeLessThan(1e-9);
    // The metre does not merely lose precision — it vanishes completely, so the error is
    // as large as the quantity being measured.
    expect(Math.abs(naive.x - 1)).toBeGreaterThanOrEqual(1);
    expect(naive.x).toBe(0);
  });

  it("keeps sub-millimetre precision for a two-metre observer height", () => {
    const { surface } = buildScene();
    const eye = createFrame("eye", 1);
    attach(eye, surface, vec3(0, 1.75, 0));

    const observed = relativePosition(eye, surface);
    expect(Math.abs(observed.y - 1.75)).toBeLessThan(1e-9);
  });
});

describe("frame tree", () => {
  it("finds the lowest common ancestor", () => {
    const root = createFrame("root", 1e20);
    const a = attach(createFrame("a", 1e10), root, vec3(1e12, 0, 0));
    const b = attach(createFrame("b", 1e10), root, vec3(-1e12, 0, 0));
    const a1 = attach(createFrame("a1", 1e6), a, vec3(1e8, 0, 0));

    expect(lowestCommonAncestor(a1, b)).toBe(root);
    expect(lowestCommonAncestor(a1, a)).toBe(a);
    expect(lowestCommonAncestor(a, a)).toBe(a);
  });

  it("refuses to relate frames in different trees rather than returning nonsense", () => {
    const orphan = createFrame("orphan", 1);
    const root = createFrame("root", 1e20);
    expect(() => relativePosition(orphan, root)).toThrow(/different trees/);
  });

  it("is antisymmetric", () => {
    const root = createFrame("root", 1e20);
    const a = attach(createFrame("a", 1), root, vec3(3, 4, 5));
    const b = attach(createFrame("b", 1), root, vec3(-1, 2, 7));

    const ab = relativePosition(a, b);
    const ba = relativePosition(b, a);
    expect(ab.x).toBeCloseTo(-ba.x, 12);
    expect(ab.y).toBeCloseTo(-ba.y, 12);
    expect(ab.z).toBeCloseTo(-ba.z, 12);
  });
});

describe("floating-origin camera", () => {
  it("does not move the camera in space when rebasing", () => {
    const universe = createUniverseRoot();
    const system = attach(createFrame("system", AU * 100), universe, vec3(10 * LIGHT_YEAR, 0, 0));
    const planet = attach(createFrame("planet", earthRadii(1)), system, vec3(AU, 0, 0));
    const marker = attach(createFrame("marker", 1), planet, vec3(earthRadii(1), 0, 0));

    const camera = createCamera(planet, vec3(earthRadii(1) + 1000, 0, 0));
    const before = cameraRelative(camera, marker);

    rebase(camera, system);
    const after = cameraRelative(camera, marker);

    // The camera changed frames; it did not change place.
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });

  it("rejects hysteresis settings that would oscillate", () => {
    const universe = createUniverseRoot();
    const camera = createCamera(universe);
    expect(() => maybeRebase(camera, universe, { enterFactor: 8, exitFactor: 4 })).toThrow(
      /oscillate/,
    );
  });
});

describe("scale-aware camera speed", () => {
  it("walks at the surface and crosses a system from orbit", () => {
    const walking = scaleAwareSpeed(0);
    const orbital = scaleAwareSpeed(earthRadii(1));
    const interplanetary = scaleAwareSpeed(AU);

    expect(walking).toBeLessThan(10);
    expect(orbital).toBeGreaterThan(walking);
    expect(interplanetary).toBeGreaterThan(orbital);
  });

  it("is monotonic in altitude, so control never feels inverted", () => {
    const altitudes = [0, 1, 100, 1e4, 1e6, 1e9, 1e12];
    const speeds = altitudes.map((a) => scaleAwareSpeed(a));
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThanOrEqual(speeds[i - 1]!);
    }
  });
});

describe("depth partitioning", () => {
  it("covers the full range without gaps", () => {
    const partitions = buildDepthPartitions(0.1, 1e20, 6);
    expect(partitions[0]!.nearM).toBeCloseTo(0.1, 6);
    expect(partitions[partitions.length - 1]!.farM).toBeCloseTo(1e20, -15);

    // Each partition must start before the previous one ends — the deliberate overlap that
    // stops a primitive straddling a boundary from falling through the crack.
    for (let i = 1; i < partitions.length; i++) {
      expect(partitions[i]!.nearM).toBeLessThan(partitions[i - 1]!.farM);
    }
  });

  it("spans 0.1 m to 1e20 m by default — standing on a planet with the galaxy in frame", () => {
    const partitions = defaultDepthPartitions();
    expect(partitions).toHaveLength(6);
    expect(partitions[0]!.nearM).toBeLessThanOrEqual(0.1);
  });

  it("rejects a degenerate range", () => {
    expect(() => buildDepthPartitions(0, 100, 4)).toThrow(/near plane/);
    expect(() => buildDepthPartitions(100, 10, 4)).toThrow(/far plane/);
  });
});

describe("sanity anchors", () => {
  it("places a solar-radius star and an Earth-radius planet at sane relative scale", () => {
    expect(solarRadii(1) / earthRadii(1)).toBeCloseTo(109.1, 0);
  });
});
