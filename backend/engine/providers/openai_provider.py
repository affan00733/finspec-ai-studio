"""OpenAI provider using the Responses API (``client.responses.create``)."""
from __future__ import annotations

import os
from typing import Any, Optional

from .base import BaseProvider, LLMResponse, ProviderError, ProviderNotConfigured


def _extract_text(resp: Any) -> str:
    text = getattr(resp, "output_text", None)
    if text:
        return text
    parts = []
    for item in getattr(resp, "output", None) or []:
        for c in getattr(item, "content", None) or []:
            t = getattr(c, "text", None)
            if t:
                parts.append(t)
    return "".join(parts)


def _usage(resp: Any) -> dict:
    u = getattr(resp, "usage", None)
    if not u:
        return {}
    return {
        "input_tokens": getattr(u, "input_tokens", None),
        "output_tokens": getattr(u, "output_tokens", None),
        "total_tokens": getattr(u, "total_tokens", None),
    }


class ResponsesProvider(BaseProvider):
    """Shared Responses-API call logic for OpenAI and Azure OpenAI."""

    is_paid = True

    def __init__(self, client: Any = None, model: Optional[str] = None, timeout: float = 60.0):
        self._client = client
        self._model = model
        self.timeout = timeout

    # subclasses implement
    def _build_client(self) -> Any:  # pragma: no cover - network client construction
        raise NotImplementedError

    def _missing_config(self) -> list[str]:
        return []

    def is_configured(self) -> bool:
        return self._client is not None or not self._missing_config()

    @property
    def model(self) -> str:
        return self._model or self.default_model

    def client(self) -> Any:
        if self._client is None:
            missing = self._missing_config()
            if missing:
                raise ProviderNotConfigured(
                    f"{self.name} provider is not configured: set {', '.join(missing)}.", self.name)
            self._client = self._build_client()
        return self._client

    def generate(self, system, user, *, json_schema=None, schema_name="result", temperature=None,
                 max_output_tokens=2000, model=None) -> LLMResponse:
        client = self.client()
        use_model = model or self.model
        if not use_model:
            raise ProviderNotConfigured(f"{self.name} provider has no model/deployment configured.", self.name)
        kwargs: dict = {
            "model": use_model,
            "instructions": system,
            "input": user,
            "max_output_tokens": max_output_tokens,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if json_schema:
            kwargs["text"] = {"format": {"type": "json_schema", "name": schema_name,
                                         "schema": json_schema, "strict": True}}
        try:
            resp = client.responses.create(**kwargs)
        except ProviderError:
            raise
        except Exception as exc:  # network / auth / rate limit / bad request
            raise ProviderError(f"{self.name} request failed: {type(exc).__name__}: {exc}", self.name) from exc
        status = getattr(resp, "status", None)
        if status in ("failed", "cancelled", "incomplete"):
            reason = getattr(getattr(resp, "incomplete_details", None), "reason", None) or \
                getattr(getattr(resp, "error", None), "message", None) or status
            raise ProviderError(f"{self.name} response {status}: {reason}", self.name)
        text = _extract_text(resp)
        if not text:
            raise ProviderError(f"{self.name} returned an empty response.", self.name, "empty_response")
        return LLMResponse(text=text, provider=self.name, model=use_model, usage=_usage(resp),
                           response_id=getattr(resp, "id", None))


class OpenAIProvider(ResponsesProvider):
    name = "openai"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None,
                 base_url: Optional[str] = None, client: Any = None, timeout: float = 60.0):
        super().__init__(client=client, model=model, timeout=timeout)
        self.api_key = api_key if api_key is not None else os.environ.get("OPENAI_API_KEY", "")
        self.base_url = base_url or os.environ.get("OPENAI_BASE_URL") or None
        self.default_model = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")

    def _missing_config(self) -> list[str]:
        return [] if self.api_key else ["OPENAI_API_KEY"]

    def _build_client(self) -> Any:  # pragma: no cover
        from openai import OpenAI

        return OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout, max_retries=2)

    def status(self) -> dict:
        s = super().status()
        s.update({"api": "responses", "missing": self._missing_config(),
                  "base_url": self.base_url or "https://api.openai.com/v1"})
        return s
