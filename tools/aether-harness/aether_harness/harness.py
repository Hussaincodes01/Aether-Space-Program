"""Orchestration and the universe ledger.

The ledger is what makes the word "universe" mean something. It records, per
planet, the frozen content hash, the registry version and the physics envelope hash
that authorised it. Consequences:

  * asking for the same planet twice returns byte-identical parameters, without
    calling a model at all (the second call is a ledger hit),
  * changing an operator's bounds changes the registry version, so the ledger can
    tell you exactly which planets were authored under the old contract instead of
    silently regenerating them,
  * regeneration is explicit (``rebuild=True``), bumps ``revision`` and records the
    hash it superseded, so a universe has history rather than drift.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

from .fallback import as_proposal
from .llm.providers import MockProvider, Provider, build_provider
from .llm.structured import Outcome, author_spec
from .models import PlanetDataCard, TerrainSpec
from .physics import derive, envelope, envelope_hash
from .registry import Registry, load_builtin_operators


@dataclass
class HarnessConfig:
    universe_seed: int = 20260819
    provider: str = "mock"
    model: str | None = None
    base_url: str | None = None
    api_key_env: str | None = None
    temperature: float = 0.0
    max_attempts: int = 3
    resolution: int = 192
    ledger_path: str = "universe.ledger.json"
    spec_dir: str = "specs"
    verbose: bool = True

    def to_dict(self) -> dict:
        return {"universe_seed": self.universe_seed, "provider": self.provider,
                "model": self.model, "temperature": self.temperature,
                "max_attempts": self.max_attempts, "resolution": self.resolution}


@dataclass
class BuildResult:
    spec: TerrainSpec
    from_ledger: bool = False
    outcome: Outcome | None = None
    notes: list[str] = field(default_factory=list)


class Harness:
    def __init__(self, config: HarnessConfig | None = None,
                 registry: Registry | None = None):
        self.cfg = config or HarnessConfig()
        self.registry = registry or load_builtin_operators()
        self.ledger = self._load_ledger()

    # --- ledger ------------------------------------------------------------ #
    def _load_ledger(self) -> dict:
        if os.path.exists(self.cfg.ledger_path):
            with open(self.cfg.ledger_path) as fh:
                led = json.load(fh)
            if led.get("universe_seed") != self.cfg.universe_seed:
                raise RuntimeError(
                    f"ledger {self.cfg.ledger_path} belongs to universe seed "
                    f"{led.get('universe_seed')}, not {self.cfg.universe_seed}. "
                    "Point --ledger somewhere else rather than mixing universes.")
            return led
        return {"universe_seed": self.cfg.universe_seed,
                "registry_version": self.registry.version,
                "engine": {}, "planets": {}}

    def _save_ledger(self) -> None:
        self.ledger["registry_version"] = self.registry.version
        d = os.path.dirname(os.path.abspath(self.cfg.ledger_path))
        os.makedirs(d, exist_ok=True)
        tmp = self.cfg.ledger_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.ledger, fh, indent=2, sort_keys=True)
        os.replace(tmp, self.cfg.ledger_path)          # atomic: a ledger is precious

    def spec_path(self, planet_id: str) -> str:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in planet_id)
        return os.path.join(self.cfg.spec_dir, f"{safe}.json")

    def load_spec(self, planet_id: str) -> TerrainSpec | None:
        p = self.spec_path(planet_id)
        if not os.path.exists(p):
            return None
        with open(p) as fh:
            spec = TerrainSpec.from_dict(json.load(fh))
        if not spec.verify():
            raise RuntimeError(f"{p} failed hash verification — the file was edited by hand. "
                               "Delete it and rebuild, or restore it from version control.")
        return spec

    # --- build ------------------------------------------------------------- #
    def build(self, card: PlanetDataCard, *, rebuild: bool = False,
              extra_guidance: str = "", provider: Provider | None = None) -> BuildResult:
        pid = card.planet_id
        entry = self.ledger["planets"].get(pid)

        if entry and not rebuild:
            existing = self.load_spec(pid)
            if existing and existing.content_hash == entry["content_hash"]:
                if self.cfg.verbose:
                    print(f"[ledger] {pid} already frozen at {entry['content_hash'][:12]}"
                          f" (rev {entry.get('revision', 1)})")
                stale = entry.get("registry_version") != self.registry.version
                notes = (["registry version has changed since this spec was frozen; it "
                          "remains valid but was authored under different contracts"]
                         if stale else [])
                return BuildResult(existing, from_ledger=True, notes=notes)

        env = derive(card)
        fe = envelope(env, self.registry)
        eh = envelope_hash(env, fe)
        if self.cfg.verbose:
            print(f"[physics] {pid}: {env.archetype} "
                  f"(g={env.surface_gravity_ms2:.2f} m/s2, T_eq={env.equilibrium_temp_k:.0f} K, "
                  f"shoreline={env.shoreline_ratio:.3g}, relief<={env.max_relief_m:.0f} m)")
            print(f"[envelope] {len(fe.allowed_ops)} operators admissible, "
                  f"{len(fe.forbidden_ops)} excluded, budget {fe.max_cost}")

        prov = provider or build_provider(self.cfg.provider, self.cfg.model,
                                          self.cfg.base_url, self.cfg.api_key_env)
        if isinstance(prov, MockProvider):
            prov.prime(as_proposal(env.archetype, fe))
        if self.cfg.verbose:
            print(f"[llm] {prov.describe()}")

        outcome = author_spec(
            card=card, env=env, envelope=fe, registry=self.registry, provider=prov,
            planet_id=pid, universe_seed=self.cfg.universe_seed,
            body_radius_m=(card.get("radius_earth", 1.0) or 1.0) * 6.371e6,
            resolution=self.cfg.resolution, max_attempts=self.cfg.max_attempts,
            temperature=self.cfg.temperature, extra_guidance=extra_guidance,
            verbose=self.cfg.verbose)

        spec = outcome.spec
        spec.envelope_hash = eh
        if entry:
            spec.revision = int(entry.get("revision", 1)) + 1
            spec.supersedes = entry["content_hash"]
        spec.freeze()

        os.makedirs(self.cfg.spec_dir, exist_ok=True)
        with open(self.spec_path(pid), "w") as fh:
            json.dump(spec.to_dict(), fh, indent=2)

        self.ledger["planets"][pid] = {
            "content_hash": spec.content_hash,
            "envelope_hash": eh,
            "registry_version": self.registry.version,
            "archetype": spec.archetype,
            "revision": spec.revision,
            "supersedes": spec.supersedes,
            "stages": [s.op for s in spec.pipeline],
            "frozen_at": spec.frozen_at,
            "fallback_used": spec.llm.fallback_used,
            "spec_path": self.spec_path(pid),
        }
        self._save_ledger()

        if self.cfg.verbose:
            tag = " (FALLBACK)" if spec.llm.fallback_used else ""
            print(f"[frozen] {pid} -> {spec.content_hash[:12]} rev {spec.revision}"
                  f" {len(spec.pipeline)} stages{tag}")
        return BuildResult(spec, outcome=outcome)

    def build_many(self, cards: list[PlanetDataCard], **kw) -> list[BuildResult]:
        return [self.build(c, **kw) for c in cards]

    # --- audit ------------------------------------------------------------- #
    def audit(self) -> dict:
        """Cross-check every ledger entry against its file on disk."""
        report = {"universe_seed": self.ledger["universe_seed"],
                  "registry_version_now": self.registry.version,
                  "planets": len(self.ledger["planets"]),
                  "ok": [], "missing": [], "hash_mismatch": [], "stale_registry": [],
                  "fallbacks": []}
        for pid, e in sorted(self.ledger["planets"].items()):
            path = e.get("spec_path") or self.spec_path(pid)
            if not os.path.exists(path):
                report["missing"].append(pid)
                continue
            with open(path) as fh:
                spec = TerrainSpec.from_dict(json.load(fh))
            if not spec.verify() or spec.content_hash != e["content_hash"]:
                report["hash_mismatch"].append(pid)
                continue
            if e.get("registry_version") != self.registry.version:
                report["stale_registry"].append(pid)
            if e.get("fallback_used"):
                report["fallbacks"].append(pid)
            report["ok"].append(pid)
        return report
