/**
 * Mission selector.
 *
 * Choosing missions is not a filter over a catalog — it changes what the app is allowed to
 * claim. The panel therefore always shows the consequence alongside the choice: how much
 * of the parameter space is constrained, what is still unknown, and how speculative the
 * world on screen currently is.
 */

import {
  MISSION_PRESETS,
  buildEvidenceProfile,
  createSelection,
  describeEvidence,
  envelopeWidth,
  includesPlannedMission,
  listMissions,
  presetSelection,
  type EvidenceProfile,
  type Mission,
  type MissionPresetId,
  type MissionSelection,
} from "@aether/missions";

export interface MissionPanel {
  element: HTMLElement;
  getSelection: () => MissionSelection;
  getProfile: () => EvidenceProfile;
  onChange: (listener: (profile: EvidenceProfile, selection: MissionSelection) => void) => void;
}

const STATUS_LABEL: Record<Mission["status"], string> = {
  operational: "Flying now",
  completed: "Completed",
  planned: "Not yet launched",
};

const STATUS_ORDER: Mission["status"][] = ["operational", "completed", "planned"];

function years(mission: Mission): string {
  if (mission.status === "planned") return `${mission.startYear}~`;
  return mission.endYear ? `${mission.startYear}-${mission.endYear}` : `${mission.startYear}-`;
}

export function createMissionPanel(initial: MissionPresetId = "today"): MissionPanel {
  const listeners: Array<(profile: EvidenceProfile, selection: MissionSelection) => void> = [];
  let selection = presetSelection(initial);

  const element = document.createElement("aside");
  element.id = "missions";

  const render = (): void => {
    const profile = buildEvidenceProfile(selection);
    const width = envelopeWidth(profile);
    const projected = includesPlannedMission(selection);

    const presets = Object.entries(MISSION_PRESETS)
      .map(
        ([id, preset]) =>
          `<button class="preset" data-preset="${id}" title="${preset.description}">${preset.name}</button>`,
      )
      .join("");

    const groups = STATUS_ORDER.map((status) => {
      const missions = listMissions().filter((m) => m.status === status);
      if (missions.length === 0) return "";
      const rows = missions
        .map((mission) => {
          const checked = selection.selected.has(mission.id) ? "checked" : "";
          const discovers = mission.isDiscoveryFacility
            ? `<span class="tag">discovers</span>`
            : "";
          const count = mission.discoveredPlanets
            ? `<span class="count">${mission.discoveredPlanets.toLocaleString()}</span>`
            : "";
          return `
            <label class="mission" title="${mission.description.replace(/"/g, "&quot;")}">
              <input type="checkbox" data-mission="${mission.id}" ${checked} />
              <span class="name">${mission.name}</span>
              <span class="meta">${mission.agency} &middot; ${years(mission)}</span>
              ${discovers}${count}
            </label>`;
        })
        .join("");
      return `<div class="group"><h2>${STATUS_LABEL[status]}</h2>${rows}</div>`;
    }).join("");

    // The two numbers a user should read together: how much is known, and how much of the
    // world is therefore invented.
    const pct = Math.round(profile.completeness * 100);
    const speculation = Math.round(width * 100);

    element.innerHTML = `
      <h1>Missions</h1>
      <div class="presets">${presets}</div>

      <div class="evidence">
        <div class="meter"><div class="fill" style="width:${pct}%"></div></div>
        <div class="row"><span class="k">parameter coverage</span><span class="v" data-field="coverage">${pct}%</span></div>
        <div class="row"><span class="k">surface speculation</span><span class="v warn" data-field="speculation">${speculation}%</span></div>
        <p class="desc">${describeEvidence(profile)}</p>
        <p class="projected" style="display:${projected ? "block" : "none"}">Includes missions that have not launched. Anything derived from them is a projection, not data.</p>
      </div>

      ${groups}
    `;

    // One delegated listener on the container rather than one per control. Rebuilding
    // ~14 checkboxes and their listeners on every click caused a visible hitch, and it
    // also stole focus mid-interaction.
    element.addEventListener("change", onChange);
    element.addEventListener("click", onClick);
  };

  const onChange = (event: Event): void => {
    const box = event.target as HTMLInputElement;
    if (!box.dataset?.mission) return;
    const next = new Set(selection.selected);
    if (box.checked) next.add(box.dataset.mission);
    else next.delete(box.dataset.mission);
    selection = createSelection(next);
    updateEvidence();
    emit();
  };

  const onClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-preset]");
    if (!button?.dataset.preset) return;
    selection = presetSelection(button.dataset.preset as MissionPresetId);
    syncCheckboxes();
    updateEvidence();
    emit();
  };

  /** Reflect the current selection onto the existing checkboxes, without rebuilding them. */
  const syncCheckboxes = (): void => {
    for (const box of element.querySelectorAll<HTMLInputElement>("input[data-mission]")) {
      const id = box.dataset.mission;
      if (id) box.checked = selection.selected.has(id);
    }
  };

  /**
   * Update only the evidence readout.
   *
   * The mission list is static once built, so touching just this subtree keeps toggling a
   * checkbox cheap and leaves scroll position and focus alone.
   */
  const updateEvidence = (): void => {
    const profile = buildEvidenceProfile(selection);
    const width = envelopeWidth(profile);
    const pct = Math.round(profile.completeness * 100);
    const speculation = Math.round(width * 100);

    const fill = element.querySelector<HTMLElement>(".meter .fill");
    if (fill) fill.style.width = `${pct}%`;

    const coverage = element.querySelector<HTMLElement>("[data-field='coverage']");
    if (coverage) coverage.textContent = `${pct}%`;

    const speculationEl = element.querySelector<HTMLElement>("[data-field='speculation']");
    if (speculationEl) speculationEl.textContent = `${speculation}%`;

    const desc = element.querySelector<HTMLElement>(".desc");
    if (desc) desc.textContent = describeEvidence(profile);

    const projected = element.querySelector<HTMLElement>(".projected");
    if (projected) {
      projected.style.display = includesPlannedMission(selection) ? "block" : "none";
    }
  };

  const emit = (): void => {
    const profile = buildEvidenceProfile(selection);
    for (const listener of listeners) listener(profile, selection);
  };

  render();

  return {
    element,
    getSelection: () => selection,
    getProfile: () => buildEvidenceProfile(selection),
    onChange: (listener) => {
      listeners.push(listener);
    },
  };
}
