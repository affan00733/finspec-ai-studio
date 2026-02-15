"""Application services bridging Django models and the pure-Python engine."""
from __future__ import annotations

import hashlib
import re
import time
from collections import Counter
from decimal import Decimal
from typing import Iterable, Optional

from django.db import transaction
from django.utils import timezone

from engine import chat as chat_engine
from engine import evaluation as evaluation_engine
from engine import prompts as prompt_lib
from engine.chunking import chunk_document
from engine.extraction import DeterministicExtractor
from engine.llm_extraction import LLMExtractor
from engine.parsing import detect_context, detect_sections, normalize_text, page_for_offset
from engine.providers import get_provider
from engine.providers.base import ProviderError, ProviderNotConfigured
from engine.retrieval import RetrievalIndex, tokenize
from engine.specs import DEFAULT_SPECS
from engine.types import ChunkRef, DocContext, ExtractionOutcome, SpecDef
from engine.validation import summarize, validate_cross, validate_outcome

from .errors import ApiError
from .models import (
    AgentConfiguration, AnalystReview, AuditEvent, BusinessSpecification, ChunkRelationship, Company, Document,
    DocumentChunk, DocumentSection, EvaluationCase, EvaluationDataset, EvaluationResult, EvaluationRun, Evidence,
    ExtractionResult, ExtractionRun, PromptTemplate, PromptVersion, ValidationResult,
)

Q6 = Decimal("0.000001")


def q6(v: Optional[Decimal]) -> Optional[Decimal]:
    return None if v is None else Decimal(v).quantize(Q6)


# --------------------------------------------------------------------------- audit

def record_audit(actor: str, action: str, entity_type: str, entity_id="", summary: str = "",
                 details: Optional[dict] = None) -> AuditEvent:
    return AuditEvent.objects.create(actor=actor or "system", action=action, entity_type=entity_type,
                                     entity_id=str(entity_id), summary=summary[:300], details=details or {})


# --------------------------------------------------------------------------- conversions

def spec_to_def(spec: BusinessSpecification) -> SpecDef:
    return SpecDef(key=spec.key, name=spec.name, aliases=list(spec.aliases or []), category=spec.category,
                   unit_type=spec.unit_type, sign_policy=spec.sign_policy,
                   exclude_terms=list(spec.exclude_terms or []), description=spec.description,
                   rules=dict(spec.rules or {}))


def _ctx_to_json(ctx: DocContext) -> dict:
    return {
        "fiscal_year": ctx.fiscal_year, "currency": ctx.currency,
        "scale": str(ctx.scale) if ctx.scale is not None else None,
        "emission_unit": [str(ctx.emission_unit[0]), ctx.emission_unit[1]] if ctx.emission_unit else None,
    }


def doc_context(doc: Document) -> DocContext:
    c = (doc.metadata or {}).get("context")
    if not c:
        return detect_context(doc.raw_text, doc.fiscal_year)
    em = c.get("emission_unit")
    ctx = DocContext(fiscal_year=doc.fiscal_year or c.get("fiscal_year"), currency=c.get("currency"),
                     scale=Decimal(c["scale"]) if c.get("scale") else None,
                     emission_unit=(Decimal(em[0]), em[1]) if em else None)
    return ctx


# --------------------------------------------------------------------------- ingestion

