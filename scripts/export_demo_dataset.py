"""Export the synthetic demo corpus for the browser demo engine.

Usage (from repo root):
    .venv/bin/python scripts/export_demo_dataset.py

Writes frontend/src/data/demo-dataset.json containing companies, documents (full text, sections,
chunks, chunk graph), specifications, prompt templates, ground truth and a reference run of the
Python deterministic extractor (used by frontend parity tests).
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from engine.chunking import chunk_document  # noqa: E402
from engine.demo_corpus import PROFILES, build_corpus  # noqa: E402
from engine.extraction import DeterministicExtractor  # noqa: E402
from engine.parsing import detect_context, detect_sections, normalize_text  # noqa: E402
from engine.prompts import DEFAULT_PROMPTS  # noqa: E402
from engine.retrieval import RetrievalIndex  # noqa: E402
from engine.specs import DEFAULT_SPECS, default_spec_defs  # noqa: E402
from engine.types import ChunkRef  # noqa: E402

OUT = ROOT / "frontend" / "src" / "data" / "demo-dataset.json"


def dec(v):
    return None if v is None else format(Decimal(v), "f")


def main() -> None:
    companies = []
    comp_id = {}
    for i, p in enumerate(PROFILES, start=1):
        comp_id[p.name] = i
        companies.append({"id": i, "name": p.name, "ticker": p.ticker, "sector": p.sector,
                          "description": p.description, "reporting_currency": p.currency, "is_fictional": True,
                          "revenue_label": p.revenue_label, "revenue_key": p.revenue_key})
    docs = []
    refs: list[ChunkRef] = []
    edges = []
    next_chunk_id = 1
    ctxs = {}
    for doc_id, item in enumerate(build_corpus(), start=1):
        text = normalize_text(item["text"])
        secs = detect_sections(text)
        cspecs, rels = chunk_document(text, secs)
        ctx = detect_context(text, item["fiscal_year"])
        ctxs[doc_id] = ctx
        ids = {}
        chunks = []
        for c in cspecs:
            assert text[c.start:c.end] == c.text
            ids[c.index] = next_chunk_id
            chunks.append({"id": next_chunk_id, "index": c.index, "chunk_type": c.chunk_type, "heading": c.heading,
                           "text": c.text, "start_char": c.start, "end_char": c.end,
                           "section": c.section_index, "meta": c.meta})
            refs.append(ChunkRef(id=next_chunk_id, document_id=doc_id, index=c.index, text=c.text,
                                 start_char=c.start, end_char=c.end, chunk_type=c.chunk_type,
                                 heading=c.heading, meta=c.meta))
            next_chunk_id += 1
        rel_out = []
        for r in rels:
            rel_out.append({"source": ids[r.source], "target": ids[r.target], "relation": r.relation,
                            "weight": r.weight})
            edges.append((ids[r.source], ids[r.target], r.relation, r.weight))
        docs.append({
            "id": doc_id, "company_id": comp_id[item["company"]], "company_name": item["company"],
            "title": item["title"], "doc_type": "annual_report", "fiscal_year": item["fiscal_year"],
            "source_filename": item["filename"], "raw_text": text,
            "context": {"fiscal_year": ctx.fiscal_year, "currency": ctx.currency,
                        "scale": dec(ctx.scale), "emission_unit": [dec(ctx.emission_unit[0]), ctx.emission_unit[1]] if ctx.emission_unit else None},
            "sections": [{"order": i, "heading": s.heading, "level": s.level, "section_type": s.section_type,
                          "start_char": s.start, "end_char": s.end} for i, s in enumerate(secs)],
            "chunks": chunks, "relationships": rel_out,
            "gold": {k: dec(v) for k, v in item["gold"].items()},
        })

    index = RetrievalIndex(refs, edges)
    extractor = DeterministicExtractor(index)
    specs = default_spec_defs()
    reference = []
    for d in docs:
        ctx = ctxs[d["id"]]
        for s in specs:
            o = extractor.extract(s, d["id"], ctx)
            reference.append({
                "document_id": d["id"], "spec_key": s.key, "status": o.status,
                "normalized": dec(o.best.normalized) if o.best else None,
                "raw_number": o.best.raw_number if o.best else None,
                "quote": o.best.quote if o.best else None,
                "start_char": o.best.start_char if o.best else None,
                "method": o.best.method if o.best else None,
                "confidence": o.confidence,
                "retrieved": len(o.retrieved_chunk_ids),
            })
    payload = {
        "companies": companies, "documents": docs, "specifications": DEFAULT_SPECS,
        "prompts": DEFAULT_PROMPTS, "reference": reference,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    ok = sum(1 for r in reference if r["status"] == "found")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): {len(docs)} docs, {sum(len(d['chunks']) for d in docs)} chunks, "
          f"{len(specs)} specs, reference found={ok}/{len(reference)}")


if __name__ == "__main__":
    main()
