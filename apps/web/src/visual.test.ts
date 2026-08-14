/**
 * Visual honesty tests.
 *
 * These pin the claims the rendering makes about itself. The failure they exist to catch is
 * a refactor that quietly removes the uncertainty floor — at which point a well-observed
 * planet would render as *certain*, and the application would be asserting something no
 * exoplanet dataset supports.
 */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { allMissionsSelection, buildEvidenceProfile, createSelection } from "@aether/missions";
import { buildPlanetModel } from "@aether/catalog";
import { UNRESOLVED_SURFACE_FLOOR, desaturate, speculationStyle } from "./speculation.js";
import { F32_METRE_PRECISION_LIMIT_M, createDebugOverlay } from "./debug-overlay.js";

const everything = buildEvidenceProfile(allMissionsSelection());
const transitOnly = buildEvidenceProfile(createSelection(["tess"]));

const best = buildPlanetModel("trappist-1", "e", everything);
const worst = buildPlanetModel("trappist-1", "e", transitOnly);

describe("the uncertainty floor is never removed", () => {
  it("keeps speculation above the floor even with every mission selected", () => {
    expect(speculationStyle(best).speculation).toBeGreaterThanOrEqual(UNRESOLVED_SURFACE_FLOOR);
  });

  it("keeps a visible rim even at the floor", () => {
    // A rim opacity of zero would say "we are sure about this surface". Nobody is.
    expect(speculationStyle(best).rimOpacity).toBeGreaterThan(0);
  });

  it("holds the floor even for Earth, where the surface genuinely is resolved", () => {
    // Earth is the one world where a resolved surface exists, but the *generator* has still
    // not been validated against it, so the visual floor stays. Loosening it here would be
    // the first step toward loosening it everywhere.
    const earth = buildPlanetModel("sol", "earth", everything);
    expect(speculationStyle(earth).speculation).toBeGreaterThanOrEqual(
      UNRESOLVED_SURFACE_FLOOR,
    );
  });
});

describe("better evidence hardens the picture without certifying it", () => {
  it("speculates more with less evidence", () => {
    expect(speculationStyle(worst).speculation).toBeGreaterThan(
      speculationStyle(best).speculation,
    );
  });

  it("desaturates more with less evidence", () => {
    expect(speculationStyle(worst).desaturation).toBeGreaterThan(
      speculationStyle(best).desaturation,
    );
  });

  it("never desaturates to an unreadable grey", () => {
    // Communicating uncertainty is the goal; an unreadable image communicates nothing.
    expect(speculationStyle(worst).desaturation).toBeLessThan(1);
  });

  it("strengthens the rim as evidence thins", () => {
    expect(speculationStyle(worst).rimOpacity).toBeGreaterThan(
      speculationStyle(best).rimOpacity,
    );
  });
});

describe("unknown atmospheres are marked, not drawn", () => {
  it("flags TRAPPIST-1 e's atmosphere as unconstrained", () => {
    // No exoplanet surface pressure has ever been measured, so this must be true for every
    // exoplanet in the catalog.
    expect(speculationStyle(best).atmosphereUnknown).toBe(true);
  });

  it("says so in the caption rather than only in a flag", () => {
    expect(speculationStyle(best).caption).toContain("Atmosphere unconstrained");
  });

  it("does not flag Earth, whose surface pressure is measured", () => {
    const earth = buildPlanetModel("sol", "earth", everything);
    expect(speculationStyle(earth).atmosphereUnknown).toBe(false);
  });

  it("always states the surface is a hypothesis, at every evidence level", () => {
    for (const model of [best, worst]) {
      expect(speculationStyle(model).caption.toLowerCase()).toMatch(/hypothesis|inference/);
    }
  });
});

describe("desaturation", () => {
  it("leaves a colour untouched at zero", () => {
    const colour = { r: 0.2, g: 0.5, b: 0.9 };
    expect(desaturate(colour, 0)).toEqual(colour);
  });

  it("reaches neutral grey at one", () => {
    const out = desaturate({ r: 0.2, g: 0.5, b: 0.9 }, 1);
    expect(out.r).toBeCloseTo(0.55, 5);
    expect(out.g).toBeCloseTo(0.54, 5);
    expect(out.b).toBeCloseTo(0.53, 5);
  });

  it("clamps rather than extrapolating out of gamut", () => {
    const out = desaturate({ r: 0.2, g: 0.5, b: 0.9 }, 5);
    expect(out.r).toBeCloseTo(0.55, 5);
    expect(out.b).toBeGreaterThanOrEqual(0);
    expect(out.b).toBeLessThanOrEqual(1);
  });
});

describe("precision debug overlay", () => {
  const sample = {
    frameId: "earth",
    frameDepth: 2,
    localMagnitudeM: 1.2e7,
    maxRelativeM: 1.5e11,
    altitudeM: 4.2e6,
    rebasedThisFrame: false,
    depthStrategy: "logarithmic",
    partition: null,
    fps: 60,
  };

  it("starts hidden and stays inert until toggled", () => {
    const overlay = createDebugOverlay();
    expect(overlay.visible).toBe(false);
    overlay.update(sample);
    expect(overlay.element.innerHTML).toBe("");
  });

  it("reports the frame and the local coordinate magnitude once shown", () => {
    const overlay = createDebugOverlay();
    overlay.toggle();
    overlay.update(sample);
    expect(overlay.element.textContent).toContain("earth");
    expect(overlay.element.textContent).toContain("AU");
  });

  it("warns once camera-relative offsets exceed f32 metre precision", () => {
    // Past this point an f32 upload can no longer resolve a metre, and geometry visibly
    // shimmers. It is the single number worth watching in this overlay.
    const overlay = createDebugOverlay();
    overlay.toggle();
    overlay.update({ ...sample, maxRelativeM: F32_METRE_PRECISION_LIMIT_M * 10 });
    expect(overlay.element.textContent).toContain("jitter");
  });

  it("does not warn below the limit", () => {
    const overlay = createDebugOverlay();
    overlay.toggle();
    overlay.update({ ...sample, maxRelativeM: F32_METRE_PRECISION_LIMIT_M / 10 });
    expect(overlay.element.textContent).not.toContain("jitter");
  });

  it("toggles back off", () => {
    const overlay = createDebugOverlay();
    overlay.toggle();
    overlay.toggle();
    expect(overlay.visible).toBe(false);
    expect(overlay.element.style.display).toBe("none");
  });
});
