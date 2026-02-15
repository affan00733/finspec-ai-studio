"""Offline mock provider.

It behaves like a very literal LLM: it reads the structured prompt (the
``<task .../>`` tag and ``<chunk>`` excerpts produced by ``engine.prompts``),
runs the deterministic text reader over *only those excerpts*, and answers in
the same JSON schema a real model would. It never invents values.
"""
from __future__ import annotations

import html
import json
import re
from decimal import Decimal
from typing import Optional

from .base import BaseProvider, LLMResponse, ProviderError

_TASK_RE = re.compile(r"<task\s+([^>]*?)/>", re.DOTALL)
_ATTR_RE = re.compile(r'(\w+)="([^"]*)"')
_CHUNK_RE = re.compile(r"<chunk\s+([^>]*?)>\n(.*?)\n</chunk>", re.DOTALL)


def _attrs(s: str) -> dict:
    return {k: html.unescape(v) for k, v in _ATTR_RE.findall(s)}


class MockProvider(BaseProvider):
    name = "mock"
    is_paid = False
    default_model = "mock-deterministic-1"

    def status(self) -> dict:
        s = super().status()
        s.update({"offline": True, "note": "Deterministic offline reader; no network calls."})
        return s

    def generate(self, system, user, *, json_schema=None, schema_name="result", temperature=None,
                 max_output_tokens=2000, model=None) -> LLMResponse:
        chunks = [(_attrs(a), body) for a, body in _CHUNK_RE.findall(user)]
        task = _TASK_RE.search(user)
        if task:
            payload = self._extract(_attrs(task.group(1)), chunks)
        elif "Question:" in user:
            payload = self._chat(user, chunks)
        else:
            raise ProviderError("Mock provider cannot interpret this prompt (no <task/> tag or Question).", "mock")
        return LLMResponse(text=json.dumps(payload), provider="mock", model=model or self.default_model,
                           usage={"input_tokens": len(user) // 4, "output_tokens": 0, "total_tokens": len(user) // 4})

    # ------------------------------------------------------------------ extraction
    def _extract(self, task: dict, chunks: list[tuple[dict, str]]) -> dict:
        from ..extraction import _SpecMatcher, scan_chunk, select_outcome
        from ..numeric import scale_label
        from ..parsing import detect_context
        from ..types import ChunkRef, SpecDef

        fy = int(task["fiscal_year"]) if task.get("fiscal_year", "").isdigit() else None
        spec = SpecDef(
            key=task["spec_key"], name=task["spec_name"],
            aliases=[a for a in task.get("aliases", "").split("|") if a],
            unit_type=task.get("unit_type", "currency"), sign_policy=task.get("sign_policy", "as_reported"),
            exclude_terms=[e for e in task.get("exclude", "").split("|") if e],
        )
        matcher = _SpecMatcher(spec)
        refs = []
        for i, (a, body) in enumerate(chunks):
            refs.append(ChunkRef(id=a.get("id"), document_id=a.get("document"), index=i, text=body,
                                 start_char=int(a.get("start", 0) or 0), end_char=0,
                                 chunk_type=a.get("type", "text"), heading=a.get("section", "")))
        ctx = detect_context("\n".join(r.text for r in refs), fy)
        cands = []
        missing: list[str] = []
        for r in refs:
            res = scan_chunk(r, matcher, ctx, fy)
            cands.extend(res.candidates)
            missing.extend(res.missing)
        out = select_outcome(spec, cands, missing, fy, [r.id for r in refs])
        if out.status != "found" or not out.best:
            return {"found": False, "value": None, "currency": None, "unit_scale": None, "unit_label": None,
                    "fiscal_year": fy, "chunk_id": None, "quote": None, "confidence": 0.0,
                    "rationale": out.rationale}
        b = out.best
        is_em = spec.unit_type == "emissions"
        return {
            "found": True, "value": b.raw_number, "currency": b.currency,
            "unit_scale": None if is_em else scale_label(Decimal(b.scale)),
            "unit_label": b.unit_label if is_em else None,
            "fiscal_year": fy, "chunk_id": str(b.chunk_id), "quote": b.quote,
            "confidence": float(out.confidence), "rationale": out.rationale,
        }

    # ------------------------------------------------------------------ chat
    def _chat(self, user: str, chunks: list[tuple[dict, str]]) -> dict:
        from ..retrieval import tokenize

        q = user.split("Question:", 1)[1].split("\n\nExcerpts:", 1)[0].strip()
        q_terms = set(tokenize(q))
        best: list[tuple[float, str, str]] = []
        for a, body in chunks:
            for sent in re.split(r"(?<=[.!?])\s+|\n", body):
                s = sent.strip()
                if len(s) < 20:
                    continue
                overlap = len(q_terms & set(tokenize(s)))
                if overlap:
                    best.append((overlap, a.get("id", ""), s))
        best.sort(key=lambda x: -x[0])
        top = best[:3]
        if not top:
            return {"answer": "The provided excerpts do not contain information that answers this question.",
                    "citations": []}
        return {"answer": " ".join(f"{s} [chunk:{cid}]" for _, cid, s in top),
                "citations": list(dict.fromkeys(cid for _, cid, _ in top))}
