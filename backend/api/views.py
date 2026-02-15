import time

from django.conf import settings
from django.db import connection
from django.db.models import Count, Max, Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from engine import prompts as prompt_lib
from engine.providers import provider_statuses
from engine.retrieval import tokenize

from . import services
from .errors import ApiError, error_body
from .models import (
    AgentConfiguration, AnalystReview, AuditEvent, BusinessSpecification, Company, Document, DocumentChunk,
    EvaluationCase, EvaluationDataset, EvaluationResult, EvaluationRun, ExtractionResult, ExtractionRun,
    PromptTemplate, PromptVersion,
)
from .serializers import (
    AgentConfigurationSerializer, AnalystReviewSerializer, AuditEventSerializer, BusinessSpecificationSerializer,
    ChatRequestSerializer, CompanySerializer, DocumentChunkSerializer, DocumentDetailSerializer,
    DocumentListSerializer, DocumentSectionSerializer, DocumentWriteSerializer, EvaluationCaseSerializer,
    EvaluationDatasetSerializer, EvaluationResultSerializer, EvaluationRunSerializer, ExtractionResultSerializer,
    ExtractionRunSerializer, PromptGenerateSerializer, PromptTemplateSerializer, PromptVersionSerializer,
    ReviewCreateSerializer, RunCreateSerializer, SearchRequestSerializer,
)


def actor_of(request) -> str:
    return (request.headers.get("X-Actor") or "anonymous")[:120]


def _bool(v) -> bool:
    return str(v).lower() in ("1", "true", "yes", "on")


class AuditedMixin:
    """Record create/update/delete operations in the audit log."""

    audit_type = ""

    def _label(self, obj) -> str:
        return str(obj)[:200]

    def perform_create(self, serializer):
        obj = serializer.save()
        services.record_audit(actor_of(self.request), f"{self.audit_type}.created", self.audit_type, obj.pk,
                              f"Created {self._label(obj)}")

    def perform_update(self, serializer):
        obj = serializer.save()
        services.record_audit(actor_of(self.request), f"{self.audit_type}.updated", self.audit_type, obj.pk,
                              f"Updated {self._label(obj)}", {"fields": sorted(serializer.validated_data.keys())})

    def perform_destroy(self, instance):
        pk, label = instance.pk, self._label(instance)
        instance.delete()
        services.record_audit(actor_of(self.request), f"{self.audit_type}.deleted", self.audit_type, pk,
                              f"Deleted {label}")


# --------------------------------------------------------------------------- health / status

@api_view(["GET"])
def health(request):
    t0 = time.monotonic()
    db_ok = True
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception:  # pragma: no cover
        db_ok = False
    body = {
        "status": "ok" if db_ok else "degraded",
        "service": "finspec-ai-studio",
        "version": "1.0.0",
        "database": "ok" if db_ok else "error",
        "mode": "offline-mock-default",
        "counts": {
            "companies": Company.objects.count(), "documents": Document.objects.count(),
            "specifications": BusinessSpecification.objects.count(), "runs": ExtractionRun.objects.count(),
        },
        "latency_ms": round((time.monotonic() - t0) * 1000, 2),
    }
    return Response(body, status=200 if db_ok else 503)


@api_view(["GET"])
def provider_status(request):
    return Response({
        "default_provider": settings.FINSPEC_DEFAULT_PROVIDER,
        "fallback_policy": "none: a paid provider that is unconfigured or failing produces an error; "
                           "the mock provider is never substituted silently.",
        "providers": provider_statuses(),
        "celery": {"enabled": settings.FINSPEC_CELERY_ENABLED, "eager": settings.CELERY_TASK_ALWAYS_EAGER},
    })


# --------------------------------------------------------------------------- corpus

class CompanyViewSet(AuditedMixin, viewsets.ModelViewSet):
    serializer_class = CompanySerializer
    audit_type = "company"

    def get_queryset(self):
        qs = Company.objects.annotate(document_count=Count("documents"))
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(ticker__icontains=q) | Q(sector__icontains=q))
        return qs.order_by("name")


