"""Aether terrain harness: data sources -> physics envelope -> LLM -> frozen spec."""

from .harness import BuildResult, Harness, HarnessConfig
from .models import (CANONICAL_OBS, DerivedEnvironment, FeasibilityEnvelope, GridSpec,
                     PlanetDataCard, Provenance, Quantity, StageSpec, TerrainSpec)
from .physics import classify, derive, envelope
from .registry import REGISTRY, Ctx, Operator, ParamSpec, Registry, load_builtin_operators
from .runner import RunReport, execute, export, preview_png
from .validate import validate_proposal

__version__ = "0.4.0"
__all__ = [
    "Harness", "HarnessConfig", "BuildResult", "PlanetDataCard", "TerrainSpec",
    "StageSpec", "GridSpec", "Quantity", "Provenance", "DerivedEnvironment",
    "FeasibilityEnvelope", "CANONICAL_OBS", "derive", "envelope", "classify",
    "REGISTRY", "Registry", "Operator", "ParamSpec", "Ctx", "load_builtin_operators",
    "execute", "export", "preview_png", "RunReport", "validate_proposal",
]