@transaction.atomic
def ingest_document(doc: Document, actor: str = "system") -> Document:
    """(Re)build sections, chunks and the chunk graph for ``doc`` from ``doc.raw_text``."""
    text = normalize_text(doc.raw_text or "")
    if not text.strip():
        raise ApiError("Document has no text content.", "empty_document", 400)
    doc.raw_text = text
    doc.file_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    secs = detect_sections(text)
    chunk_specs, rel_specs = chunk_document(text, secs)
    ctx = detect_context(text, doc.fiscal_year)
    if doc.fiscal_year is None and ctx.fiscal_year:
        doc.fiscal_year = ctx.fiscal_year
    pages = [tuple(p) for p in (doc.metadata or {}).get("pages", [])]
    doc.metadata = {**(doc.metadata or {}), "context": _ctx_to_json(ctx), "section_count": len(secs),
                    "chunk_count": len(chunk_specs), "char_count": len(text)}
    doc.status = "indexed"
    doc.error = ""
    doc.save()
    doc.sections.all().delete()
    doc.chunks.all().delete()
    DocumentSection.objects.bulk_create([
        DocumentSection(document=doc, order=i, heading=s.heading[:300], level=s.level, section_type=s.section_type,
                        start_char=s.start, end_char=s.end) for i, s in enumerate(secs)])
    sec_by_order = {s.order: s for s in DocumentSection.objects.filter(document=doc)}
    DocumentChunk.objects.bulk_create([
        DocumentChunk(document=doc, section=sec_by_order.get(c.section_index), index=c.index,
                      chunk_type=c.chunk_type, heading=c.heading[:300], text=c.text, start_char=c.start,
                      end_char=c.end, token_count=len(tokenize(c.text)),
                      page=page_for_offset(pages, c.start) if pages else None, meta=c.meta)
        for c in chunk_specs])
    by_index = {c.index: c.id for c in DocumentChunk.objects.filter(document=doc).only("id", "index")}
    ChunkRelationship.objects.bulk_create([
        ChunkRelationship(source_id=by_index[r.source], target_id=by_index[r.target], relation_type=r.relation,
                          weight=r.weight) for r in rel_specs], ignore_conflicts=True)
    record_audit(actor, "document.indexed", "document", doc.id,
                 f"Indexed '{doc.title}': {len(chunk_specs)} chunks, {len(secs)} sections",
                 {"chunks": len(chunk_specs), "sections": len(secs), "fiscal_year": doc.fiscal_year})
    return doc


def load_index(document_ids: Iterable[int]) -> tuple[RetrievalIndex, dict, dict]:
    """Build an in-memory index for documents. Returns (index, doc_infos, chunk_by_id)."""
    ids = list(document_ids)
    docs = {d.id: d for d in Document.objects.filter(id__in=ids).select_related("company")}
    refs: list[ChunkRef] = []
    for c in DocumentChunk.objects.filter(document_id__in=ids).order_by("document_id", "index"):
        refs.append(ChunkRef(id=c.id, document_id=c.document_id, index=c.index, text=c.text,
                             start_char=c.start_char, end_char=c.end_char, chunk_type=c.chunk_type,
                             heading=c.heading, meta=c.meta or {}))
    edges = [(r.source_id, r.target_id, r.relation_type, r.weight)
             for r in ChunkRelationship.objects.filter(source__document_id__in=ids)]
    infos = {did: chat_engine.DocInfo(did, d.company.name, d.fiscal_year, d.title, doc_context(d))
             for did, d in docs.items()}
    return RetrievalIndex(refs, edges), infos, {r.id: r for r in refs}


# --------------------------------------------------------------------------- agents & prompts

def get_default_agent() -> AgentConfiguration:
    agent = AgentConfiguration.objects.filter(is_default=True).first()
    if agent:
        return agent
    agent, _ = AgentConfiguration.objects.get_or_create(
        name="Deterministic Reader (offline)",
        defaults={"mode": "deterministic", "provider": "mock", "is_default": True,
                  "description": "Offline, evidence-grounded text reader. No network access."})
    return agent


def resolve_prompt_version(agent: Optional[AgentConfiguration], explicit: Optional[PromptVersion] = None):
    if explicit:
        return explicit
    if agent and agent.prompt_version:
        return agent.prompt_version
    if agent and agent.prompt_template and agent.prompt_template.active_version:
        return agent.prompt_template.active_version
    tpl = PromptTemplate.objects.filter(kind="extraction").order_by("id").first()
    return tpl.active_version if tpl else None


# --------------------------------------------------------------------------- runs

