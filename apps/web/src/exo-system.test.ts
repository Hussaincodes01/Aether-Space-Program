/**
 * Exoplanet system construction, against the real catalogue.
 *
 * The defect these pin down passed every other test: a system was built with every planet
 * frame at its star's origin, and only the render loop moved them -- which it does not do
 * while motion is frozen. So all seven TRAPPIST-1 planets sat inside their own star, and
 * travelling there showed a star and nothing else.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createUniverseRoot, relativePosition } from "@aether/coordinates";
import { parsePlanets, parseSystems, type CatalogNames } from "@aether/exoplanets";
import { buildExoSystem } from "./exo-system.js";

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "exoplanets",
  "data",
);
const ab = (name: string): ArrayBuffer => {
  const b = readFileSync(join(DATA, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const systems = parseSystems(ab("systems.bin"));
const planets = parsePlanets(ab("planets.bin"));
const names: CatalogNames = JSON.parse(readFileSync(join(DATA, "names.json"), "utf8"));

function build(systemName: string, timeS = 0) {
  const index = names.systems.indexOf(systemName);
  expect(index).toBeGreaterThanOrEqual(0);
  return buildExoSystem(
    index,
    systems,
    planets,
    names,
    createUniverseRoot(),
    new THREE.Scene(),
    timeS,
  );
}

describe("a system is valid the moment it is built", () => {
  it("places every TRAPPIST-1 planet on its orbit, not at the centre of the star", () => {
    const system = build("TRAPPIST-1");
    expect(system.planets).toHaveLength(7);

    for (const body of system.planets) {
      const offset = relativePosition(body.frame, system.starFrame);
      const r = Math.hypot(offset.x, offset.y, offset.z);
      const { semiMajorAxisM: a, eccentricity: e } = body.elements;

      // On the ellipse, and therefore well outside the star.
      expect(r).toBeGreaterThanOrEqual(a * (1 - e) * 0.999);
      expect(r).toBeLessThanOrEqual(a * (1 + e) * 1.001);
      expect(r).toBeGreaterThan(system.starRadiusM * 10);
    }
  });

  it("keeps the planets in their measured order outward from the star", () => {
    const system = build("TRAPPIST-1");
    const distances = system.planets
      .slice()
      .sort((p, q) => p.elements.semiMajorAxisM - q.elements.semiMajorAxisM)
      .map((body) => {
        const o = relativePosition(body.frame, system.starFrame);
        return Math.hypot(o.x, o.y, o.z);
      });

    // The orbits are near-circular and nested, so distance order follows axis order.
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeGreaterThan(distances[i - 1]!);
    }
  });

  it("places planets for the requested epoch, so a later time moves them", () => {
    const early = build("TRAPPIST-1", 0);
    const later = build("TRAPPIST-1", 86_400);
    const b0 = relativePosition(early.planets[0]!.frame, early.starFrame);
    const b1 = relativePosition(later.planets[0]!.frame, later.starFrame);

    // TRAPPIST-1 b completes an orbit in 1.51 days, so one day is most of a revolution.
    expect(Math.hypot(b1.x - b0.x, b1.y - b0.y, b1.z - b0.z)).toBeGreaterThan(
      early.planets[0]!.elements.semiMajorAxisM * 0.5,
    );
  });
});
