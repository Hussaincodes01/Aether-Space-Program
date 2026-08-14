/**
 * Panel dock tests.
 *
 * The bug these exist to prevent is the one that prompted the dock: six panels, each with
 * hand-picked fixed coordinates, two pairs sitting exactly on top of each other, and the 3D
 * view almost entirely covered on load.
 *
 * So the properties asserted here are layout properties, not cosmetics: panels start
 * collapsed, only one is open per rail, and adding a panel cannot change where any other
 * one sits because none of them own their position any more.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { allMissionsSelection, buildEvidenceProfile } from "@aether/missions";
import { applySubsections, createDock } from "./panel-dock.js";
import { createCatalogPanel } from "./catalog-panel.js";
import { createBodyList } from "./body-list.js";

function panelFor(id: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = `body of ${id}`;
  return el;
}

describe("panels start out of the way", () => {
  it("opens with every panel collapsed unless one asks otherwise", () => {
    // The default state of a space application should be looking at space.
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a") });
    dock.add({ id: "b", title: "B", element: panelFor("b") });

    expect(dock.isOpen("a")).toBe(false);
    expect(dock.isOpen("b")).toBe(false);
  });

  it("honours a single startOpen panel", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a"), startOpen: true });
    dock.add({ id: "b", title: "B", element: panelFor("b") });

    expect(dock.isOpen("a")).toBe(true);
    expect(dock.isOpen("b")).toBe(false);
  });

  it("keeps a collapsed panel's header visible, so it is one click from returning", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "Catalog", element: panelFor("a") });

    const head = dock.element.querySelector<HTMLElement>(".dock-head");
    expect(head).not.toBeNull();
    expect(head!.textContent).toContain("Catalog");
  });
});

describe("only one panel is open per rail", () => {
  it("closes the previous panel when another opens", () => {
    // Two open panels in one rail reintroduces the screen-hogging problem a level down.
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a"), startOpen: true });
    dock.add({ id: "b", title: "B", element: panelFor("b") });

    dock.open("b");

    expect(dock.isOpen("a")).toBe(false);
    expect(dock.isOpen("b")).toBe(true);
  });

  it("toggles a panel shut when it is already open", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a"), startOpen: true });

    dock.toggle("a");
    expect(dock.isOpen("a")).toBe(false);

    dock.toggle("a");
    expect(dock.isOpen("a")).toBe(true);
  });

  it("ignores an unknown id rather than closing everything", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a"), startOpen: true });

    dock.open("does-not-exist");
    dock.toggle("also-not-real");

    expect(dock.isOpen("a")).toBe(true);
  });

  it("opens on a header click", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a") });

    dock.element.querySelector<HTMLButtonElement>(".dock-head")!.click();
    expect(dock.isOpen("a")).toBe(true);
  });
});

describe("the arrow reflects the state", () => {
  it("points right when collapsed and down when open", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a") });
    const arrow = dock.element.querySelector<HTMLElement>(".dock-arrow")!;

    expect(arrow.textContent).toBe("▸");
    dock.open("a");
    expect(arrow.textContent).toBe("▾");
  });

  it("marks the header expanded for assistive technology", () => {
    const dock = createDock("left");
    dock.add({ id: "a", title: "A", element: panelFor("a") });
    const head = dock.element.querySelector<HTMLElement>(".dock-head")!;

    expect(head.getAttribute("aria-expanded")).toBe("false");
    dock.open("a");
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the whole rail can get out of the way", () => {
  it("collapses and restores", () => {
    const dock = createDock("left");
    expect(dock.railCollapsed).toBe(false);

    dock.toggleRail();
    expect(dock.railCollapsed).toBe(true);
    expect(dock.element.classList.contains("dock-collapsed")).toBe(true);

    dock.toggleRail();
    expect(dock.railCollapsed).toBe(false);
  });

  it("points the rail arrow the way the rail will travel", () => {
    const left = createDock("left");
    const right = createDock("right");

    expect(left.element.querySelector(".dock-rail-toggle")!.textContent).toBe("‹");
    expect(right.element.querySelector(".dock-rail-toggle")!.textContent).toBe("›");

    left.toggleRail();
    expect(left.element.querySelector(".dock-rail-toggle")!.textContent).toBe("›");
  });

  it("reveals the rail when a shortcut opens a panel inside a hidden one", () => {
    // Otherwise pressing M with the right rail hidden appears to do nothing at all.
    const dock = createDock("right");
    dock.add({ id: "missions", title: "Missions", element: panelFor("m") });
    dock.setRailCollapsed(true);

    dock.toggle("missions");

    expect(dock.railCollapsed).toBe(false);
    expect(dock.isOpen("missions")).toBe(true);
  });

  it("does not reveal the rail when a shortcut closes the open panel", () => {
    const dock = createDock("right");
    dock.add({ id: "missions", title: "Missions", element: panelFor("m"), startOpen: true });
    dock.setRailCollapsed(true);

    dock.toggle("missions");

    expect(dock.isOpen("missions")).toBe(false);
    expect(dock.railCollapsed).toBe(true);
  });

  it("labels the rail toggle for screen readers", () => {
    const dock = createDock("left");
    const toggle = dock.element.querySelector<HTMLElement>(".dock-rail-toggle")!;
    expect(toggle.getAttribute("aria-label")).toContain("Hide");
    dock.toggleRail();
    expect(toggle.getAttribute("aria-label")).toContain("Show");
  });
});

describe("panels no longer own their position", () => {
  it("puts every panel in the rail's list rather than on the document", () => {
    // This is the actual fix. A panel that cannot position itself cannot collide with
    // another one, however many get added later.
    const dock = createDock("left");
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      dock.add({ id, title: id.toUpperCase(), element: panelFor(id) });
    }

    const sections = dock.element.querySelectorAll(".dock-panel");
    expect(sections).toHaveLength(7);
    for (const section of sections) {
      expect(section.parentElement?.className).toBe("dock-list");
    }
  });

  it("shows the keyboard hint in the header so the binding is discoverable", () => {
    const dock = createDock("left");
    dock.add({ id: "catalog", title: "Catalog", hint: "C", element: panelFor("c") });
    expect(dock.element.querySelector(".dock-hint")!.textContent).toBe("C");
  });
});

describe("sub-sections fold the natural groupings", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = `
      <section>
        <h2 data-group="jupiter"><span class="sub-arrow"></span>Jupiter</h2>
        <div class="sub-body">moons</div>
      </section>
      <section>
        <h2 data-group="saturn"><span class="sub-arrow"></span>Saturn</h2>
        <div class="sub-body">moons</div>
      </section>`;
  });

  it("collapses a group that is not in the expanded set", () => {
    applySubsections(container, new Set(["jupiter"]), () => {});

    const [jupiter, saturn] = [...container.querySelectorAll("section")];
    expect(jupiter!.classList.contains("sub-collapsed")).toBe(false);
    expect(saturn!.classList.contains("sub-collapsed")).toBe(true);
  });

  it("reports a toggle by key", () => {
    const onToggle = vi.fn();
    applySubsections(container, new Set(), onToggle);

    container.querySelector<HTMLElement>('h2[data-group="saturn"]')!.click();
    expect(onToggle).toHaveBeenCalledWith("saturn");
  });

  it("is reachable by keyboard", () => {
    const onToggle = vi.fn();
    applySubsections(container, new Set(), onToggle);

    const heading = container.querySelector<HTMLElement>('h2[data-group="jupiter"]')!;
    expect(heading.getAttribute("tabindex")).toBe("0");
    expect(heading.getAttribute("role")).toBe("button");

    heading.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith("jupiter");
  });

  it("sets the arrow and aria state per group", () => {
    applySubsections(container, new Set(["jupiter"]), () => {});

    const jupiter = container.querySelector<HTMLElement>('h2[data-group="jupiter"]')!;
    const saturn = container.querySelector<HTMLElement>('h2[data-group="saturn"]')!;

    expect(jupiter.querySelector(".sub-arrow")!.textContent).toBe("▾");
    expect(saturn.querySelector(".sub-arrow")!.textContent).toBe("▸");
    expect(jupiter.getAttribute("aria-expanded")).toBe("true");
    expect(saturn.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the list panels use sub-sections", () => {
  const evidence = buildEvidenceProfile(allMissionsSelection());

  it("gives every catalog system a foldable header", () => {
    const panel = createCatalogPanel(evidence);
    const groups = panel.element.querySelectorAll("h2[data-group]");
    expect(groups.length).toBeGreaterThanOrEqual(3);
  });

  it("opens the selected planet's system, so the panel shows where you are", () => {
    const panel = createCatalogPanel(evidence);
    const trappist = panel.element.querySelector<HTMLElement>('h2[data-group="trappist-1"]');
    expect(trappist?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the other systems folded", () => {
    const panel = createCatalogPanel(evidence);
    const sol = panel.element.querySelector<HTMLElement>('h2[data-group="sol"]');
    expect(sol?.getAttribute("aria-expanded")).toBe("false");
  });

  it("survives a re-render without snapping every group shut", () => {
    // State lives in the closure, not the markup, because these panels rebuild their
    // innerHTML wholesale on every mission change.
    const panel = createCatalogPanel(evidence);
    panel.element.querySelector<HTMLElement>('h2[data-group="sol"]')!.click();
    panel.setEvidence(evidence);

    expect(
      panel.element
        .querySelector<HTMLElement>('h2[data-group="sol"]')!
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("folds the Solar System body groups", () => {
    const list = createBodyList();
    const groups = list.element.querySelectorAll("h2[data-group]");
    expect(groups.length).toBeGreaterThanOrEqual(5);

    const inner = list.element.querySelector<HTMLElement>('h2[data-group="Inner planets"]');
    expect(inner?.getAttribute("aria-expanded")).toBe("true");
  });

  it("forces every group open while a search is running", () => {
    // A hit inside a folded group would be invisible, which reads as "no results".
    const list = createBodyList();
    const search = list.element.querySelector<HTMLInputElement>(".search")!;
    search.value = "titan";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const saturn = list.element.querySelector<HTMLElement>('h2[data-group="Saturn"]');
    expect(saturn?.getAttribute("aria-expanded")).toBe("true");
    expect(list.element.textContent).toContain("Titan");
  });
});
