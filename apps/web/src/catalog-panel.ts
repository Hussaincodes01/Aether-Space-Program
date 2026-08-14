/**
 * System and planet selection, from the typed catalog.
 *
 * The interstellar map covers the 4,722 systems in the mapped binary catalogue, which is a
 * map: names, distances, positions. This panel covers the far smaller set of systems that
 * have a *full* PlanetModel — real published values with sources, derived physics, and a
 * terrain hypothesis you can interrogate.
 *
 * The distinction is worth being explicit about in the UI rather than blurring, so the
 * panel says how many quantities each planet actually carries. A user should be able to see
 * that Proxima b has no measured radius before they click it, not discover it afterwards.
 */

import { buildPlanetModel, getSystem, listSystems } from "@aether/catalog";
import type { EvidenceProfile } from "@aether/missions";
import { classifyFields } from "./badges.js";
import { applySubsections } from "./panel-dock.js";

export interface CatalogSelection {
  systemId: string;
  planetId: string;
}

export interface CatalogPanel {
  element: HTMLElement;
  onSelect: (listener: (selection: CatalogSelection) => void) => void;
  /** Rebuild the counts when the evidence profile changes. */
  setEvidence: (evidence: EvidenceProfile) => void;
  getSelection: () => CatalogSelection;
}

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Default landing target: the best-characterised temperate terrestrial we have. */
export const DEFAULT_SELECTION: CatalogSelection = { systemId: "trappist-1", planetId: "e" };

export function createCatalogPanel(evidence: EvidenceProfile): CatalogPanel {
  const listeners: Array<(selection: CatalogSelection) => void> = [];
  let current: CatalogSelection = DEFAULT_SELECTION;
  let profile = evidence;

  /**
   * Which systems are expanded.
   *
   * Owned here rather than read back off the DOM because the panel rebuilds its innerHTML
   * on every mission change, and state living in the markup would be destroyed each time --
   * every toggle would snap all the systems shut under the user.
   *
   * The selected planet's system starts open, so the panel opens showing where you are.
   */
  const expanded = new Set<string>([DEFAULT_SELECTION.systemId]);

  const element = document.createElement("aside");
  element.id = "catalog";

  /**
   * Summarise how much of a planet is actually measured under the current profile.
   *
   * Computed by building the model rather than by guessing from the seed data, so the
   * number in the list is the same number the inspector will show. A summary that can
   * disagree with the detail view is worse than no summary.
   */
  const summarise = (systemId: string, planetId: string): string => {
    try {
      const model = buildPlanetModel(systemId, planetId, profile);
      const fields = classifyFields(model);
      const measured = fields.filter((f) => f.badge === "MEASURED").length;
      const unknown = fields.filter((f) => f.badge === "UNKNOWN").length;
      return `${measured} measured · ${unknown} unknown`;
    } catch {
      // A model that cannot be built is a data problem, and the error panel will carry it.
      // The list should still render the rest of the catalog.
      return "unavailable";
    }
  };

  const render = (): void => {
    const systems = listSystems()
      .map((summary) => {
        const system = getSystem(summary.id);
        const planets = system.planets
          .map((planet) => {
            const selected = current.systemId === summary.id && current.planetId === planet.id;
            return `
              <button class="cat-planet${selected ? " current" : ""}"
                      data-system="${escape(summary.id)}" data-planet="${escape(planet.id)}">
                <span class="cat-name">${escape(planet.name)}</span>
                <span class="cat-meta">${escape(summarise(summary.id, planet.id))}</span>
              </button>`;
          })
          .join("");

        const distance =
          summary.distancePc === null || summary.distancePc === 0
            ? "home"
            : `${(summary.distancePc * 3.26156).toFixed(1)} ly`;

        return `
          <section class="cat-system">
            <h2 data-group="${escape(summary.id)}">
              <span class="sub-arrow" aria-hidden="true"></span>
              <span class="sub-label">${escape(summary.name)}</span>
              <span class="cat-dist">${distance}</span>
            </h2>
            <div class="sub-body">
              <p class="cat-blurb">${escape(summary.blurb)}</p>
              ${planets}
            </div>
          </section>`;
      })
      .join("");

    element.innerHTML = `
      <h1>Catalog</h1>
      <p class="cat-intro">
        Systems with a full model: published values with sources, derived physics, and a
        surface hypothesis you can interrogate. Counts reflect the current mission selection.
      </p>
      ${systems}`;

    applySubsections(element, expanded, (key) => {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      render();
    });
  };

  element.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-planet]",
    );
    if (!button?.dataset.system || !button.dataset.planet) return;

    current = { systemId: button.dataset.system, planetId: button.dataset.planet };
    render();
    for (const listener of listeners) listener(current);
  });

  render();

  return {
    element,
    onSelect: (listener) => listeners.push(listener),
    setEvidence: (next) => {
      profile = next;
      render();
    },
    getSelection: () => current,
  };
}
