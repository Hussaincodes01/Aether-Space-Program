"""The operator registry — the LLM's action space.

The single most important design decision in this harness: the model never writes
code and never invents parameter names. It selects operators from a versioned
catalog and fills in declared, bounded, unit-carrying parameters. Everything the
model is allowed to say is enumerable, which is what makes the output validatable,
repairable, hashable and reproducible.

Adding a new algorithm means registering one class. The prompt, the JSON schema,
the validator and the executor all update from the same declaration.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

import numpy as np

from .fields import FieldSet
from .hashing import content_hash

Kind = str  # "float" | "int" | "bool" | "enum"


@dataclass(frozen=True)
class ParamSpec:
    name: str
    kind: Kind
    default: Any
    lo: float | None = None
    hi: float | None = None
    choices: tuple[str, ...] | None = None
    unit: str = "-"
    doc: str = ""
    log_scale: bool = False

    def coerce(self, value: Any) -> tuple[Any, str | None]:
        """Return (value, repair_note). Never raises — the harness repairs instead."""
        try:
            if self.kind == "bool":
                if isinstance(value, str):
                    return value.strip().lower() in ("true", "1", "yes"), None
                return bool(value), None
            if self.kind == "enum":
                s = str(value)
                if self.choices and s not in self.choices:
                    return self.default, f"{self.name}={s!r} not in {list(self.choices)}"
                return s, None
            num = float(value)
            if not np.isfinite(num):
                return self.default, f"{self.name} non-finite"
            note = None
            if self.lo is not None and num < self.lo:
                note = f"{self.name}={num:g} clamped up to {self.lo:g}"
                num = self.lo
            if self.hi is not None and num > self.hi:
                note = f"{self.name}={num:g} clamped down to {self.hi:g}"
                num = self.hi
            if self.kind == "int":
                return int(round(num)), note
            return num, note
        except (TypeError, ValueError):
            return self.default, f"{self.name}={value!r} not coercible to {self.kind}"

    def describe(self) -> str:
        if self.kind == "enum":
            rng = "{" + "|".join(self.choices or ()) + "}"
        elif self.lo is None and self.hi is None:
            rng = self.kind
        else:
            rng = f"[{self.lo:g}..{self.hi:g}]"
        u = "" if self.unit in ("-", "") else f" {self.unit}"
        return f"{self.name}: {rng}{u} = {self.default!r}  # {self.doc}"

    def to_dict(self) -> dict:
        return {"name": self.name, "kind": self.kind, "default": self.default,
                "lo": self.lo, "hi": self.hi, "choices": list(self.choices or ()),
                "unit": self.unit, "doc": self.doc, "log_scale": self.log_scale}


@dataclass
class Ctx:
    """Everything an operator is allowed to know. No globals, no clock, no I/O."""

    seed: int                                    # deterministic, from spec.stage_seed(i)
    rng: np.random.Generator                     # seeded from ``seed``
    stage_id: str = ""
    mask: np.ndarray | None = None               # gate channel, already normalised 0..1
    derived: dict = field(default_factory=dict)  # physics quantities (read-only)
    grid: Any = None                             # GridSpec


@dataclass
class Operator:
    """A registered generation algorithm."""

    id: str
    category: str
    summary: str
    apply: Callable[[FieldSet, dict, Ctx], None]
    params: tuple[ParamSpec, ...] = ()
    consumes: tuple[str, ...] = ()
    produces: tuple[str, ...] = ("elevation",)
    requires: tuple[str, ...] = ()      # capability gates from physics
    cost: int = 5
    maskable: bool = True
    doc: str = ""

    def param(self, name: str) -> ParamSpec | None:
        for p in self.params:
            if p.name == name:
                return p
        return None

    def defaults(self) -> dict:
        return {p.name: p.default for p in self.params}

    def to_dict(self) -> dict:
        return {"id": self.id, "category": self.category, "summary": self.summary,
                "consumes": list(self.consumes), "produces": list(self.produces),
                "requires": list(self.requires), "cost": self.cost,
                "maskable": self.maskable,
                "params": [p.to_dict() for p in self.params]}


class Registry:
    def __init__(self) -> None:
        self._ops: dict[str, Operator] = {}

    def register(self, op: Operator) -> Operator:
        if op.id in self._ops:
            raise ValueError(f"duplicate operator id {op.id}")
        self._ops[op.id] = op
        return op

    def get(self, op_id: str) -> Operator | None:
        return self._ops.get(op_id)

    def all(self) -> list[Operator]:
        return [self._ops[k] for k in sorted(self._ops)]

    def ids(self) -> list[str]:
        return sorted(self._ops)

    def categories(self) -> list[str]:
        return sorted({o.category for o in self._ops.values()})

    @property
    def version(self) -> str:
        """Content hash of every operator contract. Changing a bound changes this,
        which changes every downstream spec hash — intentionally. Universes are
        pinned to the registry that produced them."""
        return content_hash([o.to_dict() for o in self.all()], length=12)

    # --- prompt rendering -------------------------------------------------- #
    def render_catalog(self, only: Iterable[str] | None = None,
                       clamps: dict[str, tuple[float, float]] | None = None) -> str:
        keep = set(only) if only is not None else set(self._ops)
        clamps = clamps or {}
        out: list[str] = []
        for cat in self.categories():
            ops = [o for o in self.all() if o.category == cat and o.id in keep]
            if not ops:
                continue
            out.append(f"## {cat}")
            for o in ops:
                io = f"reads[{','.join(o.consumes) or '-'}] writes[{','.join(o.produces)}]"
                out.append(f"- {o.id}  (cost {o.cost}, {io})")
                out.append(f"    {o.summary}")
                for p in o.params:
                    line = f"      {p.describe()}"
                    cl = clamps.get(f"{o.id}.{p.name}")
                    if cl:
                        line += f"   [ENVELOPE-NARROWED to {cl[0]:g}..{cl[1]:g}]"
                    out.append(line)
        return "\n".join(out)

    def json_schema(self, allowed: Iterable[str] | None = None) -> dict:
        """Provider-agnostic schema for structured output.

        Per-operator parameter schemas are deliberately *not* expressed as a giant
        oneOf: most providers degrade badly on deeply conditional schemas. Params
        stay a free object and are validated/repaired against the registry after
        the call, which is strictly more reliable.
        """
        ids = sorted(allowed) if allowed is not None else self.ids()
        return {
            "type": "object",
            "additionalProperties": False,
            "required": ["elevation_range_m", "pipeline"],
            "properties": {
                "elevation_range_m": {
                    "type": "number",
                    "description": "Peak-to-trough relief in metres, inside the envelope bound.",
                },
                "sea_level_quantile": {
                    "type": ["number", "null"],
                    "description": "Area fraction below sea level, or null for no hydrosphere.",
                },
                "notes": {"type": "string", "description": "One-paragraph geological story."},
                "pipeline": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 14,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["id", "op", "params", "rationale"],
                        "properties": {
                            "id": {"type": "string", "description": "unique snake_case stage id"},
                            "op": {"type": "string", "enum": ids},
                            "params": {"type": "object"},
                            "mask": {"type": ["string", "null"]},
                            "weight": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                            "seed_salt": {"type": "integer"},
                            "rationale": {
                                "type": "string",
                                "description": "Why this stage, in physical terms. Cite the "
                                               "derived quantity that motivates it.",
                            },
                        },
                    },
                },
            },
        }


REGISTRY = Registry()


def operator(**kw) -> Callable:
    """Decorator: turn a function into a registered operator."""
    def deco(fn: Callable) -> Callable:
        REGISTRY.register(Operator(apply=fn, doc=fn.__doc__ or "", **kw))
        return fn
    return deco


def load_builtin_operators() -> Registry:
    """Import side-effect registration. Idempotent."""
    from .ops import noise, tectonic, erosion, surface, utility  # noqa: F401
    return REGISTRY
