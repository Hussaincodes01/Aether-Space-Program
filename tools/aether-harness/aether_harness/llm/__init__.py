"""LLM layer: providers, prompt construction, structured-output loop."""

from .prompt import SYSTEM, build_user_message, prompt_hash
from .providers import (AnthropicProvider, GoogleProvider, MockProvider, OllamaProvider,
                        OpenAICompatProvider, Provider, ProviderError, build_provider, masked)
from .structured import Outcome, author_spec

__all__ = ["SYSTEM", "build_user_message", "prompt_hash", "Provider", "ProviderError",
           "AnthropicProvider", "OpenAICompatProvider", "GoogleProvider", "OllamaProvider",
           "MockProvider", "build_provider", "masked", "author_spec", "Outcome"]
