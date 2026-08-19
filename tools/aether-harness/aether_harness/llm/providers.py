"""BYOK provider layer.

Every provider is asked for the same thing: a JSON object conforming to a schema,
at temperature 0. Each does it differently, so the differences are quarantined
here and nothing downstream knows which model produced a spec.

  Anthropic          forced tool_choice on a single tool whose input_schema is the
                     contract. The most reliable structured-output mechanism.
  OpenAI-compatible  response_format=json_schema with strict=true, falling back to
                     json_object for endpoints that only support the older mode.
  Google             generationConfig.responseSchema (a restricted JSON Schema
                     dialect, so the schema is down-converted).
  Ollama             format=json plus schema-in-prompt. Local, zero cost, weakest
                     guarantees — the repair loop carries more weight here.
  Mock               deterministic, offline, no credentials. Used by the test suite
                     and by ``--offline`` so the harness is always runnable.

Credentials are read from the environment only, never logged, and only ever shown
through ``masked()``.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class ProviderError(RuntimeError):
    pass


def masked(secret: str | None) -> str:
    if not secret:
        return "<unset>"
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}...{secret[-4:]} ({len(secret)} chars)"


def _post(url: str, payload: dict, headers: dict, timeout: float = 120.0) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            # Cloudflare-fronted endpoints answer 403 with error 1010 -- "banned browser
            # signature" -- to urllib's default agent string. OpenCode Zen is one of them,
            # and without this every call to it fails before reaching the model.
            "User-Agent": "aether-harness/0.4 (+https://github.com/Hussaincodes01/Aether-Space-Program)",
            "Accept": "application/json",
            **headers,
        },
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:600]
        raise ProviderError(f"HTTP {exc.code} from {url}: {body}") from None
    except urllib.error.URLError as exc:
        raise ProviderError(f"cannot reach {url}: {exc.reason}") from None


@dataclass
class Completion:
    data: dict
    tokens_in: int = 0
    tokens_out: int = 0
    latency_s: float = 0.0
    raw_text: str = ""


class Provider:
    name = "base"
    default_model = ""

    def __init__(self, model: str | None = None, *, api_key_env: str | None = None,
                 base_url: str | None = None, timeout: float = 120.0):
        self.model = model or self.default_model
        self.api_key_env = api_key_env
        self.base_url = base_url
        self.timeout = timeout
        self.api_key = os.environ.get(api_key_env or "", "") if api_key_env else ""

    def describe(self) -> str:
        return (f"{self.name}/{self.model} key={self.api_key_env or '-'}"
                f"={masked(self.api_key)}")

    def require_key(self) -> None:
        if self.api_key_env and not self.api_key:
            raise ProviderError(
                f"{self.name} needs ${self.api_key_env}; export it or use --offline")

    def complete_json(self, system: str, user: str, schema: dict,
                      temperature: float = 0.0, max_tokens: int = 6000) -> Completion:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
class AnthropicProvider(Provider):
    name = "anthropic"
    default_model = "claude-sonnet-4-6"

    def complete_json(self, system, user, schema, temperature=0.0, max_tokens=6000):
        self.require_key()
        t0 = time.perf_counter()
        body = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "tools": [{"name": "emit_terrain_spec",
                       "description": "Emit the terrain generation pipeline.",
                       "input_schema": schema}],
            "tool_choice": {"type": "tool", "name": "emit_terrain_spec"},
        }
        d = _post((self.base_url or "https://api.anthropic.com") + "/v1/messages", body,
                  {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
                  self.timeout)
        blocks = [b for b in d.get("content", []) if b.get("type") == "tool_use"]
        if not blocks:
            raise ProviderError("model returned no tool_use block")
        u = d.get("usage", {})
        return Completion(blocks[0]["input"], u.get("input_tokens", 0),
                          u.get("output_tokens", 0), time.perf_counter() - t0)


class OpenAICompatProvider(Provider):
    """Works with OpenAI, Together, Groq, Fireworks, vLLM, LM Studio, OpenRouter."""

    name = "openai_compat"
    default_model = "gpt-4.1"

    def complete_json(self, system, user, schema, temperature=0.0, max_tokens=6000):
        self.require_key()
        t0 = time.perf_counter()
        url = (self.base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        body = {"model": self.model, "temperature": temperature, "max_tokens": max_tokens,
                "messages": msgs,
                "response_format": {"type": "json_schema",
                                    "json_schema": {"name": "terrain_spec", "strict": False,
                                                    "schema": schema}}}
        try:
            d = _post(url, body, {"Authorization": f"Bearer {self.api_key}"}, self.timeout)
        except ProviderError:
            body["response_format"] = {"type": "json_object"}
            body["messages"][0]["content"] = system + "\n\nRespond with a single JSON object only."
            d = _post(url, body, {"Authorization": f"Bearer {self.api_key}"}, self.timeout)
        choice = d["choices"][0]
        text = choice["message"]["content"]
        u = d.get("usage", {})

        # An empty body with a "length" finish is a reasoning model that spent the whole
        # budget thinking and never got to the answer. `max_tokens` covers reasoning plus
        # content on these, so the fix is a bigger budget, not a retry -- and saying which
        # it was turns "no JSON object in response: ''" into something actionable.
        if not (text or "").strip():
            reasoning = choice["message"].get("reasoning_content") or ""
            raise ProviderError(
                f"empty response from {self.model}: finish_reason="
                f"{choice.get('finish_reason')!r}, "
                f"{u.get('completion_tokens', 0)} completion tokens, "
                f"{len(reasoning)} characters of reasoning. "
                + ("Raise max_tokens: the budget covers reasoning and answer together."
                   if choice.get("finish_reason") == "length" else "")
            )

        return Completion(_loads(text), u.get("prompt_tokens", 0),
                          u.get("completion_tokens", 0), time.perf_counter() - t0, text)


class GoogleProvider(Provider):
    name = "google"
    default_model = "gemini-2.5-pro"

    def complete_json(self, system, user, schema, temperature=0.0, max_tokens=6000):
        self.require_key()
        t0 = time.perf_counter()
        base = self.base_url or "https://generativelanguage.googleapis.com/v1beta"
        url = f"{base}/models/{self.model}:generateContent?key={self.api_key}"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": temperature,
                                 "maxOutputTokens": max_tokens,
                                 "responseMimeType": "application/json",
                                 "responseSchema": _to_google_schema(schema)},
        }
        d = _post(url, body, {}, self.timeout)
        text = d["candidates"][0]["content"]["parts"][0]["text"]
        u = d.get("usageMetadata", {})
        return Completion(_loads(text), u.get("promptTokenCount", 0),
                          u.get("candidatesTokenCount", 0), time.perf_counter() - t0, text)


class OllamaProvider(Provider):
    name = "ollama"
    default_model = "llama3.1:8b"

    def complete_json(self, system, user, schema, temperature=0.0, max_tokens=6000):
        t0 = time.perf_counter()
        url = (self.base_url or "http://localhost:11434").rstrip("/") + "/api/chat"
        sys_full = (system + "\n\nReturn ONE JSON object matching this schema exactly:\n"
                    + json.dumps(schema))
        body = {"model": self.model, "stream": False, "format": "json",
                "options": {"temperature": temperature, "num_predict": max_tokens},
                "messages": [{"role": "system", "content": sys_full},
                             {"role": "user", "content": user}]}
        d = _post(url, body, {}, self.timeout)
        text = d["message"]["content"]
        return Completion(_loads(text), d.get("prompt_eval_count", 0),
                          d.get("eval_count", 0), time.perf_counter() - t0, text)


class MockProvider(Provider):
    """Offline provider: returns the archetype template, deterministically.

    Not a stub for testing convenience only — it is the harness's guaranteed floor.
    Anything the LLM produces has to beat this, and the executor/validator path is
    identical, so the offline mode exercises the full pipeline."""

    name = "mock"
    default_model = "archetype-template"

    def __init__(self, model=None, **kw):
        super().__init__(model, **kw)
        self._proposal: dict | None = None

    def prime(self, proposal: dict) -> None:
        self._proposal = proposal

    def complete_json(self, system, user, schema, temperature=0.0, max_tokens=6000):
        if self._proposal is None:
            raise ProviderError("MockProvider was not primed with a proposal")
        return Completion(json.loads(json.dumps(self._proposal)), 0, 0, 0.0)


# --------------------------------------------------------------------------- #
def _loads(text: str) -> dict:
    """Tolerant JSON extraction: strips fences and finds the outermost object."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1]
        t = t.rsplit("```", 1)[0]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        i, j = t.find("{"), t.rfind("}")
        if i >= 0 and j > i:
            return json.loads(t[i:j + 1])
        raise ProviderError(f"no JSON object in response: {text[:200]!r}") from None


