/**
 * Web UI tests.
 *
 * The honesty guarantees in this project are only real if they survive the last hop into
 * the DOM. A resolver that refuses a bad unit and a panel that then prints a number anyway
 * is not a safe system; it is a safe library with an unsafe application on top.
 *
 * So these tests assert on rendered output, not just on the classification functions:
 * UNKNOWN has to actually appear, the caveat has to actually be in the terrain section, and
 * a withheld measurement has to actually explain itself.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EARTH_MASS, EARTH_RADIUS } from "@aether/units";
import {
  allMissionsSelection,
  buildEvidenceProfile,
  createSelection,
  envelopeWidth,
} from "@aether/missions";
import { buildPlanetModel } from "@aether/catalog";
import {
  BADGE_DESCRIPTION,
  BADGE_ORDER,
  badgeCounts,
  classifyFields,
  fieldLabel,
} from "./badges.js";
import { formatConfidence, formatInterval, formatUncertainty, formatValue } from "./format.js";
import { createModelInspector } from "./model-inspector.js";
import { createCatalogPanel } from "./catalog-panel.js";
import { createErrorPanel, describeThrown } from "./error-panel.js";
import { createMissionPanel } from "./mission-panel.js";
import { createControls } from "./controls.js";
import { formatDistance, formatSpeed } from "./hud.js";

const everything = buildEvidenceProfile(allMissionsSelection());
const transitOnly = buildEvidenceProfile(createSelection(["tess"]));

const trappistE = buildPlanetModel("trappist-1", "e", everything);
const proximaB = buildPlanetModel("proxima-centauri", "b", everything);
const starved = buildPlanetModel("trappist-1", "e", transitOnly);

describe("badge classification", () => {
  it("labels a published measurement MEASURED", () => {
    const radius = classifyFields(trappistE).find((f) => f.field === "planet_radius");
    expect(radius?.badge).toBe("MEASURED");
  });

  it("labels a formula result DERIVED and names the formula", () => {
    const density = classifyFields(trappistE).find((f) => f.field === "bulk_density");
    expect(density?.badge).toBe("DERIVED");
    expect(density?.source).toBe("bulk_density");
  });

  it("labels a mass-radius prior INFERRED and carries its interval", () => {
    const radius = classifyFields(proximaB).find((f) => f.field === "planet_radius");
    expect(radius?.badge).toBe("INFERRED");
    expect(radius?.interval).toBeDefined();
    expect(radius!.interval!.p84).toBeGreaterThan(radius!.interval!.p16);
  });

  it("labels an unmeasured quantity UNKNOWN with a reason", () => {
    const albedo = classifyFields(trappistE).find((f) => f.field === "bond_albedo");
    expect(albedo?.badge).toBe("UNKNOWN");
    expect(albedo?.note).toBeTruthy();
  });

  it("labels a withheld measurement UNKNOWN and says which mission would restore it", () => {
    const withheld = classifyFields(starved).find((f) => f.field === "stellar_radius");
    expect(withheld?.badge).toBe("UNKNOWN");
    expect(withheld?.note).toContain("mission");
  });

  it("reports each field once, at its strongest available evidence", () => {
    const fields = classifyFields(trappistE).map((f) => f.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("orders strongest evidence first", () => {
    const badges = classifyFields(trappistE).map((f) => BADGE_ORDER.indexOf(f.badge));
    expect(badges).toEqual([...badges].sort((a, b) => a - b));
  });

  it("gives every badge a description", () => {
    for (const badge of BADGE_ORDER) {
      expect(BADGE_DESCRIPTION[badge].length, badge).toBeGreaterThan(20);
    }
  });

  it("counts badges to a total matching the field count", () => {
    const fields = classifyFields(trappistE);
    const counts = badgeCounts(fields);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(fields.length);
  });

  it("humanises an unrecognised field rather than showing a raw identifier", () => {
    expect(fieldLabel("planet_radius")).toBe("Planet radius");
    expect(fieldLabel("some_new_quantity")).toBe("Some new quantity");
  });
});

describe("value formatting", () => {
  it("shows a planet radius in Earth radii, not metres", () => {
    expect(formatValue("planet_radius", EARTH_RADIUS, "m")).toContain("R⊕");
    expect(formatValue("planet_radius", EARTH_RADIUS, "m")).toContain("1");
  });

  it("shows a mass in Earth masses", () => {
    expect(formatValue("planet_mass", EARTH_MASS, "kg")).toContain("M⊕");
  });

  it("switches an orbital period from days to years past a year", () => {
    expect(formatValue("orbital_period", 6.1 * 86_400, "s")).toContain("d");
    expect(formatValue("orbital_period", 400 * 86_400, "s")).toContain("yr");
  });

  it("prints unknown for a null value rather than zero", () => {
    // The single most important formatting rule in the project.
    expect(formatValue("planet_radius", null, "m")).toBe("unknown");
  });

  it("survives extreme values without producing junk", () => {
    for (const v of [0, 1e-30, 1e30, -1e30, Number.MIN_VALUE]) {
      const out = formatValue("bulk_density", v, "kg/m^3");
      expect(out.length, `${v}`).toBeGreaterThan(0);
      expect(out).not.toContain("NaN");
    }
  });

  it("returns a dash rather than NaN for a non-finite value", () => {
    expect(formatValue("bulk_density", Number.NaN, "kg/m^3")).toContain("—");
    expect(formatValue("bulk_density", Number.POSITIVE_INFINITY, "kg/m^3")).toContain("—");
  });

  it("omits an uncertainty rather than printing a false zero", () => {
    // Printing "± 0" would claim a precision nobody published.
    expect(formatUncertainty("planet_radius", undefined, "m")).toBe("");
    expect(formatUncertainty("planet_radius", { minus: 0, plus: 0 }, "m")).toBe("");
  });

  it("renders an asymmetric uncertainty as two numbers", () => {
    const out = formatUncertainty(
      "planet_radius",
      { minus: 0.012 * EARTH_RADIUS, plus: 0.05 * EARTH_RADIUS },
      "m",
    );
    expect(out).toContain("+");
    expect(out).toContain("/");
  });

  it("renders an interval in display units", () => {
    const out = formatInterval(
      "planet_radius",
      { p16: EARTH_RADIUS, p84: 2 * EARTH_RADIUS },
      "m",
    );
    expect(out).toContain("…");
    expect(out).toContain("R⊕");
  });

  it("shows a dash where a layer supplies no confidence", () => {
    expect(formatConfidence(null)).toBe("—");
    expect(formatConfidence(0.9)).toBe("90%");
  });
});

describe("the provenance inspector renders what it claims", () => {
  it("starts hidden", () => {
    const inspector = createModelInspector();
    expect(inspector.visible).toBe(false);
    expect(inspector.element.style.display).toBe("none");
  });

  it("shows the planet name and the seed", () => {
    const inspector = createModelInspector();
    inspector.show(trappistE);
    expect(inspector.element.textContent).toContain("TRAPPIST-1 e");
    expect(inspector.element.textContent).toContain(trappistE.seed);
  });

  it("prints the word UNKNOWN for the unmeasured Bond albedo", () => {
    // The row must be visible, not dropped. A user who cannot see what is unknown has been
    // told a more confident story than the data supports.
    const inspector = createModelInspector();
    inspector.show(trappistE);
    expect(inspector.element.textContent).toContain("UNKNOWN");
    expect(inspector.element.textContent).toContain("Bond albedo");
  });

  it("marks the terrain section as a hypothesis and repeats the caveat in full", () => {
    const inspector = createModelInspector();
    inspector.show(trappistE);
    const text = inspector.element.textContent ?? "";
    expect(text).toContain("HYPOTHESIS");
    expect(text).toContain("Nobody has resolved the surface of any exoplanet");
  });

  it("lists processes that were ruled out, not only those present", () => {
    const inspector = createModelInspector();
    inspector.show(trappistE);
    expect(inspector.element.textContent).toContain("ruled out");
  });

  it("explains the absence when there is no surface hypothesis at all", () => {
    const inspector = createModelInspector();
    inspector.show(starved);
    expect(inspector.element.textContent).toContain("No surface hypothesis is offered");
  });

  it("hides again on demand", () => {
    const inspector = createModelInspector();
    inspector.show(trappistE);
    inspector.hide();
    expect(inspector.visible).toBe(false);
    expect(inspector.element.style.display).toBe("none");
  });

  it("escapes markup rather than injecting it", () => {
    const hostile = {
      ...trappistE,
      name: "<img src=x onerror=alert(1)>",
    };
    const inspector = createModelInspector();
    inspector.show(hostile);
    expect(inspector.element.querySelector("img")).toBeNull();
  });
});

describe("catalog panel", () => {
  it("lists the seed systems and their planets", () => {
    const panel = createCatalogPanel(everything);
    const text = panel.element.textContent ?? "";
    expect(text).toContain("TRAPPIST-1");
    expect(text).toContain("Proxima Centauri");
    expect(text).toContain("Solar System");
  });

  it("defaults to TRAPPIST-1 e", () => {
    const panel = createCatalogPanel(everything);
    expect(panel.getSelection()).toEqual({ systemId: "trappist-1", planetId: "e" });
  });

  it("notifies a listener when a planet is chosen", () => {
    const panel = createCatalogPanel(everything);
    const listener = vi.fn();
    panel.onSelect(listener);

    panel.element
      .querySelector<HTMLButtonElement>('button[data-system="trappist-1"][data-planet="f"]')
      ?.click();

    expect(listener).toHaveBeenCalledWith({ systemId: "trappist-1", planetId: "f" });
    expect(panel.getSelection().planetId).toBe("f");
  });

  it("reports more unknowns under a thinner evidence profile", () => {
    const rich = createCatalogPanel(everything);
    const poor = createCatalogPanel(transitOnly);

    const unknownCount = (html: string): number =>
      [...html.matchAll(/(\d+) unknown/g)].reduce((sum, m) => sum + Number(m[1]), 0);

    expect(unknownCount(poor.element.innerHTML)).toBeGreaterThan(
      unknownCount(rich.element.innerHTML),
    );
  });

  it("rebuilds its counts when the evidence changes", () => {
    const panel = createCatalogPanel(everything);
    const before = panel.element.innerHTML;
    panel.setEvidence(transitOnly);
    expect(panel.element.innerHTML).not.toBe(before);
  });
});

describe("error panel", () => {
  it("stays hidden with nothing to report", () => {
    const panel = createErrorPanel();
    expect(panel.element.style.display).toBe("none");
    expect(panel.count).toBe(0);
  });

  it("shows a reported error", () => {
    const panel = createErrorPanel();
    panel.report({ severity: "error", title: "Boom", detail: "It broke" });
    expect(panel.element.style.display).toBe("");
    expect(panel.element.textContent).toContain("Boom");
  });

  it("deduplicates, so a failure in the render loop cannot spam sixty panels a second", () => {
    const panel = createErrorPanel();
    for (let i = 0; i < 60; i++) {
      panel.report({ severity: "error", title: "Same", detail: "Same" });
    }
    expect(panel.count).toBe(1);
  });

  it("maps a typed pipeline error to a readable suggestion", () => {
    const error = Object.assign(new Error("bad row"), { name: "InvalidCatalogDataError" });
    const described = describeThrown(error, "Loading");
    expect(described.title).toContain("Loading");
    expect(described.suggestion).toContain("bundled catalog data");
  });

  it("handles a thrown non-Error without crashing", () => {
    expect(describeThrown("just a string", "Doing").detail).toContain("just a string");
    expect(describeThrown(undefined, "Doing").severity).toBe("error");
  });

  it("clears on demand", () => {
    const panel = createErrorPanel();
    panel.report({ severity: "error", title: "x", detail: "y" });
    panel.clear();
    expect(panel.count).toBe(0);
    expect(panel.element.style.display).toBe("none");
  });

  it("announces itself to assistive technology", () => {
    const panel = createErrorPanel();
    expect(panel.element.getAttribute("role")).toBe("alert");
    expect(panel.element.getAttribute("aria-live")).toBe("assertive");
  });
});

describe("mission panel", () => {
  it("starts on the requested preset and exposes a profile", () => {
    const panel = createMissionPanel("today");
    expect(panel.getSelection().selected.size).toBeGreaterThan(0);
    expect(panel.getProfile().coverage).toBeDefined();
  });

  it("notifies listeners when the selection changes", () => {
    const panel = createMissionPanel("today");
    const listener = vi.fn();
    panel.onChange(listener);

    // The panel listens for `change` on its checkboxes, not `click`.
    const toggle = panel.element.querySelector<HTMLInputElement>("input[data-mission]")!;
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(listener).toHaveBeenCalled();
  });

  it("never closes the envelope completely, however much is selected", () => {
    // No exoplanet surface has ever been resolved, so certainty has a floor.
    const everythingProfile = buildEvidenceProfile(allMissionsSelection());
    expect(envelopeWidth(everythingProfile)).toBeGreaterThan(0);
  });

  it("widens the envelope as missions are removed", () => {
    expect(envelopeWidth(transitOnly)).toBeGreaterThan(envelopeWidth(everything));
  });
});

describe("HUD formatting", () => {
  it("scales distance across twenty orders of magnitude", () => {
    for (const metres of [1, 1e3, 1e6, 1e9, 1e12, 1e16, 1e20, 1e24]) {
      const out = formatDistance(metres);
      expect(out, `${metres}`).not.toContain("NaN");
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("handles zero and negative distance without junk", () => {
    expect(formatDistance(0)).not.toContain("NaN");
    expect(formatDistance(-5)).not.toContain("NaN");
  });

  it("formats speed at rest and at relativistic magnitudes", () => {
    for (const speed of [0, 1, 3e8, 1e12]) {
      expect(formatSpeed(speed), `${speed}`).not.toContain("NaN");
    }
  });
});

describe("controls lifecycle", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
  });

  it("removes every listener it added on dispose", () => {
    // A leaked keydown listener keeps the whole camera alive after teardown, and in a test
    // suite it silently makes later cases depend on earlier ones.
    const addWindow = vi.spyOn(window, "addEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const addCanvas = vi.spyOn(canvas, "addEventListener");
    const removeCanvas = vi.spyOn(canvas, "removeEventListener");

    const controls = createControls(canvas);
    const added = addWindow.mock.calls.length + addCanvas.mock.calls.length;

    controls.dispose();
    const removed = removeWindow.mock.calls.length + removeCanvas.mock.calls.length;

    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
  });

  it("responds to the throttle while live and not after disposal", () => {
    const controls = createControls(canvas);
    const initial = controls.state.speedMs;

    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    const afterWheel = controls.state.speedMs;
    expect(afterWheel).not.toBe(initial);

    controls.dispose();
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    expect(controls.state.speedMs).toBe(afterWheel);
  });

  it("accepts a look-at target without disturbing the throttle", () => {
    const controls = createControls(canvas);
    const speed = controls.state.speedMs;
    controls.lookAt(0, 0, -1);
    expect(controls.state.speedMs).toBe(speed);
    expect(Number.isFinite(controls.state.speedMs)).toBe(true);
    controls.dispose();
  });
});