def create_run(document_ids: list[int], spec_keys: Optional[list[str]], agent: Optional[AgentConfiguration],
               overrides: Optional[dict] = None, actor: str = "system") -> ExtractionRun:
    overrides = overrides or {}
    agent = agent or get_default_agent()
    docs = list(Document.objects.filter(id__in=document_ids))
    if not docs:
        raise ApiError("No matching documents for this run.", "no_documents", 400)
    if len(docs) != len(set(document_ids)):
        missing = sorted(set(document_ids) - {d.id for d in docs})
        raise ApiError(f"Unknown document ids: {missing}", "unknown_document", 400)
    not_indexed = [d.id for d in docs if d.status != "indexed"]
    if not_indexed:
        raise ApiError(f"Documents not indexed: {not_indexed}", "document_not_indexed", 400)
    active = BusinessSpecification.objects.filter(is_active=True)
    if spec_keys:
        found = set(active.filter(key__in=spec_keys).values_list("key", flat=True))
        unknown = [k for k in spec_keys if k not in found]
        if unknown:
            raise ApiError(f"Unknown or inactive specification keys: {unknown}", "unknown_specification", 400)
        keys = list(spec_keys)
    else:
        keys = list(active.values_list("key", flat=True))
    mode = overrides.get("mode") or agent.mode
    provider = overrides.get("provider") or (agent.provider if mode == "llm" else "mock")
    pv = overrides.get("prompt_version") or resolve_prompt_version(agent)
    options = {
        "top_k": int(overrides.get("top_k") or agent.top_k),
        "retrieval_mode": overrides.get("retrieval_mode") or agent.retrieval_mode,
        "graph_expansion": overrides.get("graph_expansion", agent.graph_expansion),
        "temperature": overrides.get("temperature", agent.temperature),
    }
    run = ExtractionRun.objects.create(
        agent=agent, prompt_version=pv if mode == "llm" else None, mode=mode, provider=provider,
        model=overrides.get("model") or agent.model, specification_keys=keys, options=options, created_by=actor)
    run.documents.set(docs)
    record_audit(actor, "run.created", "extraction_run", run.id,
                 f"Run #{run.id}: {len(docs)} document(s), {len(keys)} specification(s), mode={mode}/{provider}",
                 {"documents": [d.id for d in docs], "specifications": keys, "mode": mode, "provider": provider})
    return run


def _persist_outcome(run: ExtractionRun, doc: Document, spec: BusinessSpecification, outcome: ExtractionOutcome,
                     checks, chunk_by_id: dict, pages: list) -> ExtractionResult:
    b = outcome.best
    res = ExtractionResult.objects.create(
        run=run, document=doc, specification=spec, status=outcome.status,
        raw_value=b.raw_number if b else "", value=q6(b.value) if b else None,
        scale=b.scale if b else Decimal(1), currency=(b.currency or "") if b else "",
        unit_label=b.unit_label if b else "", normalized_value=q6(b.normalized) if b else None,
        fiscal_year=outcome.fiscal_year, confidence=outcome.confidence, method=b.method if b else "",
        rationale=outcome.rationale, warnings=outcome.warnings, retrieved_chunk_ids=list(outcome.retrieved_chunk_ids),
        validation_status=summarize(checks, outcome.status))
    ev = []
    for c in outcome.candidates:
        ev.append(Evidence(
            result=res, chunk_id=c.chunk_id if c.chunk_id in chunk_by_id else None, role=c.role, method=c.method,
            quote=c.quote, context=c.context[:2000], start_char=c.start_char, end_char=c.end_char,
            page=page_for_offset(pages, c.start_char) if pages else None, score=c.score,
            raw_number=c.raw_number, normalized_value=q6(c.normalized), notes=c.notes))
    Evidence.objects.bulk_create(ev)
    ValidationResult.objects.bulk_create([
        ValidationResult(result=res, rule=c.rule, severity=c.severity, passed=c.passed, message=c.message,
                         details=c.details) for c in checks])
    return res


def _run_metrics(run: ExtractionRun, elapsed: float) -> dict:
    results = list(run.results.all())
    st = Counter(r.status for r in results)
    vs = Counter(r.validation_status for r in results)
    found = [r for r in results if r.status == "found"]
    return {
        "total": len(results), "by_status": dict(st), "by_validation": dict(vs),
        "found_rate": round(len(found) / len(results), 4) if results else 0.0,
        "mean_confidence": round(sum(r.confidence for r in found) / len(found), 4) if found else 0.0,
        "documents": run.documents.count(), "elapsed_seconds": round(elapsed, 3),
    }


