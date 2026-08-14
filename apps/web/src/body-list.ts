/**
 * The Solar System gazetteer — every body we model, and a way to get to it.
 *
 * The interstellar map solves this for other star systems, but inside our own the only way
 * to reach anything was to aim and hold the throttle. That is fine for Earth and hopeless
 * for Titan: Saturn is roughly 1.4 billion km away and subtends an arc a few pixels wide,
 * so "point at it" is not a usable instruction.
 *
 * Unlike interstellar travel, movement here is not a fiction. Voyager 1 flew this route.
 * Arrival is instantaneous rather than a nine-year cruise, but the destination, the distance
 * and the geometry are all real, so the panel reports the true distance rather than hiding
 * it.
 */

import { AU } from "@aether/units";
import { SOLAR_SYSTEM, type SolarBody } from "@aether/solar-system";
import { applySubsections } from "./panel-dock.js";

export interface BodyList {
  element: HTMLElement;
  onTravel: (listener: (bodyId: string) => void) => void;
  /** Reflect the body the camera is currently nearest. */
  setCurrent: (bodyId: string | null) => void;
}

type Group = { label: string; note: string; ids: readonly string[] };

/**
 * Grouped the way the Solar System is actually organised, rather than by distance.
 *
 * Sorting 36 bodies by heliocentric distance interleaves the Galilean moons with Saturn's,
 * which is true and useless. What a traveller wants is "Jupiter, and the four things
 * orbiting it".
 */
const GROUPS: readonly Group[] = [
  { label: "The Sun", note: "G2V, 5772 K", ids: ["sun"] },
  {
    label: "Inner planets",
    note: "Rock and metal",
    ids: ["mercury", "venus", "earth", "moon", "mars", "phobos", "deimos"],
  },
  {
    label: "Jupiter",
    note: "Four Galilean moons",
    ids: ["jupiter", "io", "europa", "ganymede", "callisto"],
  },
  {
    label: "Saturn",
    note: "Rings, and Titan",
    ids: ["saturn", "mimas", "enceladus", "rhea", "titan", "iapetus"],
  },
  {
    label: "Uranus",
    note: "Tipped on its side",
    ids: ["uranus", "miranda", "ariel", "umbriel", "titania", "oberon"],
  },
  { label: "Neptune", note: "And captured Triton", ids: ["neptune", "triton"] },
  {
    label: "Dwarf planets",
    note: "The cold, distant end",
    ids: ["ceres", "pluto", "charon", "eris", "makemake", "haumea"],
  },
];

/** Semi-major axis from the Sun, following the parent chain up for moons. */
function heliocentricDistanceM(body: SolarBody): number {
  if (!body.parentId) return 0;
  if (body.parentId === "sun") return body.elements?.semiMajorAxisM ?? 0;

  const parent = SOLAR_SYSTEM.find((b) => b.id === body.parentId);
  return parent ? heliocentricDistanceM(parent) : 0;
}

function formatDistance(body: SolarBody): string {
  const au = heliocentricDistanceM(body) / AU;
  if (au === 0) return "centre";
  return au < 0.1 ? `${(au * 1000).toFixed(0)} mAU` : `${au.toFixed(2)} AU`;
}

/**
 * One line of physical character, from measured values only.
 *
 * Every clause here is a fact about the body rather than an adjective: "1.45 bar" instead of
 * "thick atmosphere". The rule holds throughout the project and it is worth holding in the
 * UI too, since the UI is where a reader decides whether to trust the rest.
 */
function summarise(body: SolarBody): string {
  const parts: string[] = [];

  const radiusKm = body.radiusM / 1000;
  parts.push(
    radiusKm >= 1000 ? `r ${(radiusKm / 1000).toFixed(2)}k km` : `r ${radiusKm.toFixed(0)} km`,
  );
  parts.push(`${body.surfaceTemperatureK.toFixed(0)} K`);

  if (body.surfacePressurePa > 0) {
    const bar = body.surfacePressurePa / 1e5;
    parts.push(bar >= 0.01 ? `${bar.toFixed(2)} bar` : `${(bar * 1000).toFixed(1)} mbar`);
  } else if (body.kind !== "star") {
    parts.push("airless");
  }

  if (body.stableLiquid !== "none") parts.push(`liquid ${body.stableLiquid}`);
  if (body.tidallyLocked) parts.push("locked");

  return parts.join(" · ");
}

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createBodyList(): BodyList {
  const listeners: Array<(bodyId: string) => void> = [];
  let current: string | null = null;
  let query = "";

  /**
   * Which groups are expanded.
   *
   * Thirty-six bodies is a long scroll, and the natural grouping -- Jupiter and the four
   * things orbiting it -- is exactly what is worth being able to fold. Only the inner
   * planets start open, because that is where the camera starts.
   */
  const expanded = new Set<string>(["Inner planets"]);

  const element = document.createElement("aside");
  element.id = "bodylist";

  const byId = new Map(SOLAR_SYSTEM.map((b) => [b.id, b]));

  const render = (): void => {
    const q = query.trim().toLowerCase();

    const groups = GROUPS.map((group) => {
      const rows = group.ids
        .map((id) => byId.get(id))
        .filter((b): b is SolarBody => Boolean(b))
        .filter((b) => !q || b.name.toLowerCase().includes(q))
        .map((body) => {
          const isCurrent = current === body.id;
          const indent = body.parentId && body.parentId !== "sun" ? " moon" : "";
          return `
            <button class="body${indent}${isCurrent ? " current" : ""}" data-body="${body.id}">
              <span class="bodyname">${escape(body.name)}</span>
              <span class="bodydist">${formatDistance(body)}</span>
              <span class="bodymeta">${summarise(body)}</span>
              <span class="bodyblurb">${escape(body.blurb)}</span>
            </button>`;
        })
        .join("");

      if (!rows) return "";
      return `
        <section class="group">
          <h2 data-group="${escape(group.label)}">
            <span class="sub-arrow" aria-hidden="true"></span>
            <span class="sub-label">${escape(group.label)}</span>
            <span class="groupnote">${escape(group.note)}</span>
          </h2>
          <div class="sub-body">${rows}</div>
        </section>`;
    }).join("");

    element.innerHTML = `
      <h1>Solar System</h1>
      <input class="search" type="search" placeholder="Search ${SOLAR_SYSTEM.length} bodies…" value="${query.replace(/"/g, "&quot;")}" />
      <p class="fiction">
        Arrival is instantaneous, but nothing else here is invented: every distance, radius,
        temperature and orbit is a published measurement.
      </p>
      <div class="groups">${groups || '<p class="loading">No match.</p>'}</div>
    `;

    // A search hit inside a folded group would be invisible, which reads as "no results".
    // While a query is active every group is forced open; folding resumes when it clears.
    const effective = q ? new Set(GROUPS.map((g) => g.label)) : expanded;

    applySubsections(element, effective, (key) => {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      render();
    });

    const search = element.querySelector<HTMLInputElement>(".search");
    search?.addEventListener("input", () => {
      query = search.value;
      const start = search.selectionStart;
      render();
      // Re-focus after the rebuild, or typing drops a character on every keystroke.
      const next = element.querySelector<HTMLInputElement>(".search");
      next?.focus();
      if (start !== null) next?.setSelectionRange(start, start);
    });
  };

  element.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-body]",
    );
    if (!button?.dataset.body) return;
    current = button.dataset.body;
    render();
    for (const listener of listeners) listener(current);
  });

  render();

  return {
    element,
    onTravel: (listener) => listeners.push(listener),
    setCurrent: (bodyId) => {
      if (bodyId === current) return;
      current = bodyId;
      render();
    },
  };
}