class DocumentViewSet(AuditedMixin, viewsets.ModelViewSet):
    audit_type = "document"
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        qs = Document.objects.select_related("company")
        p = self.request.query_params
        if p.get("company"):
            qs = qs.filter(company_id=p["company"])
        if p.get("fiscal_year"):
            qs = qs.filter(fiscal_year=p["fiscal_year"])
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("q"):
            qs = qs.filter(Q(title__icontains=p["q"]) | Q(company__name__icontains=p["q"]))
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return DocumentWriteSerializer
        if self.action == "retrieve":
            return DocumentDetailSerializer
        return DocumentListSerializer

    def _label(self, obj):
        return f"document '{obj.title}'"

    def perform_create(self, serializer):
        obj = serializer.save()
        services.record_audit(actor_of(self.request), "document.created", "document", obj.pk,
                              f"Uploaded document '{obj.title}' ({obj.company.name} FY{obj.fiscal_year})",
                              {"source_filename": obj.source_filename, "file_hash": obj.file_hash})

    @action(detail=True, methods=["get"])
    def chunks(self, request, pk=None):
        doc = self.get_object()
        qs = doc.chunks.all()
        if request.query_params.get("type"):
            qs = qs.filter(chunk_type=request.query_params["type"])
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(DocumentChunkSerializer(page, many=True).data)

    @action(detail=True, methods=["get"])
    def sections(self, request, pk=None):
        return Response(DocumentSectionSerializer(self.get_object().sections.all(), many=True).data)

    @action(detail=True, methods=["post"])
    def reindex(self, request, pk=None):
        doc = services.ingest_document(self.get_object(), actor=actor_of(request))
        return Response(DocumentDetailSerializer(doc).data)


# --------------------------------------------------------------------------- specs / prompts / agents

class BusinessSpecificationViewSet(AuditedMixin, viewsets.ModelViewSet):
    serializer_class = BusinessSpecificationSerializer
    audit_type = "specification"

    def get_queryset(self):
        qs = BusinessSpecification.objects.all()
        p = self.request.query_params
        if p.get("active") is not None:
            qs = qs.filter(is_active=_bool(p["active"]))
        if p.get("category"):
            qs = qs.filter(category=p["category"])
        return qs

    def destroy(self, request, *args, **kwargs):
        spec = self.get_object()
        if spec.results.exists() or spec.eval_cases.exists():
            spec.is_active = False
            spec.save(update_fields=["is_active", "updated_at"])
            services.record_audit(actor_of(request), "specification.deactivated", "specification", spec.pk,
                                  f"Deactivated {spec.name} (has results; not deleted)")
            return Response({"deactivated": True, "detail": "Specification has results and was deactivated instead of deleted."})
        return super().destroy(request, *args, **kwargs)


class PromptVersionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = PromptVersionSerializer

    def get_queryset(self):
        qs = PromptVersion.objects.select_related("template")
        if self.request.query_params.get("template"):
            qs = qs.filter(template_id=self.request.query_params["template"])
        return qs

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        v = self.get_object()
        PromptVersion.objects.filter(template=v.template).update(is_active=False)
        v.is_active = True
        v.save(update_fields=["is_active"])
        services.record_audit(actor_of(request), "prompt_version.activated", "prompt_version", v.pk,
                              f"Activated {v}")
        return Response(PromptVersionSerializer(v).data)