def execute_run(run_id: int) -> ExtractionRun:
    """Execute a run synchronously. Provider failures mark the run failed (never fall back)."""
    run = ExtractionRun.objects.select_related("agent", "prompt_version").get(pk=run_id)
    run.status = "running"
    run.started_at = timezone.now()
    run.error = ""
    run.save(update_fields=["status", "started_at", "error", "updated_at"])
    t0 = time.monotonic()
    actor = run.created_by or "system"
    try:
        docs = list(run.documents.select_related("company"))
        specs_by_key = {s.key: s for s in BusinessSpecification.objects.filter(key__in=run.specification_keys)}
        specs = [specs_by_key[k] for k in run.specification_keys if k in specs_by_key]
        provider = None
        if run.mode == "llm":
            provider = get_provider(run.provider, run.model or None)
        index, infos, chunk_by_id = load_index([d.id for d in docs])
        opts = run.options or {}
        top_k = int(opts.get("top_k", 8))
        rmode = opts.get("retrieval_mode", "hybrid")
        gexp = bool(opts.get("graph_expansion", True))
        if run.mode == "llm":
            pv = run.prompt_version
            llm = LLMExtractor(
                index, provider,
                system_prompt=pv.system_prompt if pv else prompt_lib.EXTRACTION_SYSTEM_V2,
                user_template=pv.user_template if pv else prompt_lib.EXTRACTION_USER,
                output_schema=(pv.output_schema if pv and pv.output_schema else None),
                model=run.model or None, temperature=opts.get("temperature", 0.0))
            extractor = llm
        else:
            extractor = DeterministicExtractor(index)
        for doc in docs:
            info = infos[doc.id]
            outcomes: dict[str, ExtractionOutcome] = {}
            for spec in specs:
                sd = spec_to_def(spec)
                if run.mode == "llm":
                    outcomes[spec.key] = extractor.extract(sd, doc.id, info.ctx, company=doc.company.name,
                                                           top_k=top_k, mode=rmode, graph_expansion=gexp)
                else:
                    outcomes[spec.key] = extractor.extract(sd, doc.id, info.ctx, top_k=top_k, mode=rmode,
                                                           graph_expansion=gexp)
            cross = validate_cross(outcomes)
            pages = [tuple(p) for p in (doc.metadata or {}).get("pages", [])]
            with transaction.atomic():
                ExtractionResult.objects.filter(run=run, document=doc).delete()
                for spec in specs:
                    o = outcomes[spec.key]
                    checks = validate_outcome(o, spec_to_def(spec), info.ctx, doc.raw_text) + cross.get(spec.key, [])
                    _persist_outcome(run, doc, spec, o, checks, chunk_by_id, pages)
        if run.mode == "llm":
            run.usage = extractor.usage
        run.status = "completed"
    except ProviderError as exc:
        run.status = "failed"
        run.error = str(exc)
        run.options = {**(run.options or {}), "error_code": exc.code, "error_provider": exc.provider}
    except Exception as exc:  # unexpected: surface, do not mask
        run.status = "failed"
        run.error = f"{type(exc).__name__}: {exc}"
        run.options = {**(run.options or {}), "error_code": "internal_error"}
        run.finished_at = timezone.now()
        run.save()
        record_audit(actor, "run.failed", "extraction_run", run.id, run.error[:300])
        raise
    run.finished_at = timezone.now()
    run.metrics = _run_metrics(run, time.monotonic() - t0)
    run.save()
    record_audit(actor, f"run.{run.status}", "extraction_run", run.id,
                 f"Run #{run.id} {run.status}" + (f": {run.error}" if run.error else ""),
                 {"metrics": run.metrics, "error": run.error})
    return run


def dispatch_run(run: ExtractionRun, run_async: bool = False) -> ExtractionRun:
    from django.conf import settings

    if run_async and settings.FINSPEC_CELERY_ENABLED:
        from .tasks import execute_run_task

        result = execute_run_task.delay(run.id)
        run.celery_task_id = getattr(result, "id", "") or ""
        run.save(update_fields=["celery_task_id", "updated_at"])
        run.refresh_from_db()
        return run
    return execute_run(run.id)


# --------------------------------------------------------------------------- reviews

