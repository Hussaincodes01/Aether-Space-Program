"""The structured-output loop.

Attempt 1 asks the question. If validation rejects it, attempt 2 is the same
conversation plus the machine-generated error report — not a fresh prompt. Keeping
the rejected proposal in context is what makes the repair a targeted edit instead of
a re-roll, and it converges in one extra attempt for almost every failure class.

If all attempts fail, the archetype template is used and ``fallback_used`` is set.
The harness never returns "no universe".
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from ..fallback import as_proposal
from ..models import FeasibilityEnvelope, LLMTrace, TerrainSpec
from ..registry import Registry
from ..validate import ValidationResult, validate_proposal
from .prompt import SYSTEM, build_user_message, prompt_hash
from .providers import Provider, ProviderError


@dataclass
class Attempt:
    index: int
    ok: bool
    hard_errors: list[str] = field(default_factory=list)
    repairs: list[str] = field(default_factory=list)
    error: str = ""


@dataclass
class Outcome:
    spec: TerrainSpec
    trace: LLMTrace
    attempts: list[Attempt] = field(default_factory=list)
    proposal: dict = field(default_factory=dict)


def author_spec(*, card, env, envelope: FeasibilityEnvelope, registry: Registry,
                provider: Provider, planet_id: str, universe_seed: int,
                body_radius_m: float, resolution: int = 192,
                max_attempts: int = 3, temperature: float = 0.0,
                extra_guidance: str = "", verbose: bool = False) -> Outcome:
    schema = registry.json_schema(allowed=envelope.allowed_ops)
    user = build_user_message(card, env, envelope, registry, extra_guidance)
    ph = prompt_hash(SYSTEM, user, schema)

    trace = LLMTrace(provider=provider.name, model=provider.model, temperature=temperature,
                     prompt_hash=ph, registry_version=registry.version)
    attempts: list[Attempt] = []
    convo = user
    last_ok: ValidationResult | None = None
    proposal: dict = {}

    for i in range(1, max_attempts + 1):
        trace.attempts = i
        try:
            comp = provider.complete_json(SYSTEM, convo, schema, temperature=temperature)
        except ProviderError as exc:
            attempts.append(Attempt(i, False, error=str(exc)))
            if verbose:
                print(f"  attempt {i}: provider error: {exc}")
            break

        trace.tokens_in += comp.tokens_in
        trace.tokens_out += comp.tokens_out
        trace.latency_s += comp.latency_s
        proposal = comp.data

        res = validate_proposal(proposal, planet_id=planet_id, universe_seed=universe_seed,
                                registry=registry, envelope=envelope, derived=env,
                                archetype=env.archetype, body_radius_m=body_radius_m,
                                resolution=resolution)
        attempts.append(Attempt(i, res.ok, res.hard_errors, res.repairs))
        if verbose:
            status = "accepted" if res.ok else f"rejected ({len(res.hard_errors)} errors)"
            print(f"  attempt {i}: {status}; {len(res.repairs)} repairs")
            for e in res.hard_errors[:6]:
                print(f"      ! {e}")

        if res.ok:
            last_ok = res
            trace.repairs = res.repairs
            break

        trace.rejected = res.hard_errors
        convo = (user
                 + "\n\n=== YOUR PREVIOUS PROPOSAL (rejected) ===\n"
                 + json.dumps(proposal, indent=1)[:6000]
                 + "\n\n=== VALIDATOR REPORT ===\n" + res.error_report())

    if last_ok is None or last_ok.spec is None:
        if verbose:
            print("  falling back to the deterministic archetype template")
        proposal = as_proposal(env.archetype, envelope)
        res = validate_proposal(proposal, planet_id=planet_id, universe_seed=universe_seed,
                                registry=registry, envelope=envelope, derived=env,
                                archetype=env.archetype, body_radius_m=body_radius_m,
                                resolution=resolution)
        if not res.ok or res.spec is None:
            raise RuntimeError(
                "archetype template failed validation — this is a harness bug, not a "
                f"model failure: {res.hard_errors}")
        trace.fallback_used = True
        trace.repairs = res.repairs
        last_ok = res

    spec = last_ok.spec
    spec.llm = trace
    return Outcome(spec=spec, trace=trace, attempts=attempts, proposal=proposal)