class PromptTemplateViewSet(AuditedMixin, viewsets.ModelViewSet):
    serializer_class = PromptTemplateSerializer
    queryset = PromptTemplate.objects.all()
    audit_type = "prompt_template"

    @action(detail=True, methods=["get", "post"])
    def versions(self, request, pk=None):
        tpl = self.get_object()
        if request.method == "GET":
            return Response(PromptVersionSerializer(tpl.versions.all(), many=True).data)
        ser = PromptVersionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        nxt = (tpl.versions.aggregate(m=Max("version"))["m"] or 0) + 1
        make_active = ser.validated_data.get("is_active", False)
        if make_active:
            tpl.versions.update(is_active=False)
        v = ser.save(template=tpl, version=nxt, created_by=actor_of(request))
        services.record_audit(actor_of(request), "prompt_version.created", "prompt_version", v.pk, f"Created {v}")
        return Response(PromptVersionSerializer(v).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def prompts_generate(request):
    ser = PromptGenerateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data
    keys = d.get("specifications") or [d["specification"]]
    specs = {s.key: s for s in BusinessSpecification.objects.filter(key__in=keys)}
    missing = [k for k in keys if k not in specs]
    if missing:
        raise ApiError(f"Unknown specification keys: {missing}", "unknown_specification", 404)
    version = d.get("version") or (d["template"].active_version if d.get("template") else None)
    if version is None:
        tpl = PromptTemplate.objects.filter(kind="extraction").order_by("id").first()
        version = tpl.active_version if tpl else None
    system = version.system_prompt if version else prompt_lib.EXTRACTION_SYSTEM_V2
    user_tpl = version.user_template if version else prompt_lib.EXTRACTION_USER
    schema = (version.output_schema if version and version.output_schema else prompt_lib.EXTRACTION_SCHEMA)
    doc = None
    index = None
    if d.get("document"):
        doc = Document.objects.filter(pk=d["document"], status="indexed").select_related("company").first()
        if doc is None:
            raise ApiError("Document not found or not indexed.", "document_not_found", 404)
        index, infos, _ = services.load_index([doc.id])
    out = []
    for key in keys:
        sd = services.spec_to_def(specs[key])
        hits = []
        if index is not None:
            from engine.extraction import DeterministicExtractor

            hits = DeterministicExtractor(index).retrieve(sd, doc.id, top_k=d["top_k"])
        company = doc.company.name if doc else d.get("company_name", "")
        year = doc.fiscal_year if doc else d.get("fiscal_year")
        try:
            if d.get("context") and not hits:
                variables = prompt_lib.spec_variables(sd, company, year, d["context"])
                p = {"system": system, "user": prompt_lib.render_template(user_tpl, variables),
                     "schema": schema, "variables": {k: v for k, v in variables.items() if k != "context"}}
            else:
                p = prompt_lib.generate_extraction_prompt(sd, company, year, hits, system, user_tpl, schema)
        except prompt_lib.PromptError as exc:
            raise ApiError(str(exc), "invalid_template", 400)
        p.update({"specification": key, "template_version": version.id if version else None,
                  "retrieved_chunk_ids": [h.chunk.id for h in hits],
                  "estimated_input_tokens": len(tokenize(p["system"] + p["user"]))})
        out.append(p)
    services.record_audit(actor_of(request), "prompt.generated", "prompt", version.id if version else "",
                          f"Generated {len(out)} prompt(s)", {"specifications": keys, "document": d.get("document")})
    resp = {"prompts": out}
    if len(out) == 1:
        resp["prompt"] = out[0]
    return Response(resp)


class AgentConfigurationViewSet(AuditedMixin, viewsets.ModelViewSet):
    serializer_class = AgentConfigurationSerializer
    queryset = AgentConfiguration.objects.all()
    audit_type = "agent"


# --------------------------------------------------------------------------- retrieval

@api_view(["POST"])
def retrieval_search(request):
    ser = SearchRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data
    query = (d.get("query") or "").strip()
    extra = []
    if d.get("specification"):
        spec = BusinessSpecification.objects.filter(key=d["specification"]).first()
        if spec is None:
            raise ApiError("Unknown specification key.", "unknown_specification", 404)
        query = query or f"{spec.name} " + " ".join(spec.aliases)
    docs = services.resolve_documents(d.get("document_ids"), d.get("company"), d.get("fiscal_year"))
    hits = services.search_chunks(query, docs, d["top_k"], d["mode"], d["graph_expansion"])
    return Response({"query": query, "mode": d["mode"], "graph_expansion": d["graph_expansion"],
                     "documents_searched": [x.id for x in docs], "count": len(hits), "hits": hits, "extra": extra})


# --------------------------------------------------------------------------- runs / extractions

class ExtractionRunViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin,
                           viewsets.GenericViewSet):
    serializer_class = ExtractionRunSerializer

    def get_queryset(self):
        qs = ExtractionRun.objects.select_related("agent").prefetch_related("documents")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("document"):
            qs = qs.filter(documents__id=p["document"])
        if p.get("agent"):
            qs = qs.filter(agent_id=p["agent"])
        return qs.distinct()

    def perform_destroy(self, instance):
        pk = instance.pk
        instance.delete()
        services.record_audit(actor_of(self.request), "run.deleted", "extraction_run", pk, f"Deleted run #{pk}")

    def create(self, request):
        ser = RunCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return self._create_and_run(request, ser.validated_data)

    def _create_and_run(self, request, d):
        if d.get("document_ids"):
            doc_ids = d["document_ids"]
        else:
            doc_ids = [x.id for x in services.resolve_documents(None, d.get("company"), d.get("fiscal_year"))]
        overrides = {k: d[k] for k in ("mode", "provider", "model", "top_k", "retrieval_mode", "graph_expansion",
                                       "prompt_version") if k in d}
        run = services.create_run(doc_ids, d.get("specification_keys"), d.get("agent"), overrides, actor_of(request))
        run = services.dispatch_run(run, d.get("run_async", False))
        body = ExtractionRunSerializer(run).data
        if run.status == "failed":
            code = (run.options or {}).get("error_code", "run_failed")
            http = 409 if code in ("provider_not_configured", "unknown_provider") else 502
            return Response({**error_body(code, run.error), "run": body}, status=http)
        return Response(body, status=202 if run.status in ("pending", "running") else 201)

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        run = self.get_object()
        qs = run.results.select_related("specification", "document__company").prefetch_related(
            "evidence", "validations", "reviews")
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(ExtractionResultSerializer(page, many=True).data)

    @action(detail=True, methods=["post"])
    def rerun(self, request, pk=None):
        old = self.get_object()
        run = services.create_run(
            [d.id for d in old.documents.all()], old.specification_keys, old.agent,
            {"mode": old.mode, "provider": old.provider, "model": old.model, "prompt_version": old.prompt_version,
             **{k: v for k, v in (old.options or {}).items() if k in ("top_k", "retrieval_mode", "graph_expansion")}},
            actor_of(request))
        run = services.dispatch_run(run)
        return Response(ExtractionRunSerializer(run).data, status=201 if run.status != "failed" else 409)


class ExtractionResultViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                              viewsets.GenericViewSet):
    """Extraction results. ``POST`` is a convenience that creates and executes a run."""
    serializer_class = ExtractionResultSerializer

    def get_queryset(self):
        qs = ExtractionResult.objects.select_related("specification", "document__company").prefetch_related(
            "evidence", "validations", "reviews")
        p = self.request.query_params
        if p.get("run"):
            qs = qs.filter(run_id=p["run"])
        if p.get("document"):
            qs = qs.filter(document_id=p["document"])
        if p.get("company"):
            qs = qs.filter(document__company_id=p["company"])
        if p.get("specification"):
            v = p["specification"]
            qs = qs.filter(specification_id=v) if v.isdigit() else qs.filter(specification__key=v)
        for f in ("status", "fiscal_year", "review_status", "validation_status"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        if _bool(p.get("latest", "false")):
            ids = ExtractionResult.objects.values("document_id", "specification_id").annotate(m=Max("id")).values_list("m", flat=True)
            qs = qs.filter(id__in=list(ids))
        return qs.order_by("-run_id", "document_id", "specification_id")

    def create(self, request):
        ser = RunCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        resp = ExtractionRunViewSet()._create_and_run(request, ser.validated_data)
        if resp.status_code in (200, 201):
            run = ExtractionRun.objects.get(pk=resp.data["id"])
            results = run.results.select_related("specification", "document__company").prefetch_related(
                "evidence", "validations", "reviews")
            resp.data = {"run": resp.data, "results": ExtractionResultSerializer(results, many=True).data}
        return resp


# --------------------------------------------------------------------------- reviews

class ReviewViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                    viewsets.GenericViewSet):
    serializer_class = AnalystReviewSerializer

    def get_queryset(self):
        qs = AnalystReview.objects.select_related("result")
        p = self.request.query_params
        for f in ("result", "decision", "reviewer"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        return qs

    def create(self, request):
        ser = ReviewCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        reviewer = d.get("reviewer") or actor_of(request)
        review = services.apply_review(d["result"], d["decision"], reviewer, d.get("corrected_value"),
                                       d.get("corrected_unit", ""), d.get("evidence_quote", ""), d.get("comment", ""))
        data = AnalystReviewSerializer(review).data
        data["result_state"] = {"review_status": d["result"].review_status,
                                "final_value": (str(d["result"].final_value)
                                                if d["result"].final_value is not None else None)}
        return Response(data, status=status.HTTP_201_CREATED)


# --------------------------------------------------------------------------- evaluations

class EvaluationDatasetViewSet(AuditedMixin, viewsets.ModelViewSet):
    serializer_class = EvaluationDatasetSerializer
    queryset = EvaluationDataset.objects.all()
    audit_type = "evaluation_dataset"

    @action(detail=True, methods=["get"])
    def cases(self, request, pk=None):
        ds = self.get_object()
        qs = ds.cases.select_related("document__company", "specification")
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(EvaluationCaseSerializer(page, many=True).data)


class EvaluationCaseViewSet(AuditedMixin, viewsets.ModelViewSet):
    serializer_class = EvaluationCaseSerializer
    audit_type = "evaluation_case"

    def get_queryset(self):
        qs = EvaluationCase.objects.select_related("document__company", "specification")
        if self.request.query_params.get("dataset"):
            qs = qs.filter(dataset_id=self.request.query_params["dataset"])
        return qs


class EvaluationRunViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                           viewsets.GenericViewSet):
    serializer_class = EvaluationRunSerializer

    def get_queryset(self):
        qs = EvaluationRun.objects.select_related("dataset", "agent")
        if self.request.query_params.get("dataset"):
            qs = qs.filter(dataset_id=self.request.query_params["dataset"])
        return qs

    def create(self, request):
        ser = EvaluationRunSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        er = ser.save(created_by=actor_of(request))
        services.record_audit(actor_of(request), "evaluation.created", "evaluation_run", er.id,
                              f"Evaluation #{er.id} on '{er.dataset.name}'")
        if settings.FINSPEC_CELERY_ENABLED and _bool(request.data.get("run_async", False)):
            from .tasks import execute_evaluation_task

            execute_evaluation_task.delay(er.id)
            return Response(EvaluationRunSerializer(er).data, status=202)
        er = services.execute_evaluation(er.id)
        data = EvaluationRunSerializer(er).data
        if er.status == "failed":
            run = er.extraction_run
            code = (run.options or {}).get("error_code", "evaluation_failed") if run else "evaluation_failed"
            http = 409 if code in ("provider_not_configured", "unknown_provider") else 502
            return Response({**error_body(code, er.error), "evaluation": data}, status=http)
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        er = self.get_object()
        qs = er.results.select_related("case__document__company", "case__specification")
        if request.query_params.get("outcome"):
            qs = qs.filter(outcome=request.query_params["outcome"])
        if request.query_params.get("passed") is not None:
            qs = qs.filter(passed=_bool(request.query_params["passed"]))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(EvaluationResultSerializer(page, many=True).data)


