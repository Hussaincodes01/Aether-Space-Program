/**
 * The provenance inspector — the product's whole argument, made visible.
 *
 * Everything Aether renders has been instrumented from the start: the prior chain records
 * how each value was obtained, the physics registry records which formula produced it, and
 * every terrain operator records the gate that admitted or refused it. Until now none of
 * that reached a screen.
 *
 * Two things this shows that nothing else does:
 *
 *   1. **Where each number came from.** Measured, derived, a population prior, or an
 *      admission that we had nothing — with the confidence and the reasoning attached.
 *   2. **Why features are absent.** "There are no rivers here because no liquid is stable
 *      at 210 K" is exactly as informative as the rivers would have been, and no other
 *      exoplanet visualiser tells you.
 */

import {
  compileTerrainProgram,
  listOperators,
  type PlanetContext,
} from "@aether/terrain";
import type { FilledValue, PriorMethod, ResolvedPlanet } from "@aether/exoplanets";

/** Badge per evidence class. Shape as well as colour, for colour-blind readers. */
const BADGE: Record<PriorMethod, { glyph: string; cls: string; label: string }> = {
  measured: { glyph: "◆", cls: "ev-measured", label: "measured" },
  derived: { glyph: "ƒ", cls: "ev-derived", label: "derived" },
  population_prior: { glyph: "◇", cls: "ev-prior", label: "population prior" },
  default_prior: { glyph: "○", cls: "ev-default", label: "no data" },
};

export interface ProvenanceTarget {
  name: string;
  subtitle: string;
  resolved: ResolvedPlanet | null;
  context: PlanetContext | null;
  seed: string;
  /** 0..1 — how much of this world is inference. */
  speculation: number;
}

export interface ProvenancePanel {
  element: HTMLElement;
  show: (target: ProvenanceTarget) => void;
  hide: () => void;
  toggle: () => void;
  readonly visible: boolean;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

function formatValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "unknown";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return `${value.toFixed(digits)} ${unit}`;
}

function valueRow(label: string, field: FilledValue, unit: string): string {
  const badge = BADGE[field.method];
  const confidence = Math.round(field.confidence * 100);

  return `
    <div class="pv-row">
      <div class="pv-head">
        <span class="pv-label">${escapeHtml(label)}</span>
        <span class="pv-value">${escapeHtml(formatValue(field.value, unit))}</span>
      </div>
      <div class="pv-meta">
        <span class="pv-badge ${badge.cls}">${badge.glyph} ${badge.label}</span>
        <span class="pv-conf">${confidence}% confidence</span>
        ${field.scatterFactor ? `<span class="pv-scatter">±${field.scatterFactor.toFixed(2)}×</span>` : ""}
      </div>
      ${field.formula ? `<div class="pv-formula">${escapeHtml(field.formula)}</div>` : ""}
      ${field.note ? `<div class="pv-note">${escapeHtml(field.note)}</div>` : ""}
    </div>`;
}

/**
 * Terrain provenance — present features and, just as importantly, absent ones.
 *
 * The compile is deterministic and cheap, so it is re-run here rather than threaded through
 * the renderer. Rejected operators carry the gate reason verbatim.
 */
function terrainSection(context: PlanetContext, seed: string): string {
  const program = compileTerrainProgram({ context, seed });
  const total = listOperators().length;

  const present = program.operators
    .map(
      (op) => `
      <div class="pv-op">
        <div class="pv-op-head">
          <span class="pv-op-name">${escapeHtml(op.op.replace(/_/g, " "))}</span>
          <span class="pv-conf">${Math.round(op.confidence * 100)}%</span>
        </div>
        <div class="pv-op-why">${escapeHtml(op.reason)}</div>
        <div class="pv-formula">gated by ${escapeHtml(op.gatedBy)}</div>
      </div>`,
    )
    .join("");

  const absent = program.rejected
    .map(
      (op) => `
      <div class="pv-op pv-op-off">
        <div class="pv-op-head">
          <span class="pv-op-name">${escapeHtml(op.op.replace(/_/g, " "))}</span>
          <span class="pv-absent">absent</span>
        </div>
        <div class="pv-op-why">${escapeHtml(op.reason)}</div>
      </div>`,
    )
    .join("");

  const clamps = program.warnings.length
    ? `<div class="pv-note">${program.warnings.length} parameter${
        program.warnings.length === 1 ? " was" : "s were"
      } clamped to the range physics permits.</div>`
    : "";

  return `
    <h2>Surface — ${program.operators.length} of ${total} processes active</h2>
    <p class="pv-caveat">
      No spatially resolved exoplanet surface observation exists. This geography is a
      procedural realisation consistent with the values above — not a prediction of what is
      actually there.
    </p>
    ${clamps}
    ${present}
    ${absent ? `<h3>Not present, and why</h3>${absent}` : ""}`;
}

export function createProvenancePanel(): ProvenancePanel {
  const element = document.createElement("aside");
  element.id = "provenance";
  element.style.display = "none";

  let current: ProvenanceTarget | null = null;
  let visible = false;

  const render = (): void => {
    if (!current) {
      element.innerHTML = `
        <h1>Provenance</h1>
        <p class="pv-empty">Approach a world and press <b>I</b> to see where every value came from.</p>`;
      return;
    }

    const { name, subtitle, resolved, context, seed, speculation } = current;

    const values = resolved
      ? [
          valueRow("Radius", resolved.radiusEarth, "R⊕"),
          valueRow("Mass", resolved.massEarth, "M⊕"),
          valueRow("Bulk density", resolved.densityGcc, "g/cm³"),
          valueRow("Orbital period", resolved.periodDays, "days"),
          valueRow("Semi-major axis", resolved.semiMajorAu, "AU"),
          valueRow("Eccentricity", resolved.eccentricity, ""),
          valueRow("Inclination", resolved.inclinationDeg, "°"),
          valueRow("Equilibrium temperature", resolved.eqTempK, "K"),
        ].join("")
      : `<p class="pv-empty">No catalogue record for this body.</p>`;

    const measuredCount = resolved ? Math.round(resolved.completeness * 8) : 0;

    element.innerHTML = `
      <h1>${escapeHtml(name)}</h1>
      <p class="pv-sub">${escapeHtml(subtitle)}</p>

      <div class="pv-summary">
        <div class="pv-meter"><div class="pv-fill" style="width:${Math.round((1 - speculation) * 100)}%"></div></div>
        <div class="pv-row-inline">
          <span>${measuredCount} of 8 values measured</span>
          <span class="pv-warn">${Math.round(speculation * 100)}% inferred</span>
        </div>
      </div>

      <h2>Values</h2>
      ${values}

      ${context ? terrainSection(context, seed) : `<h2>Surface</h2><p class="pv-empty">No solid surface — bulk density indicates a volatile envelope.</p>`}

      <div class="pv-legend">
        ${Object.values(BADGE)
          .map((b) => `<span class="pv-badge ${b.cls}">${b.glyph} ${b.label}</span>`)
          .join("")}
      </div>`;
  };

  render();

  return {
    element,
    get visible() {
      return visible;
    },
    show: (target) => {
      current = target;
      visible = true;
      element.style.display = "block";
      render();
    },
    hide: () => {
      visible = false;
      element.style.display = "none";
    },
    toggle: () => {
      visible = !visible;
      element.style.display = visible ? "block" : "none";
      if (visible) render();
    },
  };
}
