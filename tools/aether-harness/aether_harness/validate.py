"""Repairing validation.

Two failure modes matter with LLM-authored specs:

  * *soft* failures — a number slightly outside a bound, an unknown parameter key,
    a missing default. These should be silently repaired and recorded, because
    rejecting them wastes a round trip on something the harness can fix exactly.
  * *hard* failures — an operator that does not exist, an operator the physics
    forbids, a stage whose input channel nobody produces, a missing required
    stage. These are fed back to the model as a structured error list, because
    only the model can decide how to restructure the pipeline.

Every repair is recorded on the trace and every repaired field is stamped
``Provenance.REPAIRED``, so a spec always tells you which numbers were the model's
and which were the harness's.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .fields import CHANNELS_BASE
from .models import (FeasibilityEnvelope, GridSpec, Provenance, StageSpec,
                     TerrainSpec)
from .registry import Registry


@dataclass
class ValidationResult:
    ok: bool
    hard_errors: list[str] = field(default_factory=list)
    repairs: list[str] = field(default_factory=list)
    spec: TerrainSpec | None = None

    def error_report(self) -> str:
        lines = ["The proposal was rejected. Fix every item and return the whole JSON again:"]
        for e in self.hard_errors:
            lines.append(f"  - {e}")
        if self.repairs:
            lines.append("Non-fatal adjustments already applied on your behalf "
                         "(keep them, do not fight them):")
            for r in self.repairs[:12]:
                lines.append(f"  - {r}")
        return "\n".join(lines)


def validate_proposal(proposal: dict, *, planet_id: str, universe_seed: int,
                      registry: Registry, envelope: FeasibilityEnvelope,
                      derived, archetype: str, body_radius_m: float,
                      resolution: int = 192) -> ValidationResult:
    hard: list[str] = []
    repairs: list[str] = []
    prov: dict[str, str] = {}

    if not isinstance(proposal, dict):
        return ValidationResult(False, ["response was not a JSON object"])

    raw_stages = proposal.get("pipeline")
    if not isinstance(raw_stages, list) or not raw_stages:
        return ValidationResult(False, ["'pipeline' must be a non-empty array of stages"])
    if len(raw_stages) > envelope.max_stages:
        hard.append(f"pipeline has {len(raw_stages)} stages, limit is {envelope.max_stages}")

    # --- global scalars ---------------------------------------------------- #
    lo, hi = envelope.global_bounds.get("elevation_range_m", (100.0, 20000.0))
    try:
        rng_m = float(proposal.get("elevation_range_m", (lo + hi) / 2))
    except (TypeError, ValueError):
        rng_m = (lo + hi) / 2
        repairs.append("elevation_range_m was not a number; used envelope midpoint")
    if not lo <= rng_m <= hi:
        repairs.append(f"elevation_range_m {rng_m:.0f} clamped into [{lo:.0f},{hi:.0f}] "
                       f"(strength-limited relief)")
        rng_m = min(max(rng_m, lo), hi)
        prov["grid.elevation_range_m"] = Provenance.REPAIRED.value
    else:
        prov["grid.elevation_range_m"] = Provenance.AI_INFERRED.value

    sl = proposal.get("sea_level_quantile", None)
    if sl is not None:
        try:
            sl = float(sl)
            qlo, qhi = envelope.global_bounds.get("sea_level_quantile", (0.02, 0.98))
            if not qlo <= sl <= qhi:
                repairs.append(f"sea_level_quantile {sl:g} clamped into [{qlo},{qhi}]")
                sl = min(max(sl, qlo), qhi)
                prov["grid.sea_level_quantile"] = Provenance.REPAIRED.value
            else:
                prov["grid.sea_level_quantile"] = Provenance.AI_INFERRED.value
        except (TypeError, ValueError):
            repairs.append("sea_level_quantile unparseable; dropped")
            sl = None

    # --- stages ------------------------------------------------------------ #
    allowed = set(envelope.allowed_ops)
    forbidden = set(envelope.forbidden_ops)
    available = set(CHANNELS_BASE)
    seen_ids: set[str] = set()
    stages: list[StageSpec] = []
    total_cost = 0

    for i, raw in enumerate(raw_stages):
        if not isinstance(raw, dict) or "op" not in raw:
            hard.append(f"stage[{i}] is not an object with an 'op' field")
            continue
        st = StageSpec.from_dict(raw)
        op = registry.get(st.op)
        if op is None:
            hard.append(f"stage[{i}] op '{st.op}' does not exist; choose from the catalog")
            continue
        if st.op in forbidden or st.op not in allowed:
            hard.append(f"stage[{i}] op '{st.op}' is forbidden for archetype "
                        f"'{archetype}' — remove it or substitute an allowed operator")
            continue

        if st.id in seen_ids:
            st.id = f"{st.id}_{i}"
            repairs.append(f"duplicate stage id renamed to '{st.id}'")
        seen_ids.add(st.id)

        # parameters: coerce, clamp to declared range, then to envelope narrowing
        clean: dict = {}
        for pspec in op.params:
            if pspec.name in st.params:
                val, note = pspec.coerce(st.params[pspec.name])
                if note:
                    repairs.append(f"{st.id}.{note}")
                    prov[f"pipeline.{st.id}.{pspec.name}"] = Provenance.REPAIRED.value
                else:
                    prov[f"pipeline.{st.id}.{pspec.name}"] = Provenance.AI_INFERRED.value
            else:
                val = pspec.default
                prov[f"pipeline.{st.id}.{pspec.name}"] = Provenance.ASSUMED.value
            cl = envelope.clamp_for(op.id, pspec.name)
            if cl is not None and pspec.kind in ("float", "int"):
                c = min(max(float(val), cl[0]), cl[1])
                if abs(c - float(val)) > 1e-12:
                    repairs.append(f"{st.id}.{pspec.name} {float(val):g} -> {c:g} "
                                   f"(physics envelope)")
                    prov[f"pipeline.{st.id}.{pspec.name}"] = Provenance.REPAIRED.value
                val = int(round(c)) if pspec.kind == "int" else c
            clean[pspec.name] = val

        for extra in sorted(set(st.params) - {p.name for p in op.params}):
            repairs.append(f"{st.id}: unknown parameter '{extra}' dropped")
        st.params = clean

        missing = [c for c in op.consumes if c not in available]
        if missing:
            hard.append(f"stage[{i}] '{st.op}' reads channel(s) {missing} that no earlier "
                        f"stage produces — add a producing stage before it "
                        f"(noise.driver_fields produces uplift/erodibility/runoff)")
        if st.mask and st.mask not in available:
            repairs.append(f"{st.id}: mask '{st.mask}' not available at that point; ignored")
            st.mask = None
        if st.mask and not op.maskable:
            repairs.append(f"{st.id}: op '{st.op}' does not support masking; ignored")
            st.mask = None
        if not 0.0 <= st.weight <= 1.0:
            st.weight = min(max(st.weight, 0.0), 1.0)
            repairs.append(f"{st.id}: weight clamped to {st.weight:g}")

        available.update(op.produces)
        total_cost += op.cost
        stages.append(st)

    if total_cost > envelope.max_cost:
        hard.append(f"pipeline compute cost {total_cost} exceeds budget "
                    f"{envelope.max_cost} — drop or downgrade the most expensive stages")

    present = {s.op for s in stages}
    for req in envelope.required_ops:
        if req not in present:
            hard.append(f"required operator '{req}' is missing for archetype '{archetype}'")

    if not any(registry.get(s.op) and "elevation" in registry.get(s.op).produces
               for s in stages):
        hard.append("no stage writes the elevation channel")

    if hard:
        return ValidationResult(False, hard, repairs)

    spec = TerrainSpec(
        planet_id=planet_id,
        universe_seed=universe_seed,
        grid=GridSpec(body_radius_m=body_radius_m, base_resolution_lat=resolution,
                      elevation_range_m=rng_m, sea_level_quantile=sl),
        pipeline=stages,
        archetype=archetype,
        provenance_map=prov,
        derived=derived.to_dict() if hasattr(derived, "to_dict") else dict(derived),
    )
    return ValidationResult(True, [], repairs, spec)