@api_view(["GET"])
def evaluations_overview(request):
    runs = EvaluationRun.objects.select_related("dataset").order_by("-id")[:10]
    return Response({
        "datasets": EvaluationDatasetSerializer(EvaluationDataset.objects.all(), many=True).data,
        "recent_runs": EvaluationRunSerializer(runs, many=True).data,
        "links": {"datasets": "evaluations/datasets/", "cases": "evaluations/cases/", "runs": "evaluations/runs/"},
    })


# --------------------------------------------------------------------------- chat / graph / audit

@api_view(["POST"])
def chat(request):
    ser = ChatRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data
    scope = "explicit"
    if d.get("document_ids") or d.get("company") or d.get("fiscal_year"):
        docs = services.resolve_documents(d.get("document_ids"), d.get("company"), d.get("fiscal_year"))
    else:
        scope = "inferred"
        company_ids, years = services.infer_chat_scope(d["message"])
        qs = Document.objects.filter(status="indexed").select_related("company")
        if company_ids:
            qs = qs.filter(company_id__in=company_ids)
        if years:
            qs = qs.filter(fiscal_year__in=years)
        docs = list(qs)
        if not company_ids and not years:
            scope = "all"
    result = services.run_chat(d["message"], docs, d["provider"], d.get("model") or None, d.get("history"), d["top_k"])
    services.record_audit(actor_of(request), "chat.answered", "chat", "", d["message"][:200],
                          {"provider": result.provider, "model": result.model, "documents": [x.id for x in docs],
                           "citations": len(result.citations), "mode": result.mode})
    return Response({
        "answer": result.answer, "citations": result.citations, "extractions": result.extractions,
        "retrieved": result.retrieved, "mode": result.mode, "provider": result.provider, "model": result.model,
        "warnings": result.warnings,
        "scope": {"type": scope, "documents": [{"id": x.id, "title": x.title, "company": x.company.name,
                                                "fiscal_year": x.fiscal_year} for x in docs]},
    })


@api_view(["GET"])
def graph(request):
    p = request.query_params
    docs = services.resolve_documents([int(p["document"])] if p.get("document") else None,
                                      p.get("company"), p.get("fiscal_year"))
    run = None
    if p.get("run"):
        run = ExtractionRun.objects.filter(pk=p["run"]).first()
        if run is None:
            raise ApiError("Run not found.", "run_not_found", 404)
    data = services.build_graph(docs, run, include_structure=_bool(p.get("structure", "true")),
                                max_chunk_nodes=int(p.get("max_chunks", 400)))
    return Response(data)


class AuditViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = AuditEventSerializer

    def get_queryset(self):
        qs = AuditEvent.objects.all()
        p = self.request.query_params
        for f in ("action", "entity_type", "entity_id", "actor"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        if p.get("action_prefix"):
            qs = qs.filter(action__startswith=p["action_prefix"])
        if p.get("q"):
            qs = qs.filter(Q(summary__icontains=p["q"]) | Q(action__icontains=p["q"]))
        return qs
