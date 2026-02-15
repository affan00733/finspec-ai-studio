"""Provider registry. Explicit selection only - no silent fallback."""
from __future__ import annotations

from typing import Optional

from .azure_provider import AzureOpenAIProvider
from .base import BaseProvider, LLMResponse, ProviderError, ProviderNotConfigured
from .mock import MockProvider
from .openai_provider import OpenAIProvider

PROVIDER_CLASSES = {
    "mock": MockProvider,
    "openai": OpenAIProvider,
    "azure": AzureOpenAIProvider,
}


def get_provider(name: str, model: Optional[str] = None, **kwargs) -> BaseProvider:
    """Instantiate a provider. Raises ``ProviderNotConfigured`` for paid providers lacking credentials.

    There is deliberately no fallback to the mock provider.
    """
    key = (name or "").lower()
    if key not in PROVIDER_CLASSES:
        raise ProviderError(f"Unknown provider '{name}'. Choose one of: {', '.join(PROVIDER_CLASSES)}.", key,
                            "unknown_provider")
    if key == "mock":
        return MockProvider()
    if key == "openai":
        p = OpenAIProvider(model=model, **kwargs)
    else:
        p = AzureOpenAIProvider(deployment=model, **kwargs)
    if not p.is_configured():
        raise ProviderNotConfigured(
            f"Provider '{key}' is not configured (missing: {', '.join(p._missing_config())}). "
            f"No fallback to the mock provider is performed.", key)
    return p


def provider_statuses() -> list[dict]:
    out = []
    for key, cls in PROVIDER_CLASSES.items():
        p = cls()
        out.append(p.status())
    return out


__all__ = [
    "BaseProvider", "LLMResponse", "ProviderError", "ProviderNotConfigured", "MockProvider",
    "OpenAIProvider", "AzureOpenAIProvider", "get_provider", "provider_statuses", "PROVIDER_CLASSES",
]
