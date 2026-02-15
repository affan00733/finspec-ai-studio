"""Azure OpenAI provider (Responses API against an Azure deployment)."""
from __future__ import annotations

import os
from typing import Any, Optional

from .openai_provider import ResponsesProvider


class AzureOpenAIProvider(ResponsesProvider):
    name = "azure"

    def __init__(self, endpoint: Optional[str] = None, api_key: Optional[str] = None,
                 api_version: Optional[str] = None, deployment: Optional[str] = None,
                 client: Any = None, timeout: float = 60.0):
        super().__init__(client=client, model=deployment, timeout=timeout)
        self.endpoint = endpoint if endpoint is not None else os.environ.get("AZURE_OPENAI_ENDPOINT", "")
        self.api_key = api_key if api_key is not None else os.environ.get("AZURE_OPENAI_API_KEY", "")
        self.api_version = api_version or os.environ.get("AZURE_OPENAI_API_VERSION", "2025-03-01-preview")
        self.default_model = deployment or os.environ.get("AZURE_OPENAI_DEPLOYMENT", "")

    def _missing_config(self) -> list[str]:
        missing = []
        if not self.endpoint:
            missing.append("AZURE_OPENAI_ENDPOINT")
        if not self.api_key:
            missing.append("AZURE_OPENAI_API_KEY")
        if not (self._model or self.default_model):
            missing.append("AZURE_OPENAI_DEPLOYMENT")
        return missing

    def _build_client(self) -> Any:  # pragma: no cover
        from openai import AzureOpenAI

        return AzureOpenAI(azure_endpoint=self.endpoint, api_key=self.api_key,
                           api_version=self.api_version, timeout=self.timeout, max_retries=2)

    def status(self) -> dict:
        s = super().status()
        s.update({"api": "responses", "missing": self._missing_config(), "endpoint": self.endpoint or None,
                  "api_version": self.api_version, "deployment": self.default_model or None})
        return s
