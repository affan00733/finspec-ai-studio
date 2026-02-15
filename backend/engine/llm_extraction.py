"""LLM-backed extraction with strict grounding verification.

Model output is *untrusted*: a value is only accepted when its quote is found
verbatim in a retrieved chunk and the number appears in that quote. Provider
failures propagate as ``ProviderError``; there is no fallback to another
provider or to the deterministic reader.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Optional

from . import prompts as P
from .extraction import DeterministicExtractor, _resolve_units
from .numeric import SCALE_WORDS, decimals_of, detect_emission_unit, parse_number
from .providers.base import BaseProvider, ProviderError
from .retrieval import RetrievalIndex
from .types import Candidate, ChunkRef, DocContext, ExtractionOutcome, SpecDef

_SCALE_BY_NAME = {"units": Decimal(1), "thousands": Decimal(10) ** 3, "millions": Decimal(10) ** 6,
                  "billions": Decimal(10) ** 9}


def _locate(quote: str, text: str) -> Optional[tuple[int, int]]:
    """Find ``quote`` in ``text`` ignoring whitespace differences. Returns (start, end)."""
    q = quote.strip()
    if not q:
        return None
    i = text.find(q)
    if i >= 0:
        return i, i + len(q)
    pat = r"\s+".join(re.escape(tok) for tok in q.split())
    m = re.search(pat, text)
    return (m.start(), m.end()) if m else None


class LLMExtractor:
    def __init__(self, index: RetrievalIndex, provider: BaseProvider, system_prompt: str = P.EXTRACTION_SYSTEM_V2,
                 user_template: str = P.EXTRACTION_USER, output_schema: Optional[dict] = None,
                 model: Optional[str] = None, temperature: Optional[float] = 0.0, max_output_tokens: int = 1200):
        self.index = index
        self.provider = provider
        self.system_prompt = system_prompt
        self.user_template = user_template
        self.output_schema = output_schema or P.EXTRACTION_SCHEMA
        self.model = model
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens
        self._det = DeterministicExtractor(index)
        self.last_prompt: Optional[dict] = None
        self.usage: dict = {"input_tokens": 0, "output_tokens": 0, "calls": 0}

    def extract(self, spec: SpecDef, document_id, ctx: DocContext, company: str = "", top_k: int = 8,
                mode: str = "hybrid", graph_expansion: bool = True,
                target_year: Optional[int] = None) -> ExtractionOutcome:
        year = target_year or ctx.fiscal_year
        hits = self._det.retrieve(spec, document_id, top_k=top_k, mode=mode, graph_expansion=graph_expansion)
        retrieved = [h.chunk.id for h in hits]
        out = ExtractionOutcome(spec_key=spec.key, status="not_found", fiscal_year=year, retrieved_chunk_ids=retrieved)
        if not hits:
            out.rationale = "No excerpts retrieved for this metric."
            return out
        prompt = P.generate_extraction_prompt(spec, company, year, hits, self.system_prompt, self.user_template,
                                              self.output_schema)
        self.last_prompt = prompt
        resp = self.provider.generate(
            prompt["system"], prompt["user"], json_schema=self.output_schema, schema_name="extraction",
            temperature=self.temperature, max_output_tokens=self.max_output_tokens, model=self.model)
        self.usage["calls"] += 1
        self.usage["input_tokens"] += int(resp.usage.get("input_tokens") or 0)
        self.usage["output_tokens"] += int(resp.usage.get("output_tokens") or 0)
        data = resp.json()
        if not isinstance(data, dict) or "found" not in data:
            raise ProviderError("Model output does not match the extraction schema.", resp.provider, "schema_mismatch")
        if not data.get("found"):
            out.rationale = f"Model reported not found: {data.get('rationale', '')}".strip()
            return out
        return self._verify(spec, data, hits, ctx, year, out, resp.provider)

    def _reject(self, out: ExtractionOutcome, why: str) -> ExtractionOutcome:
        out.status = "rejected"
        out.best = None
        out.rationale = f"Model output rejected: {why}"
        return out

    def _verify(self, spec, data, hits, ctx, year, out, provider_name) -> ExtractionOutcome:
        by_id = {str(h.chunk.id): h.chunk for h in hits}
        chunk: Optional[ChunkRef] = by_id.get(str(data.get("chunk_id")))
        quote = (data.get("quote") or "").strip()
        raw = str(data.get("value") or "").strip()
        if chunk is None:
            return self._reject(out, f"chunk_id {data.get('chunk_id')!r} was not among the retrieved excerpts")
        loc = _locate(quote, chunk.text)
        if not loc:
            return self._reject(out, "quote not found verbatim in the cited excerpt")
        value = parse_number(raw)
        if value is None:
            return self._reject(out, f"value {raw!r} is not a parseable number")
        quote_exact = chunk.text[loc[0]:loc[1]]
        digits = re.sub(r"\D", "", raw)
        if not digits or digits not in re.sub(r"\D", "", quote_exact):
            return self._reject(out, "value does not appear in the quoted evidence")
        if data.get("fiscal_year") not in (None, year) and year is not None:
            return self._reject(out, f"model answered fiscal year {data.get('fiscal_year')}, target is {year}")
        notes: list[str] = [f"provider:{provider_name}"]
        # Evidence-based unit resolution (document text wins over the model's claim).
        if spec.unit_type == "emissions":
            _, mult, ulabel, usrc = _resolve_units(spec, quote_exact, "", chunk, ctx)
            claimed = detect_emission_unit((data.get("unit_label") or "").replace("₂", "2"))
            if usrc == "unknown" and claimed:
                mult, ulabel = claimed
                notes.append("unit_from_model_unverified")
            elif claimed and claimed[0] != mult:
                notes.append(f"unit_overridden_by_document:{claimed[1]}->{ulabel}")
            cur = None
        else:
            cur, mult, ulabel, usrc = _resolve_units(spec, quote_exact, "", chunk, ctx)
            claimed_scale = _SCALE_BY_NAME.get((data.get("unit_scale") or "").lower())
            if usrc == "unknown" and claimed_scale is not None:
                mult = claimed_scale
                ulabel = f"{data.get('currency') or ''} {data.get('unit_scale')}".strip()
                notes.append("unit_from_model_unverified")
            elif claimed_scale is not None and claimed_scale != mult:
                notes.append(f"unit_overridden_by_document:{data.get('unit_scale')}")
            cur = cur or data.get("currency")
        if spec.sign_policy == "absolute" and value < 0:
            value = abs(value)
            notes.append("sign_normalized")
        start = chunk.start_char + loc[0]
        dec = decimals_of(raw)
        conf = float(data.get("confidence") or 0.0)
        cand = Candidate(
            spec_key=spec.key, method="llm", label=spec.name, raw_number=raw, value=value, scale=mult,
            currency=cur, unit_label=ulabel, normalized=value * mult, granularity=Decimal(1).scaleb(-dec) * mult,
            chunk_id=chunk.id, document_id=chunk.document_id, quote=quote_exact, start_char=start,
            end_char=start + len(quote_exact), score=max(0.0, min(conf, 1.0)), year=year,
            year_matched=data.get("fiscal_year") == year if year else None, unit_source=usrc, notes=notes,
            context=chunk.heading,
        )
        out.status = "found"
        out.best = cand
        out.candidates = [cand]
        out.confidence = round(min(max(conf, 0.0), 0.99), 3)
        out.rationale = f"[{provider_name}] {data.get('rationale', '')}".strip()
        if usrc == "unknown":
            out.warnings.append("unit_not_stated")
        return out