@transaction.atomic
def apply_review(result: ExtractionResult, decision: str, reviewer: str, corrected_value: Optional[Decimal] = None,
                 corrected_unit: str = "", evidence_quote: str = "", comment: str = "") -> AnalystReview:
    if decision == "approve":
        if result.status != "found" or result.normalized_value is None:
            raise ApiError("Only results with an extracted value can be approved. Use 'correct' to supply a value.",
                           "cannot_approve", 400)
        if result.validation_status == "fail" and not comment:
            raise ApiError("Approving a result that failed validation requires a comment.", "comment_required", 400)
        result.final_value = result.normalized_value
        result.review_status = "approved"
    elif decision == "reject":
        result.final_value = None
        result.review_status = "rejected"
    elif decision == "correct":
        if corrected_value is None:
            raise ApiError("corrected_value is required when decision is 'correct'.", "missing_value", 400)
        if not evidence_quote.strip():
            raise ApiError("A corrected value requires an evidence_quote from the document.", "missing_evidence", 400)
        text = result.document.raw_text
        norm = re.sub(r"\s+", " ", evidence_quote.strip())
        pat = r"\s+".join(re.escape(t) for t in norm.split(" "))
        m = re.search(pat, text)
        if not m:
            raise ApiError("evidence_quote was not found in the document text.", "evidence_not_found", 400)
        result.final_value = q6(corrected_value)
        result.review_status = "corrected"
        chunk = DocumentChunk.objects.filter(document=result.document, start_char__lte=m.start(),
                                             end_char__gte=m.start()).first()
        pages = [tuple(p) for p in (result.document.metadata or {}).get("pages", [])]
        Evidence.objects.create(result=result, chunk=chunk, role="analyst", method="analyst",
                                quote=text[m.start():m.end()], start_char=m.start(), end_char=m.end(),
                                page=page_for_offset(pages, m.start()) if pages else None, score=1.0,
                                normalized_value=q6(corrected_value))
    else:
        raise ApiError("decision must be approve, reject or correct.", "invalid_decision", 400)
    result.save(update_fields=["final_value", "review_status", "updated_at"])
    review = AnalystReview.objects.create(
        result=result, reviewer=reviewer, decision=decision, corrected_value=q6(corrected_value),
        corrected_unit=corrected_unit, evidence_quote=evidence_quote, comment=comment)
    record_audit(reviewer, f"review.{decision}", "extraction_result", result.id,
                 f"{decision} {result.specification.key} for document {result.document_id}",
                 {"review_id": review.id, "final_value": str(result.final_value) if result.final_value is not None else None,
                  "comment": comment})
    return review


# --------------------------------------------------------------------------- evaluation

def execute_evaluation(eval_run_id: int) -> EvaluationRun:
    er = EvaluationRun.objects.select_related("dataset", "agent").get(pk=eval_run_id)
    er.status = "running"
    er.error = ""
    er.save(update_fields=["status", "error", "updated_at"])
    actor = er.created_by or "system"
    cases = list(er.dataset.cases.select_related("document__company", "specification"))
    if not cases:
        er.status = "failed"
        er.error = "Dataset has no cases."
        er.save()
        return er
    doc_ids = sorted({c.document_id for c in cases})
    keys = sorted({c.specification.key for c in cases})
    agent = er.agent or get_default_agent()
    run = create_run(doc_ids, keys, agent, {}, actor)
    run = execute_run(run.id)
    er.extraction_run = run
    if run.status != "completed":
        er.status = "failed"
        er.error = f"Extraction run #{run.id} failed: {run.error}"
        er.save()
        record_audit(actor, "evaluation.failed", "evaluation_run", er.id, er.error[:300])
        return er
    by_key = {(r.document_id, r.specification_id): r for r in run.results.prefetch_related("validations")}
    rows = []
    with transaction.atomic():
        er.results.all().delete()
        for case in cases:
            res = by_key.get((case.document_id, case.specification_id))
            predicted = res.normalized_value if res and res.status == "found" else None
            outcome = evaluation_engine.compare(case.expected_value, case.expect_found, predicted,
                                                res.status if res else "not_found", case.tolerance)
            ok = outcome in (evaluation_engine.CORRECT, evaluation_engine.CORRECT_ABSENT)
            grounded = True
            if res and res.status == "found":
                grounded = all(v.passed for v in res.validations.all()
                               if v.rule in ("evidence_present", "evidence_grounded", "evidence_offsets"))
            EvaluationResult.objects.create(
                run=er, case=case, extraction_result=res, outcome=outcome, passed=ok,
                expected_value=case.expected_value if case.expect_found else None, predicted_value=predicted,
                detail={"status": res.status if res else "missing", "confidence": res.confidence if res else 0.0,
                        "rationale": res.rationale if res else ""})
            rows.append({"outcome": outcome, "spec_key": case.specification.key,
                         "company": case.document.company.name, "predicted_found": predicted is not None,
                         "grounded": grounded, "confidence": res.confidence if res else 0.0})
    er.metrics = evaluation_engine.aggregate(rows)
    er.status = "completed"
    er.save()
    record_audit(actor, "evaluation.completed", "evaluation_run", er.id,
                 f"Evaluation #{er.id} on '{er.dataset.name}': accuracy {er.metrics['overall']['accuracy']}",
                 {"overall": er.metrics["overall"], "extraction_run": run.id})
    return er


# --------------------------------------------------------------------------- retrieval / graph / chat

def resolve_documents(document_ids=None, company_id=None, fiscal_year=None) -> list[Document]:
    qs = Document.objects.filter(status="indexed").select_related("company")
    if document_ids:
        qs = qs.filter(id__in=document_ids)
    if company_id:
        qs = qs.filter(company_id=company_id)
    if fiscal_year:
        qs = qs.filter(fiscal_year=fiscal_year)
    return list(qs)


