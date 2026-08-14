/**
 * Scene assembly checks.
 *
 * These run without a WebGL context: Three builds its object graph on the CPU and only the
 * renderer needs a GPU, so the parts that actually go wrong when bodies are added — frame
 * parenting, duplicate ids, rings attached to the wrong planet — are all testable here.
 *
 * This exists because "the tests pass" and "the thing renders" have already diverged once in
 * this project. A scene that compiles and contains nothing still compiles.
 */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { SOLAR_SYSTEM, getBody } from "@aether/solar-system";
import { relativePosition } from "@aether/coordinates";
import { buildSolarScene } from "./solar-scene.js";

const scene = buildSolarScene(0);

describe("every catalogued body reaches the scene", () => {
  it("builds one entry per body", () => {
    expect(scene.bodies.size).toBe(SOLAR_SYSTEM.length);
    for (const body of SOLAR_SYSTEM) {
      expect(scene.bodies.get(body.id), `${body.id} missing from scene`).toBeDefined();
    }
  });

  it("gives every body a mesh scaled to its real radius", () => {
    for (const entry of scene.bodies.values()) {
      expect(entry.mesh.scale.x).toBeCloseTo(entry.data.radiusM, -3);
    }
  });

  it("gives every body but the Sun an orbit line", () => {
    for (const entry of scene.bodies.values()) {
      if (entry.data.id === "sun") continue;
      expect(entry.orbitLine, `${entry.data.id} has no orbit line`).toBeDefined();
    }
  });
});

describe("frames are parented to the right body, not flattened onto the Sun", () => {
  it("attaches moons to their planet", () => {
    for (const id of ["io", "titan", "triton", "moon", "charon"]) {
      const entry = scene.bodies.get(id)!;
      const parent = scene.bodies.get(entry.data.parentId!)!;
      expect(entry.frame.parent, `${id} parent frame`).toBe(parent.frame);
    }
  });

  it("puts Io within a Jupiter orbit's distance of Jupiter, not of the Sun", () => {
    // The check that catches a moon accidentally parented to the Sun: heliocentric
    // coordinates would put Io 5 AU from Jupiter rather than 422,000 km.
    const io = scene.bodies.get("io")!;
    const jupiter = scene.bodies.get("jupiter")!;
    const offset = relativePosition(io.frame, jupiter.frame);
    const d = Math.hypot(offset.x, offset.y, offset.z);
    expect(d).toBeGreaterThan(4.0e8);
    expect(d).toBeLessThan(4.4e8);
  });

  it("keeps Charon within 20,000 km of Pluto", () => {
    const offset = relativePosition(
      scene.bodies.get("charon")!.frame,
      scene.bodies.get("pluto")!.frame,
    );
    expect(Math.hypot(offset.x, offset.y, offset.z)).toBeLessThan(2.0e7);
  });
});

describe("rings", () => {
  it("exist for exactly the four giants", () => {
    const withRings = [...scene.bodies.values()]
      .filter((b) => b.rings)
      .map((b) => b.data.id)
      .sort();
    expect(withRings).toEqual(["jupiter", "neptune", "saturn", "uranus"]);
  });

  it("gives Saturn a ring wider than Saturn", () => {
    const rings = scene.bodies.get("saturn")!.rings!;
    const geometry = rings.geometry;
    geometry.computeBoundingSphere();
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(getBody("saturn")!.radiusM);
  });
});
