/**
 * The provenance inspector, driven by a PlanetModel.
 *
 * The product promise is "every pixel can name its evidence", and this panel is where that
 * promise is either kept or exposed as marketing. It shows, for each quantity: what it is,
 * how it was obtained, how confident that makes it, what it rests on, and — for the ones
 * that matter most — that nobody knows.
 *
 * ## Unknowns are shown, not hidden
 *
 * The instinct with a missing value is to drop the row. That instinct is wrong here. A
 * user who deselects Gaia and watches the planet radius change from a number to UNKNOWN,
 * with an explanation of which mission would restore it, has learned something true about
 * how exoplanet science works. A user who watches the row silently vanish has learned
 * nothing and probably did not notice.
 */

import type { PlanetModel } from "@aether/catalog";
import {
  BADGE_CLASS,
  BADGE_DESCRIPTION,
  BADGE_ORDER,
  badgeCounts,
  classifyFields,
  fieldLabel,
  type FieldEvidence,
} from "./badges.js";
import { formatConfidence, formatInterval, formatUncertainty, formatValue } from "./format.js";

export interface ModelInspector {
  element: HTMLElement;
  show: (model: PlanetModel) => void;
  hide: () => void;
  readonly visible: boolean;
}

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function badgeSpan(field: FieldEvidence): string {
  return `<span class="pv-badge ${BADGE_CLASS[field.badge]}" title="${escape(
    BADGE_DESCRIPTION[field.badge],
  )}">${field.badge}</span>`;
}

function fieldRow(field: FieldEvidence): string {
  const value = formatValue(field.field, field.valueSI, field.unit);
  const uncertainty = formatUncertainty(field.field, field.uncertainty, field.unit);
  const interval = field.interval
    ? `<div class="pv-formula">68% interval ${escape(
        formatInterval(field.field, field.interval, field.unit),
      )}</div>`
    : "";

  const assumptions = field.assumptions.length
    ? `<div class="pv-note">Assumes: ${field.assumptions.map(escape).join("; ")}</div>`
    : "";

  const note = field.note ? `<div class="pv-note">${escape(field.note)}</div>` : "";

  const source = field.sourceUrl
    ? `<a class="pv-src" href="${escape(field.sourceUrl)}" target="_blank" rel="noreferrer">${escape(field.source)}</a>`
    : `<span class="pv-src">${escape(field.source)}</span>`;

  const detail = field.detail
    ? `<div class="pv-formula">from ${escape(field.detail)}</div>`
    : "";

  return `
    <div class="pv-row">
      <div class="pv-head">
        <span class="pv-label">${escape(fieldLabel(field.field))}</span>
        <span class="pv-value">${escape(value)}${uncertainty ? ` <span class="pv-unc">${escape(uncertainty)}</span>` : ""}</span>
      </div>
      <div class="pv-meta">
        ${badgeSpan(field)}
        ${source}
        <span class="pv-conf">confidence ${escape(formatConfidence(field.confidence))}</span>
      </div>
      ${interval}${detail}${assumptions}${note}
    </div>`;
}

/**
 * The terrain section.
 *
 * Presented under a HYPOTHESIS heading and with the caveat repeated in full, because this
 * is the single place a reader is most likely to mistake a rendering for a claim about the
 * real world. Operators that were *rejected* are listed too: "there are no dunes here,
 * because the surface pressure cannot move sediment" is exactly as informative as the
 * features that are present, and it is what shows the gates are doing real work.
 */
function terrainSection(model: PlanetModel): string {
  if (!model.terrain) {
    return `
      <h2>Surface</h2>
      <p class="pv-caveat">No surface hypothesis is offered.</p>
      <p class="pv-note">${escape(model.terrainAbsentReason ?? "Reason unrecorded.")}</p>`;
  }

  const active = model.terrain.operators
    .map(
      (op) => `
      <div class="pv-op">
        <div class="pv-op-head">
          <span>${escape(op.op)}</span>
          <span class="pv-conf">${Math.round(op.confidence * 100)}%</span>
        </div>
        <div class="pv-note">${escape(op.reason)}</div>
      </div>`,
    )
    .join("");

  const rejected = model.terrain.rejected
    .map(
      (r) => `
      <div class="pv-op pv-op-off">
        <div class="pv-op-head"><span>${escape(r.op)}</span><span class="pv-conf">absent</span></div>
        <div class="pv-note">${escape(r.reason)}</div>
      </div>`,
    )
    .join("");

  const warnings = model.terrain.warnings.length
    ? `<p class="pv-note pv-warn">${model.terrain.warnings.length} proposal correction${
        model.terrain.warnings.length === 1 ? "" : "s"
      } were recorded during compilation.</p>`
    : "";

  return `
    <h2>Surface <span class="pv-badge ${BADGE_CLASS.HYPOTHESIS}">HYPOTHESIS</span></h2>
    <p class="pv-caveat">
      Nobody has resolved the surface of any exoplanet. This terrain is one physically
      admissible possibility consistent with the measurements above — not a prediction of
      what is actually there, and not an image of it.
    </p>
    <h3>Processes active on this world</h3>
    ${active || '<p class="pv-note">None admissible.</p>'}
    <h3>Processes ruled out, and why</h3>
    ${rejected || '<p class="pv-note">None.</p>'}
    ${warnings}`;
}

export function createModelInspector(): ModelInspector {
  const element = document.createElement("aside");
  element.id = "provenance";
  element.style.display = "none";

  let visible = false;

  const render = (model: PlanetModel): void => {
    const fields = classifyFields(model);
    const counts = badgeCounts(fields);

    const legend = BADGE_ORDER.filter((b) => counts[b] > 0)
      .map(
        (b) =>
          `<span class="pv-badge ${BADGE_CLASS[b]}" title="${escape(BADGE_DESCRIPTION[b])}">${b} ${counts[b]}</span>`,
      )
      .join(" ");

    const speculation = Math.round(model.speculation * 100);

    element.innerHTML = `
      <button class="pv-close" aria-label="Close inspector">×</button>
      <h1>${escape(model.name)}</h1>
      <div class="pv-sub">${escape(model.systemName)} · seed <code>${escape(model.seed)}</code></div>

      <div class="pv-summary">${legend}</div>
      <div class="pv-meter"><div class="pv-fill" style="width:${100 - speculation}%"></div></div>
      <div class="pv-row-inline">
        <span>Constrained by measurement</span>
        <span class="${speculation > 60 ? "pv-warn" : ""}">${100 - speculation}%</span>
      </div>

      <h2>Quantities</h2>
      ${fields.map(fieldRow).join("")}

      ${terrainSection(model)}
    `;

    element.querySelector(".pv-close")?.addEventListener("click", () => hide());
  };

  const hide = (): void => {
    visible = false;
    element.style.display = "none";
  };

  return {
    element,
    show: (model) => {
      render(model);
      visible = true;
      element.style.display = "";
    },
    hide,
    get visible() {
      return visible;
    },
  };
}
