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
        <div class="row"><span class="k">parameter coverage</span><span class="v">${pct}%</span></div>
        <div class="row"><span class="k">surface speculation</span><span class="v warn">${speculation}%</span></div>
        <p class="desc">${describeEvidence(profile)}</p>
        ${
          projected
            ? `<p class="projected">Includes missions that have not launched. Anything derived from them is a projection, not data.</p>`
            : ""
        }
      </div>

      ${groups}
    `;

    for (const box of element.querySelectorAll<HTMLInputElement>("input[data-mission]")) {
      box.addEventListener("change", () => {
        const next = new Set(selection.selected);
        if (box.checked) next.add(box.dataset.mission!);
        else next.delete(box.dataset.mission!);
        selection = createSelection(next);
        render();
        emit();
      });
    }

    for (const button of element.querySelectorAll<HTMLButtonElement>("button[data-preset]")) {
      button.addEventListener("click", () => {
        selection = presetSelection(button.dataset.preset as MissionPresetId);
        render();
        emit();
      });
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
