"""Data model for the harness.

Deliberately dependency-free (no pydantic). The harness needs exact control over
serialisation because the spec is content-addressed, and it needs *repairing*
validation rather than pass/fail validation, so hand-rolled models are simpler
than fighting a framework.

Three artefacts flow through the system:

    PlanetDataCard      what the sources actually told us (+ uncertainty + origin)
        |  physics.derive()
    DerivedEnvironment  what physics forces to be true, computed not guessed
        |  physics.envelope()
    FeasibilityEnvelope which operators/parameters are physically admissible
        |  llm  (proposes)  ->  validate  (enforces)
    TerrainSpec         the frozen, hashed, engine-agnostic product
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any

from .hashing import content_hash, derive_seed

SCHEMA_VERSION = "1.2.0"
ENGINE_VERSION = "aether-harness/0.4.0"


class Provenance(str, Enum):
    """Where a value came from. Carried end-to-end; never inferred at render time."""

    MEASURED = "measured"        # observed, with a real uncertainty
    DERIVED = "derived"          # closed-form from measured values
    ASSUMED = "assumed"          # harness default / population prior
    AI_INFERRED = "ai_inferred"  # chosen by the LLM within an admissible envelope
    REPAIRED = "repaired"        # LLM proposal clamped or rewritten by the validator


# --------------------------------------------------------------------------- #
# observations
# --------------------------------------------------------------------------- #
CANONICAL_OBS = {
    "radius_earth": "R_earth",
    "mass_earth": "M_earth",
    "semi_major_axis_au": "AU",
    "eccentricity": "-",
    "orbital_period_days": "d",
    "insolation_earth": "S_earth",
    "equilibrium_temp_k": "K",
    "bond_albedo": "-",
    "stellar_teff_k": "K",
    "stellar_radius_sun": "R_sun",
    "stellar_mass_sun": "M_sun",
    "stellar_age_gyr": "Gyr",
    "stellar_metallicity": "dex",
    "rotation_period_hours": "h",
    "obliquity_deg": "deg",
}


@dataclass
class Quantity:
    value: float | None = None
    unit: str = "-"
    sigma: float | None = None
    provenance: Provenance = Provenance.MEASURED
    source: str = ""

    def to_dict(self) -> dict:
        return {
            "value": self.value,
            "unit": self.unit,
            "sigma": self.sigma,
            "provenance": self.provenance.value,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, d: dict | float | int | None) -> "Quantity":
        if d is None or isinstance(d, (int, float)):
            return cls(value=None if d is None else float(d))
        return cls(
            value=None if d.get("value") is None else float(d["value"]),
            unit=d.get("unit", "-"),
            sigma=d.get("sigma"),
            provenance=Provenance(d.get("provenance", "measured")),
            source=d.get("source", ""),
        )


@dataclass
class PlanetDataCard:
    """Normalised observational input. Missing values stay missing."""

    planet_id: str
    host_star: str = ""
    obs: dict[str, Quantity] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def q(self, key: str) -> Quantity:
        return self.obs.get(key, Quantity(value=None, unit=CANONICAL_OBS.get(key, "-")))

    def get(self, key: str, default: float | None = None) -> float | None:
        v = self.q(key).value
        return default if v is None else v

    def put(self, key: str, value: float | None, *, unit: str | None = None,
            sigma: float | None = None, provenance: Provenance = Provenance.MEASURED,
            source: str = "") -> None:
        self.obs[key] = Quantity(value, unit or CANONICAL_OBS.get(key, "-"), sigma, provenance, source)

    def unknown_keys(self) -> list[str]:
        return sorted(k for k in self.obs if k not in CANONICAL_OBS)

    def coverage(self) -> float:
        known = sum(1 for k in CANONICAL_OBS if self.q(k).value is not None)
        return known / len(CANONICAL_OBS)

    def to_dict(self) -> dict:
        return {
            "planet_id": self.planet_id,
            "host_star": self.host_star,
            "obs": {k: v.to_dict() for k, v in sorted(self.obs.items())},
            "notes": list(self.notes),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PlanetDataCard":
        return cls(
            planet_id=d["planet_id"],
            host_star=d.get("host_star", ""),
            obs={k: Quantity.from_dict(v) for k, v in (d.get("obs") or {}).items()},
            notes=list(d.get("notes") or []),
        )


# --------------------------------------------------------------------------- #
# physics products
# --------------------------------------------------------------------------- #
@dataclass
class DerivedEnvironment:
    """Closed-form consequences of the data card. Never LLM-authored."""

    surface_gravity_ms2: float
    escape_velocity_kms: float
    bulk_density_kgm3: float
    equilibrium_temp_k: float
    insolation_earth: float
    shoreline_ratio: float          # >1 => atmosphere unlikely (cosmic shoreline)
    tidal_lock_probability: float
    tidal_heating_wm2: float
    max_relief_m: float             # isostatic/strength ceiling on topography
    archetype: str = "unknown"
    archetype_confidence: float = 0.0
    capabilities: list[str] = field(default_factory=list)
    provenance: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["capabilities"] = sorted(self.capabilities)
        return d


@dataclass
class FeasibilityEnvelope:
    """The admissible action space handed to the LLM and enforced by the validator."""

    allowed_ops: list[str] = field(default_factory=list)
    required_ops: list[str] = field(default_factory=list)
    forbidden_ops: list[str] = field(default_factory=list)
    # "op_id.param" -> (lo, hi); narrower than the operator's own declared range
    param_clamps: dict[str, tuple[float, float]] = field(default_factory=dict)
    global_bounds: dict[str, tuple[float, float]] = field(default_factory=dict)
    capabilities: list[str] = field(default_factory=list)
    max_cost: int = 100
    max_stages: int = 14
    reasons: list[str] = field(default_factory=list)

    def clamp_for(self, op_id: str, param: str) -> tuple[float, float] | None:
        return self.param_clamps.get(f"{op_id}.{param}")

    def to_dict(self) -> dict:
        return {
            "allowed_ops": sorted(self.allowed_ops),
            "required_ops": sorted(self.required_ops),
            "forbidden_ops": sorted(self.forbidden_ops),
            "param_clamps": {k: list(v) for k, v in sorted(self.param_clamps.items())},
            "global_bounds": {k: list(v) for k, v in sorted(self.global_bounds.items())},
            "capabilities": sorted(self.capabilities),
            "max_cost": self.max_cost,
            "max_stages": self.max_stages,
            "reasons": list(self.reasons),
        }


# --------------------------------------------------------------------------- #
# the spec
# --------------------------------------------------------------------------- #
@dataclass
class StageSpec:
    """One node of the generation pipeline."""

    id: str
    op: str
    params: dict[str, Any] = field(default_factory=dict)
    mask: str | None = None                       # channel used to gate the effect
    weight: float = 1.0                           # blend strength of this stage
    enabled: bool = True
    seed_salt: int = 0
    rationale: str = ""
    channel_overrides: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "op": self.op,
            "params": dict(sorted(self.params.items())),
            "mask": self.mask,
            "weight": self.weight,
            "enabled": self.enabled,
            "seed_salt": self.seed_salt,
            "rationale": self.rationale,
            "channel_overrides": dict(sorted(self.channel_overrides.items())),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "StageSpec":
        return cls(
            id=str(d.get("id") or d.get("op", "stage")),
            op=str(d["op"]),
            params=dict(d.get("params") or {}),
            mask=d.get("mask") or None,
            weight=float(d.get("weight", 1.0)),
            enabled=bool(d.get("enabled", True)),
            seed_salt=int(d.get("seed_salt", 0)),
            rationale=str(d.get("rationale", "")),
            channel_overrides=dict(d.get("channel_overrides") or {}),
        )


@dataclass
class GridSpec:
    """Resolution-independent domain description. The reference renderer uses an
    equirectangular lat/lon lattice; noise is evaluated in 3D on the unit sphere so
    the spec is projection-agnostic and seamless at the antimeridian and poles."""

    body_radius_m: float = 6.371e6
    base_resolution_lat: int = 192
    elevation_range_m: float = 8000.0
    sea_level_quantile: float | None = None       # None => no hydrosphere
    reference_datum_m: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "GridSpec":
        return cls(
            body_radius_m=float(d.get("body_radius_m", 6.371e6)),
            base_resolution_lat=int(d.get("base_resolution_lat", 192)),
            elevation_range_m=float(d.get("elevation_range_m", 8000.0)),
            sea_level_quantile=(None if d.get("sea_level_quantile") in (None, "")
                                else float(d["sea_level_quantile"])),
            reference_datum_m=float(d.get("reference_datum_m", 0.0)),
        )


@dataclass
class LLMTrace:
    """Non-hashed audit record. Excluded from the content hash on purpose: the same
    parameters produced by a different model are the same universe."""

    provider: str = "none"
    model: str = "none"
    temperature: float = 0.0
    prompt_hash: str = ""
    registry_version: str = ""
    attempts: int = 0
    repairs: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)
    fallback_used: bool = False
    tokens_in: int = 0
    tokens_out: int = 0
    latency_s: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "LLMTrace":
        t = cls()
        for k, v in (d or {}).items():
            if hasattr(t, k):
                setattr(t, k, v)
        return t


@dataclass
class TerrainSpec:
    """The frozen product. Engine-agnostic: consume from numpy, C++, or a shader."""

    planet_id: str
    universe_seed: int
    grid: GridSpec = field(default_factory=GridSpec)
    pipeline: list[StageSpec] = field(default_factory=list)
    archetype: str = "unknown"
    provenance_map: dict[str, str] = field(default_factory=dict)
    derived: dict[str, Any] = field(default_factory=dict)
    envelope_hash: str = ""
    schema_version: str = SCHEMA_VERSION
    engine_version: str = ENGINE_VERSION
    revision: int = 1
    supersedes: str | None = None
    llm: LLMTrace = field(default_factory=LLMTrace)
    content_hash: str = ""
    frozen_at: str = ""

    # --- identity ---------------------------------------------------------- #
    HASH_EXCLUDE = ("content_hash", "frozen_at", "llm", "revision", "supersedes")

    def hashable(self) -> dict:
        d = self.to_dict()
        for k in self.HASH_EXCLUDE:
            d.pop(k, None)
        return d

    def compute_hash(self) -> str:
        return content_hash(
            self.hashable(),
            prefix=f"{self.engine_version}|{self.schema_version}|{self.llm.registry_version}",
        )

    def freeze(self) -> "TerrainSpec":
        self.content_hash = self.compute_hash()
        self.frozen_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return self

    def verify(self) -> bool:
        return bool(self.content_hash) and self.content_hash == self.compute_hash()

    # --- seeds ------------------------------------------------------------- #
    def planet_seed(self) -> int:
        return derive_seed(self.universe_seed, self.planet_id)

    def stage_seed(self, index: int) -> int:
        st = self.pipeline[index]
        return derive_seed(self.planet_seed(), index, st.id, st.op, st.seed_salt)

    # --- io ---------------------------------------------------------------- #
    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "engine_version": self.engine_version,
            "planet_id": self.planet_id,
            "universe_seed": self.universe_seed,
            "archetype": self.archetype,
            "grid": self.grid.to_dict(),
            "pipeline": [s.to_dict() for s in self.pipeline],
            "derived": self.derived,
            "provenance_map": dict(sorted(self.provenance_map.items())),
            "envelope_hash": self.envelope_hash,
            "revision": self.revision,
            "supersedes": self.supersedes,
            "llm": self.llm.to_dict(),
            "content_hash": self.content_hash,
            "frozen_at": self.frozen_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TerrainSpec":
        return cls(
            planet_id=d["planet_id"],
            universe_seed=int(d["universe_seed"]),
            grid=GridSpec.from_dict(d.get("grid") or {}),
            pipeline=[StageSpec.from_dict(s) for s in (d.get("pipeline") or [])],
            archetype=d.get("archetype", "unknown"),
            provenance_map=dict(d.get("provenance_map") or {}),
            derived=dict(d.get("derived") or {}),
            envelope_hash=d.get("envelope_hash", ""),
            schema_version=d.get("schema_version", SCHEMA_VERSION),
            engine_version=d.get("engine_version", ENGINE_VERSION),
            revision=int(d.get("revision", 1)),
            supersedes=d.get("supersedes"),
            llm=LLMTrace.from_dict(d.get("llm") or {}),
            content_hash=d.get("content_hash", ""),
            frozen_at=d.get("frozen_at", ""),
        )