def _to_google_schema(schema: dict) -> dict:
    """Down-convert to Google's restricted dialect (no additionalProperties, no
    union types, no unconstrained objects)."""
    def conv(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        out: dict = {}
        for k, v in node.items():
            if k in ("additionalProperties", "minItems", "maxItems", "strict"):
                continue
            if k == "type" and isinstance(v, list):
                out["type"] = next((t for t in v if t != "null"), "string")
                out["nullable"] = True
            elif k == "properties":
                out["properties"] = {pk: conv(pv) for pk, pv in v.items()}
            elif k == "items":
                out["items"] = conv(v)
            else:
                out[k] = conv(v)
        if out.get("type") == "object" and "properties" not in out:
            out = {"type": "string", "description": node.get("description", "JSON object")}
        return out
    return conv(schema)


class OpenCodeProvider(OpenAICompatProvider):
    """OpenCode Zen.

    OpenAI-compatible, so the parent does all the work; this only pins the base URL and
    names a default model that costs nothing. The `-free` suffix is load-bearing -- Zen
    resells billed models through the same endpoint, and an unattended catalogue build
    should not be able to wander onto one.

    Two things differ from OpenAI in practice:

      * The endpoint is behind Cloudflare, which rejects urllib's default agent string.
        Handled in `_post`.
      * DeepSeek returns `reasoning_content` alongside `content`, and `max_tokens` covers
        both. A budget sized for the answer alone gets spent on reasoning and returns an
        empty string having consumed every token, so `complete_json` floors it.
    """

    name = "opencode"
    default_model = "deepseek-v4-flash-free"

    def __init__(self, model=None, **kw):
        # `setdefault` is not enough: build_provider always passes base_url as an explicit
        # keyword, so the key is present with value None and setdefault leaves it alone.
        # That sent every call to api.openai.com and returned 401 with an OpenCode key.
        if not kw.get("base_url"):
            kw["base_url"] = "https://opencode.ai/zen/v1"
        super().__init__(model, **kw)

    def complete_json(self, system, user, schema, temperature=0.0, max_tokens=6000):
        # Measured against the real operator catalog: a Europa spec produced 29,358
        # characters of reasoning -- the whole 8,000-token budget -- and returned an empty
        # string with finish_reason "length". The budget has to carry the reasoning and the
        # answer, and for this prompt the reasoning alone is most of it.
        return super().complete_json(system, user, schema, temperature,
                                     max(max_tokens, 24000))


PROVIDERS: dict[str, tuple[type[Provider], str | None]] = {
    "anthropic": (AnthropicProvider, "ANTHROPIC_API_KEY"),
    "openai": (OpenAICompatProvider, "OPENAI_API_KEY"),
    "openai_compat": (OpenAICompatProvider, "OPENAI_API_KEY"),
    "opencode": (OpenCodeProvider, "OPENCODE_API_KEY"),
    "google": (GoogleProvider, "GOOGLE_API_KEY"),
    "ollama": (OllamaProvider, None),
    "mock": (MockProvider, None),
}


def build_provider(name: str, model: str | None = None, base_url: str | None = None,
                   api_key_env: str | None = None) -> Provider:
    if name not in PROVIDERS:
        raise ProviderError(f"unknown provider {name!r}; choose from {sorted(PROVIDERS)}")
    cls, env = PROVIDERS[name]
    return cls(model, api_key_env=api_key_env or env, base_url=base_url)