def search_chunks(query: str, docs: list[Document], top_k: int = 8, mode: str = "hybrid",
                  graph_expansion: bool = True) -> list[dict]:
    if not docs:
        return []
    index, infos, _ = load_index([d.id for d in docs])
    try:
        hits = index.search(query, top_k=top_k, mode=mode, graph_expansion=graph_expansion)
    except ValueError as exc:
        raise ApiError(str(exc), "invalid_mode", 400)
    out = []
    for h in hits:
        d = h.to_dict()
        info = infos[h.chunk.document_id]
        d.update({"company": info.company, "fiscal_year": info.fiscal_year, "document_title": info.title})
        out.append(d)
    return out


def run_chat(message: str, docs: list[Document], provider_name: str = "mock", model: Optional[str] = None,
             history: Optional[list] = None, top_k: int = 6) -> chat_engine.ChatResult:
    provider = get_provider(provider_name, model if provider_name != "mock" else None)
    specs = [spec_to_def(s) for s in BusinessSpecification.objects.filter(is_active=True)]
    index, infos, _ = load_index([d.id for d in docs])
    engine = chat_engine.ChatEngine(index, infos, specs, provider, model=model, top_k=top_k)
    return engine.answer(message, history)


def infer_chat_scope(message: str) -> tuple[list[int], list[int]]:
    """Companies / years mentioned in the message."""
    low = message.lower()
    company_ids = [c.id for c in Company.objects.all()
                   if c.name.lower() in low or (c.ticker and re.search(r"\b" + re.escape(c.ticker.lower()) + r"\b", low))]
    years = chat_engine.detect_years(message)
    return company_ids, years


def build_graph(docs: list[Document], run: Optional[ExtractionRun] = None, include_structure: bool = True,
                max_chunk_nodes: int = 400) -> dict:
    nodes, edges = [], []
    seen_company = set()
    for d in docs:
        if d.company_id not in seen_company:
            seen_company.add(d.company_id)
            nodes.append({"id": f"company:{d.company_id}", "type": "company", "label": d.company.name})
        nodes.append({"id": f"document:{d.id}", "type": "document", "label": d.title,
                      "fiscal_year": d.fiscal_year})
        edges.append({"source": f"company:{d.company_id}", "target": f"document:{d.id}", "type": "published"})
    doc_ids = [d.id for d in docs]
    chunks = list(DocumentChunk.objects.filter(document_id__in=doc_ids).order_by("document_id", "index")[:max_chunk_nodes])
    chunk_ids = {c.id for c in chunks}
    for c in chunks:
        nodes.append({"id": f"chunk:{c.id}", "type": "chunk", "label": f"{c.heading[:60]} [{c.chunk_type}]",
                      "chunk_type": c.chunk_type, "document_id": c.document_id, "index": c.index})
        edges.append({"source": f"document:{c.document_id}", "target": f"chunk:{c.id}", "type": "contains"})
    if include_structure:
        for r in ChunkRelationship.objects.filter(source_id__in=chunk_ids, target_id__in=chunk_ids):
            if r.relation_type in ("previous", "section_member"):
                continue
            edges.append({"source": f"chunk:{r.source_id}", "target": f"chunk:{r.target_id}",
                          "type": r.relation_type, "weight": r.weight})
    if run is not None:
        seen_spec = set()
        for res in run.results.filter(document_id__in=doc_ids).select_related("specification").prefetch_related("evidence"):
            if res.specification_id not in seen_spec:
                seen_spec.add(res.specification_id)
                nodes.append({"id": f"spec:{res.specification_id}", "type": "specification",
                              "label": res.specification.name})
            nodes.append({"id": f"result:{res.id}", "type": "result", "label": f"{res.specification.name}: {res.status}",
                          "status": res.status, "value": str(res.normalized_value) if res.normalized_value is not None else None})
            edges.append({"source": f"spec:{res.specification_id}", "target": f"result:{res.id}", "type": "measured_as"})
            for ev in res.evidence.all():
                if ev.chunk_id in chunk_ids:
                    edges.append({"source": f"result:{res.id}", "target": f"chunk:{ev.chunk_id}",
                                  "type": f"evidence_{ev.role}"})
    return {"nodes": nodes, "edges": edges, "stats": {"nodes": len(nodes), "edges": len(edges)}}
