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

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SOLAR_SYSTEM, getBody } from "@aether/solar-system";
import { relativePosition } from "@aether/coordinates";
import { buildSolarScene, collisionRadiusM, isLandable } from "./solar-scene.js";
import { createStarfield } from "./starfield.js";
import { createDeepSkyLayer } from "./deepsky-layer.js";
import { createExoplanetLayer } from "./exoplanet-layer.js";
import { DISCARD_OFFSCREEN_POINT } from "./point-sprite.js";

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

/**
 * Base truth: planets are solid and opaque.
 *
 * Stated as tests because it is a property of this project rather than a library default.
 * The symptom that produced these was every planet in the Solar System reading as
 * see-through, and the cause was not the planets: the three point layers drew over them with
 * depth testing switched off, so 110,000 stars painted across each disc. Both ends are
 * asserted, because fixing one and regressing the other looks identical on screen.
 */
describe("every body is opaque", () => {
  it("gives no body a transparent material", () => {
    for (const entry of scene.bodies.values()) {
      const m = entry.mesh.material as THREE.Material & { opacity: number };
      expect(m.transparent, `${entry.data.id} is transparent`).toBe(false);
      expect(m.opacity, `${entry.data.id} opacity`).toBe(1);
    }
  });

  it("writes and tests depth on every body, so nearer geometry occludes farther", () => {
    for (const entry of scene.bodies.values()) {
      const m = entry.mesh.material as THREE.Material;
      expect(m.depthWrite, `${entry.data.id} depthWrite`).toBe(true);
      expect(m.depthTest, `${entry.data.id} depthTest`).toBe(true);
    }
  });

  it("renders front faces only, so you never see the inside of a planet", () => {
    for (const entry of scene.bodies.values()) {
      expect((entry.mesh.material as THREE.Material).side).toBe(THREE.FrontSide);
    }
  });
});

describe("the sky cannot draw through a planet", () => {
  const layers = [
    ["starfield", createStarfield().points],
    ["deep sky", createDeepSkyLayer().points],
    ["exoplanets", createExoplanetLayer().points],
  ] as const;

  it.each(layers)("%s depth-tests against solid geometry", (_name, points) => {
    // This is the actual fix for the transparent planets. With depthTest false these layers
    // sit in the transparent queue, render after the opaque planets, and paint over them.
    expect((points.material as THREE.Material).depthTest).toBe(true);
  });

  it.each(layers)(
    "%s still does not write depth, so points do not occlude each other",
    (_n, points) => {
      expect((points.material as THREE.Material).depthWrite).toBe(false);
    },
  );

  it.each(layers)("%s joins the logarithmic depth pipeline", (_name, points) => {
    // Enabling depthTest is only half of it. The renderer runs a logarithmic depth buffer,
    // so a shader that does not write gl_FragDepth the same way compares two different
    // encodings and occludes wrongly -- which is why the test was disabled rather than fixed.
    const shader = points.material as THREE.ShaderMaterial;
    expect(shader.vertexShader).toContain("logdepthbuf_pars_vertex");
    expect(shader.vertexShader).toContain("logdepthbuf_vertex");
    expect(shader.fragmentShader).toContain("logdepthbuf_pars_fragment");
    expect(shader.fragmentShader).toContain("logdepthbuf_fragment");
  });

  it.each(layers)("%s discards points centred off screen", (_name, points) => {
    // SwiftShader crashes the GPU process on a sprite centred just outside the viewport;
    // one galaxy sat there on arrival at TRAPPIST-1 and the canvas never came back. The
    // discard has to follow the write to gl_Position and precede log depth, which reads it.
    const shader = (points.material as THREE.ShaderMaterial).vertexShader;
    const written = shader.indexOf("gl_Position = projectionMatrix");
    const discarded = shader.indexOf(DISCARD_OFFSCREEN_POINT);
    const logDepth = shader.indexOf("#include <logdepthbuf_vertex>");
    expect(discarded).toBeGreaterThan(written);
    expect(logDepth).toBeGreaterThan(discarded);
  });
});

describe("solidity is a physical claim, not a per-body list", () => {
  it("lets you stand on rock and ice, but not on a star or a gas giant", () => {
    expect(isLandable(getBody("earth")!)).toBe(true);
    expect(isLandable(getBody("mars")!)).toBe(true);
    expect(isLandable(getBody("titan")!)).toBe(true);
    expect(isLandable(getBody("pluto")!)).toBe(true);

    expect(isLandable(getBody("sun")!)).toBe(false);
    expect(isLandable(getBody("jupiter")!)).toBe(false);
    expect(isLandable(getBody("saturn")!)).toBe(false);
    expect(isLandable(getBody("uranus")!)).toBe(false);
    expect(isLandable(getBody("neptune")!)).toBe(false);
  });

  it("puts the collision floor at the surface of a solid world", () => {
    const earth = getBody("earth")!;
    expect(collisionRadiusM(earth)).toBeGreaterThan(earth.radiusM);
    expect(collisionRadiusM(earth) - earth.radiusM).toBeLessThan(10);
  });

  it("holds you off the Sun and the giants rather than landing you on them", () => {
    for (const id of ["sun", "jupiter", "saturn", "uranus", "neptune"]) {
      const body = getBody(id)!;
      expect(collisionRadiusM(body), id).toBeGreaterThan(body.radiusM * 1.01);
    }
  });

  it("never puts a floor inside a body", () => {
    for (const entry of scene.bodies.values()) {
      expect(collisionRadiusM(entry.data), entry.data.id).toBeGreaterThanOrEqual(
        entry.data.radiusM,
      );
    }
  });
});
