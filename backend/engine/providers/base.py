"""Provider interface for LLM backends.

Design rule: there is NO silent fallback. If a paid provider is requested but
is not configured or fails, a ``ProviderError`` is raised and surfaced to the
caller; the mock provider is only ever used when explicitly selected.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional


class ProviderError(Exception):
    """Raised when a provider call fails or returns unusable output."""

    def __init__(self, message: str, provider: str = "", code: str = "provider_error"):
        super().__init__(message)
        self.provider = provider
        self.code = code


class ProviderNotConfigured(ProviderError):
    def __init__(self, message: str, provider: str = ""):
        super().__init__(message, provider, "provider_not_configured")


@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    usage: dict = field(default_factory=dict)
    response_id: Optional[str] = None

    def json(self) -> Any:
        return parse_json_text(self.text, self.provider)


def parse_json_text(text: str, provider: str = "") -> Any:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except json.JSONDecodeError as exc:
        raise ProviderError(f"Provider returned invalid JSON: {exc}", provider, "invalid_json") from exc


class BaseProvider:
    name = "base"
    is_paid = False
    default_model = ""

    def is_configured(self) -> bool:
        return True

    def status(self) -> dict:
        return {
            "name": self.name,
            "paid": self.is_paid,
            "configured": self.is_configured(),
            "default_model": self.default_model,
        }

    def generate(
        self,
        system: str,
        user: str,
        *,
        json_schema: Optional[dict] = None,
        schema_name: str = "result",
        temperature: Optional[float] = None,
        max_output_tokens: int = 2000,
        model: Optional[str] = None,
    ) -> LLMResponse:
        raise NotImplementedError
