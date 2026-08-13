/**
 * The interstellar map — pick any of 4,722 confirmed systems and go there.
 *
 * ## Travel is the one thing this project invents, and it says so
 *
 * TRAPPIST-1 is 40 light-years away. No craft anyone can describe reaches it in a human
 * lifetime, or in a thousand. Every other number in Aether traces to a measurement; this one
 * cannot, so rather than dressing it up as a warp drive with invented physics, the jump is
 * instantaneous and the panel states plainly that it is an abstraction.
 *
 * Being honest about the single fiction is what protects the credibility of everything
 * around it.
 */

import type { CatalogNames, SystemCatalog } from "@aether/exoplanets";

/**
 * Systems worth surfacing first.
 *
 * Chosen for scientific interest rather than proximity — the nearest systems are mostly
 * single planets around quiet M dwarfs, while these are the ones with resonant chains,
 * habitable-zone terrestrials, real atmospheric measurements, or direct images.
 */
const NOTABLE: Readonly<Record<string, string>> = {
  "TRAPPIST-1": "Seven terrestrial planets in a resonant chain",
  "Proxima Cen": "Nearest star to the Sun; a habitable-zone terrestrial",
  "K2-18": "Sub-Neptune with a JWST-measured atmosphere",
  "GJ 1214": "Best-studied sub-Neptune; thick, hazy envelope",
  "Kepler-186": "First Earth-sized planet in a habitable zone",
  "TOI-700": "Earth-sized, habitable zone, found by TESS",
  "55 Cnc": "Includes 55 Cnc e, a lava world hot enough to melt rock",
  "HD 189733": "The archetypal hot Jupiter; deep-blue in reflected light",
  "WASP-121": "Ultra-hot Jupiter; heavy metals detected escaping",
  "LHS 3844": "Airless bare rock, per Spitzer phase curves",
  "HR 8799": "Four giant planets, directly imaged",
  "Kepler-452": "Sun-like host, habitable-zone super-Earth",
  "HD 209458": "First exoplanet atmosphere ever detected",
  "GJ 887": "Bright, quiet M dwarf with multiple planets",
};

export type SortMode = "distance" | "planets" | "notable";

export interface InterstellarMap {
  element: HTMLElement;
  onTravel: (listener: (systemIndex: number) => void) => void;
  /** Reflect the system the camera is currently in. */
  setCurrent: (systemIndex: number | null) => void;
  setCatalog: (systems: SystemCatalog, names: CatalogNames) => void;
}

/** Spectral class from effective temperature, for the one-glance star type. */
function spectralClass(teff: number): string {
  if (!Number.isFinite(teff)) return "?";
  if (teff >= 30_000) return "O";
  if (teff >= 10_000) return "B";
  if (teff >= 7_500) return "A";
  if (teff >= 6_000) return "F";
  if (teff >= 5_200) return "G";
  if (teff >= 3_700) return "K";
  return "M";
}

const LIGHT_YEARS_PER_PARSEC = 3.26156;

export function createInterstellarMap(): InterstellarMap {
  const listeners: Array<(index: number) => void> = [];
  let systems: SystemCatalog | null = null;
  let names: CatalogNames | null = null;
  let sort: SortMode = "notable";
  let query = "";
  let current: number | null = null;

  const element = document.createElement("aside");
  element.id = "starmap";
  element.innerHTML = `
    <h1>Interstellar map</h1>
    <p class="loading">Loading catalogue…</p>
  `;

  const orderedIndices = (): number[] => {
    if (!systems || !names) return [];

    const q = query.trim().toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < systems.count; i++) {
      const name = names.systems[i] ?? "";
      if (q && !name.toLowerCase().includes(q)) continue;
      indices.push(i);
    }

    if (sort === "distance") {
      // The catalogue is already distance-ordered, so this is a no-op by construction.
      return indices.slice(0, 300);
    }
    if (sort === "planets") {
      return indices
        .sort((a, b) => systems!.planetCount[b]! - systems!.planetCount[a]!)
        .slice(0, 300);
    }

    // Notable first, then by distance.
    return indices
      .sort((a, b) => {
        const na = NOTABLE[names!.systems[a] ?? ""] ? 0 : 1;
        const nb = NOTABLE[names!.systems[b] ?? ""] ? 0 : 1;
        if (na !== nb) return na - nb;
        return systems!.distancesPc[a]! - systems!.distancesPc[b]!;
      })
      .slice(0, 300);
  };

  const render = (): void => {
    if (!systems || !names) return;

    const rows = orderedIndices()
      .map((i) => {
        const name = names!.systems[i] ?? "";
        const note = NOTABLE[name];
        const pc = systems!.distancesPc[i]!;
        const ly = pc * LIGHT_YEARS_PER_PARSEC;
        const n = systems!.planetCount[i]!;
        const cls = spectralClass(systems!.effectiveTemperatures[i]!);
        const isCurrent = current === i;

        return `
          <button class="system${isCurrent ? " current" : ""}" data-index="${i}">
            <span class="sysname">${name}</span>
            <span class="sysmeta">${ly.toFixed(1)} ly · ${cls} · ${n} planet${n === 1 ? "" : "s"}</span>
            ${note ? `<span class="sysnote">${note}</span>` : ""}
          </button>`;
      })
      .join("");

    element.innerHTML = `
      <h1>Interstellar map</h1>
      <input class="search" type="search" placeholder="Search ${systems.count.toLocaleString()} systems…" value="${query.replace(/"/g, "&quot;")}" />
      <div class="sorts">
        <button class="sortbtn${sort === "notable" ? " on" : ""}" data-sort="notable">Notable</button>
        <button class="sortbtn${sort === "distance" ? " on" : ""}" data-sort="distance">Nearest</button>
        <button class="sortbtn${sort === "planets" ? " on" : ""}" data-sort="planets">Most planets</button>
      </div>
      <p class="fiction">
        Travel is instantaneous. It is the only thing in Aether that is not derived from a
        measurement — TRAPPIST-1 is 40 light-years away and nothing reaches it in a lifetime.
        Everything you arrive at is real.
      </p>
      <div class="systems">${rows}</div>
    `;

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
    const target = event.target as HTMLElement;

    const sortButton = target.closest<HTMLButtonElement>("button[data-sort]");
    if (sortButton?.dataset.sort) {
      sort = sortButton.dataset.sort as SortMode;
      render();
      return;
    }

    const systemButton = target.closest<HTMLButtonElement>("button[data-index]");
    if (systemButton?.dataset.index) {
      const index = Number(systemButton.dataset.index);
      current = index;
      render();
      for (const listener of listeners) listener(index);
    }
  });

  return {
    element,
    onTravel: (listener) => {
      listeners.push(listener);
    },
    setCurrent: (index) => {
      current = index;
      render();
    },
    setCatalog: (s, n) => {
      systems = s;
      names = n;
      render();
    },
  };
}
