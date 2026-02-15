"""Grounded question answering over indexed documents."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional

from . import prompts as P
from .extraction import DeterministicExtractor
from .providers.base import BaseProvider, ProviderError
from .retrieval import RetrievalIndex
from .specs import REVENUE_FAMILY
from .types import DocContext, SpecDef


@dataclass
class DocInfo:
    id: Any
    company: str
    fiscal_year: Optional[int]
    title: str
    ctx: DocContext


@dataclass
class ChatResult:
    answer: str
    citations: list[dict] = field(default_factory=list)
    extractions: list[dict] = field(default_factory=list)
    retrieved: list[dict] = field(default_factory=list)
    mode: str = "extractive"
    provider: str = "mock"
    model: str = ""
    warnings: list[str] = field(default_factory=list)


def detect_years(text: str) -> list[int]:
    ys = [int(y) for y in re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", text)]
    for m in re.finditer(r"\bFY\s?'?(\d{2})\b", text, re.IGNORECASE):
        ys.append(2000 + int(m.group(1)))
    return list(dict.fromkeys(ys))


def detect_specs(question: str, specs: list[SpecDef]) -> list[SpecDef]:
    """Specs whose alias (or name) is mentioned; longer overlapping mentions win."""
    spans: list[tuple[int, int, SpecDef]] = []
    for s in specs:
        for term in {s.name, *s.aliases}:
            for m in re.finditer(r"(?<![\w-])" + re.escape(term).replace(r"\ ", r"\s+") + r"(?![\w-])",
                                 question, re.IGNORECASE):
                spans.append((m.start(), m.end(), s))
    keep = []
    for a in spans:
        contained = any(b is not a and b[0] <= a[0] and a[1] <= b[1] and (b[1] - b[0]) > (a[1] - a[0]) for b in spans)
        if not contained:
            keep.append(a)
    seen: dict[str, SpecDef] = {}
    for a in sorted(keep, key=lambda x: x[0]):
        seen.setdefault(a[2].key, a[2])
    return list(seen.values())


def fmt_value(c) -> str:
    if c is None:
        return ""
    unit = "tCO2e" if c.unit_label.lower().endswith("co2e") else (c.currency or "units")
    n = c.normalized
    norm = format(n, ",.0f") if n == n.to_integral_value() else format(n, ",.2f")
    return f"{c.raw_number} {c.unit_label} (= {norm} {unit})"


class ChatEngine:
    def __init__(self, index: RetrievalIndex, docs: dict, specs: list[SpecDef], provider: BaseProvider,
                 model: Optional[str] = None, top_k: int = 6):
        self.index = index
        self.docs = docs
        self.specs = specs
        self.provider = provider
        self.model = model
        self.top_k = top_k
        self.extractor = DeterministicExtractor(index)

    def answer(self, question: str, history: Optional[list[dict]] = None) -> ChatResult:
        if not self.docs:
            return ChatResult(answer="No matching indexed documents were found for this question.",
                              provider=self.provider.name, model=self.model or self.provider.default_model,
                              mode="llm" if self.provider.is_paid else "extractive")
        mentioned = detect_specs(question, self.specs)
        if self.provider.name == "mock":
            if mentioned and self.docs:
                return self._answer_with_extraction(question, mentioned)
            return self._answer_via_provider(question, history)
        return self._answer_via_provider(question, history, mentioned)

    # ------------------------------------------------------------------ deterministic / extractive
    def _answer_with_extraction(self, question: str, mentioned: list[SpecDef]) -> ChatResult:
        lines: list[str] = []
        citations: list[dict] = []
        extractions: list[dict] = []
        by_key = {s.key: s for s in self.specs}
        for doc in list(self.docs.values())[:12]:
            for spec in mentioned:
                o = self.extractor.extract(spec, doc.id, doc.ctx)
                head = f"{doc.company} FY{doc.fiscal_year} - {spec.name}"
                rec = {"document_id": doc.id, "company": doc.company, "fiscal_year": doc.fiscal_year,
                       "specification": spec.key, "status": o.status, "confidence": o.confidence}
                if o.status == "found" and o.best:
                    b = o.best
                    lines.append(f"- {head}: {fmt_value(b)}. Source: \"{b.quote}\" [chunk:{b.chunk_id}]")
                    citations.append({"chunk_id": b.chunk_id, "document_id": doc.id, "quote": b.quote,
                                      "start_char": b.start_char, "end_char": b.end_char})
                    rec.update({"value": str(b.normalized), "reported": f"{b.raw_number} {b.unit_label}"})
                elif o.status == "ambiguous":
                    lines.append(f"- {head}: conflicting values found in the document; not selecting one. {o.rationale}")
                else:
                    extra = ""
                    if spec.key in REVENUE_FAMILY:
                        for other_key in REVENUE_FAMILY:
                            if other_key == spec.key or other_key not in by_key:
                                continue
                            o2 = self.extractor.extract(by_key[other_key], doc.id, doc.ctx)
                            if o2.status == "found" and o2.best:
                                extra = (f" This document reports '{by_key[other_key].name}' instead: "
                                         f"{fmt_value(o2.best)}. It is a different line item and was not substituted.")
                                citations.append({"chunk_id": o2.best.chunk_id, "document_id": doc.id,
                                                  "quote": o2.best.quote, "start_char": o2.best.start_char,
                                                  "end_char": o2.best.end_char})
                                break
                    lines.append(f"- {head}: not reported in this document.{extra}")
                extractions.append(rec)
        answer = "Based on the indexed documents:\n" + "\n".join(lines) if lines else \
            "No matching documents are available for this question."
        return ChatResult(answer=answer, citations=citations, extractions=extractions, mode="extractive",
                          provider="mock", model="mock-deterministic-1")

    # ------------------------------------------------------------------ provider (mock chat or LLM)
    def _answer_via_provider(self, question: str, history: Optional[list[dict]] = None,
                             mentioned: Optional[list[SpecDef]] = None) -> ChatResult:
        doc_ids = list(self.docs.keys()) or None
        queries = [question] + [f"{s.name} " + " ".join(s.aliases) for s in (mentioned or [])]
        seen: dict = {}
        for q in queries:
            for h in self.index.search(q, top_k=self.top_k, document_ids=doc_ids):
                if h.chunk.id not in seen:
                    seen[h.chunk.id] = h
        hits = list(seen.values())[: self.top_k * 2]
        if not hits:
            return ChatResult(answer="No relevant excerpts were found in the indexed documents.",
                              provider=self.provider.name, model=self.model or self.provider.default_model,
                              mode="llm" if self.provider.is_paid else "extractive")
        context = P.build_context(hits)
        user = P.render_template(P.CHAT_USER, {"question": question, "context": context})
        if history:
            hist = "\n".join(f"{m.get('role', 'user')}: {m.get('content', '')}" for m in history[-6:])
            user = f"Conversation so far:\n{hist}\n\n" + user
        resp = self.provider.generate(P.CHAT_SYSTEM_V1, user, json_schema=P.CHAT_SCHEMA, schema_name="chat_answer",
                                      temperature=0.0, max_output_tokens=900, model=self.model)
        data = resp.json()
        if not isinstance(data, dict) or "answer" not in data:
            raise ProviderError("Model output does not match the chat schema.", resp.provider, "schema_mismatch")
        valid = {str(h.chunk.id): h for h in hits}
        warnings: list[str] = []
        cites = []
        for cid in data.get("citations") or []:
            cid = str(cid).replace("chunk:", "")
            h = valid.get(cid)
            if h is None:
                warnings.append(f"Model cited unknown chunk '{cid}'; citation dropped.")
                continue
            cites.append({"chunk_id": h.chunk.id, "document_id": h.chunk.document_id,
                          "quote": h.chunk.text[:300], "start_char": h.chunk.start_char,
                          "end_char": h.chunk.end_char})
        if not cites and "do not contain" not in data["answer"].lower():
            warnings.append("Answer has no valid citations; treat as ungrounded.")
        return ChatResult(answer=data["answer"], citations=cites, retrieved=[h.to_dict(False) for h in hits],
                          mode="llm" if self.provider.is_paid else "extractive", provider=resp.provider,
                          model=resp.model, warnings=warnings)
