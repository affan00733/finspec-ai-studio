from django.conf import settings
from rest_framework import serializers

from engine.parsing import ParseError, parse_bytes, parse_text
from engine.prompts import template_variables

from . import services
from .models import (
    AgentConfiguration, AnalystReview, AuditEvent, BusinessSpecification, Company, Document,
    DocumentChunk, DocumentSection, EvaluationCase, EvaluationDataset, EvaluationResult, EvaluationRun, Evidence,
    ExtractionResult, ExtractionRun, PromptTemplate, PromptVersion, ValidationResult,
)

PROVIDERS = ("mock", "openai", "azure")


# --------------------------------------------------------------------------- corpus

class CompanySerializer(serializers.ModelSerializer):
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = ["id", "name", "ticker", "sector", "description", "reporting_currency", "is_fictional",
                  "document_count", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_document_count(self, obj) -> int:
        annotated = getattr(obj, "document_count", None)
        return annotated if annotated is not None else obj.documents.count()


class DocumentListSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)
    chunk_count = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ["id", "company", "company_name", "title", "doc_type", "fiscal_year", "source_filename",
                  "file_hash", "status", "error", "chunk_count", "created_at", "updated_at"]

    def get_chunk_count(self, obj) -> int:
        return (obj.metadata or {}).get("chunk_count", 0)


class DocumentSectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentSection
        fields = ["id", "order", "heading", "level", "section_type", "start_char", "end_char"]


class DocumentChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentChunk
        fields = ["id", "document", "section", "index", "chunk_type", "heading", "text", "start_char", "end_char",
                  "token_count", "page", "meta"]


class DocumentDetailSerializer(DocumentListSerializer):
    sections = DocumentSectionSerializer(many=True, read_only=True)

    class Meta(DocumentListSerializer.Meta):
        fields = DocumentListSerializer.Meta.fields + ["raw_text", "metadata", "sections"]


class DocumentWriteSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True, required=False)
    raw_text = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = Document
        fields = ["id", "company", "title", "doc_type", "fiscal_year", "raw_text", "file", "source_filename"]
        extra_kwargs = {"title": {"required": False}}
        validators = []

    def validate(self, attrs):
        creating = self.instance is None
        file = attrs.get("file")
        text = attrs.get("raw_text")
        if creating and not file and not (text and text.strip()):
            raise serializers.ValidationError("Provide either 'file' or non-empty 'raw_text'.")
        if file and file.size > settings.FINSPEC_MAX_UPLOAD_BYTES:
            raise serializers.ValidationError({"file": f"File exceeds {settings.FINSPEC_MAX_UPLOAD_BYTES} bytes."})
        if creating and not attrs.get("title") and not file:
            raise serializers.ValidationError({"title": "Title is required for raw_text uploads."})
        if creating:
            title = attrs.get("title") or (file.name.rsplit(".", 1)[0] if file else "")
            if Document.objects.filter(company=attrs["company"], title=title,
                                       fiscal_year=attrs.get("fiscal_year")).exists():
                raise serializers.ValidationError("A document with this company, title and fiscal year already exists.")
        return attrs

    def _apply_content(self, attrs: dict) -> dict:
        file = attrs.pop("file", None)
        metadata = {}
        if file is not None:
            try:
                parsed = parse_bytes(file.read(), file.name, getattr(file, "content_type", "") or "")
            except ParseError as exc:
                raise serializers.ValidationError({"file": str(exc)})
            attrs["raw_text"] = parsed.text
            attrs["source_filename"] = file.name
            attrs.setdefault("title", file.name.rsplit(".", 1)[0])
            metadata = {**parsed.metadata, "pages": [list(p) for p in parsed.pages]}
        elif attrs.get("raw_text"):
            parsed = parse_text(attrs["raw_text"])
            attrs["raw_text"] = parsed.text
            metadata = parsed.metadata
        return metadata

    def create(self, validated_data):
        metadata = self._apply_content(validated_data)
        doc = Document(**validated_data)
        doc.metadata = metadata
        try:
            doc.save()
        except Exception as exc:
            from django.db import IntegrityError

            if isinstance(exc, IntegrityError):
                raise serializers.ValidationError("A document with this company, title and fiscal year already exists.")
            raise
        request = self.context.get("request")
        services.ingest_document(doc, actor=request.headers.get("X-Actor", "anonymous") if request else "system")
        return doc

    def update(self, instance, validated_data):
        reindex = "raw_text" in validated_data or "file" in validated_data or "fiscal_year" in validated_data
        metadata = self._apply_content(validated_data)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if metadata:
            instance.metadata = {**(instance.metadata or {}), **metadata}
        instance.save()
        if reindex:
            request = self.context.get("request")
            services.ingest_document(instance, actor=request.headers.get("X-Actor", "anonymous") if request else "system")
        return instance

    def to_representation(self, instance):
        return DocumentDetailSerializer(instance, context=self.context).data


# --------------------------------------------------------------------------- specs / prompts / agents

class BusinessSpecificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessSpecification
        fields = ["id", "key", "name", "description", "category", "unit_type", "sign_policy", "aliases",
                  "exclude_terms", "rules", "is_active", "version", "created_at", "updated_at"]
        read_only_fields = ["version", "created_at", "updated_at"]

    def validate_aliases(self, value):
        if not isinstance(value, list) or not value or not all(isinstance(a, str) and a.strip() for a in value):
            raise serializers.ValidationError("aliases must be a non-empty list of strings.")
        return [a.strip() for a in value]

    def validate_exclude_terms(self, value):
        if not isinstance(value, list) or not all(isinstance(a, str) for a in value):
            raise serializers.ValidationError("exclude_terms must be a list of strings.")
        return value

    def update(self, instance, validated_data):
        if any(k in validated_data for k in ("aliases", "exclude_terms", "unit_type", "sign_policy", "rules")):
            validated_data["version"] = instance.version + 1
        return super().update(instance, validated_data)


class PromptVersionSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True)
    variables = serializers.SerializerMethodField()

    class Meta:
        model = PromptVersion
        fields = ["id", "template", "template_name", "version", "system_prompt", "user_template", "output_schema",
                  "notes", "is_active", "created_by", "created_at", "variables"]
        read_only_fields = ["version", "created_at", "template"]

    def get_variables(self, obj) -> list:
        return template_variables(obj.user_template + "\n" + obj.system_prompt)

    def validate_user_template(self, value):
        known = {"task_tag", "company", "fiscal_year", "spec_name", "spec_description", "aliases", "exclusions",
                 "unit_guidance", "context", "question"}
        unknown = set(template_variables(value)) - known
        if unknown:
            raise serializers.ValidationError(f"Unknown template variables: {sorted(unknown)}")
        return value


class PromptTemplateSerializer(serializers.ModelSerializer):
    active_version = serializers.SerializerMethodField()
    version_count = serializers.SerializerMethodField()

    class Meta:
        model = PromptTemplate
        fields = ["id", "name", "kind", "description", "active_version", "version_count", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_active_version(self, obj):
        v = obj.active_version
        return PromptVersionSerializer(v).data if v else None

    def get_version_count(self, obj) -> int:
        return obj.versions.count()


class AgentConfigurationSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentConfiguration
        fields = ["id", "name", "description", "mode", "provider", "model", "temperature", "top_k",
                  "retrieval_mode", "graph_expansion", "prompt_template", "prompt_version", "is_default",
                  "settings", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_provider(self, value):
        if value not in PROVIDERS:
            raise serializers.ValidationError(f"provider must be one of {PROVIDERS}")
        return value

    def validate_retrieval_mode(self, value):
        if value not in ("hybrid", "bm25", "lexical"):
            raise serializers.ValidationError("retrieval_mode must be hybrid, bm25 or lexical.")
        return value

    def validate_top_k(self, value):
        if not 1 <= value <= 50:
            raise serializers.ValidationError("top_k must be between 1 and 50.")
        return value

    def validate(self, attrs):
        mode = attrs.get("mode", getattr(self.instance, "mode", "deterministic"))
        provider = attrs.get("provider", getattr(self.instance, "provider", "mock"))
        if mode == "deterministic" and provider != "mock":
            raise serializers.ValidationError({"provider": "Deterministic mode runs offline; provider must be 'mock'."})
        return attrs

    def _single_default(self, instance):
        if instance.is_default:
            AgentConfiguration.objects.exclude(pk=instance.pk).update(is_default=False)

    def create(self, validated_data):
        inst = super().create(validated_data)
        self._single_default(inst)
        return inst

    def update(self, instance, validated_data):
        inst = super().update(instance, validated_data)
        self._single_default(inst)
        return inst


# --------------------------------------------------------------------------- extraction output

class EvidenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Evidence
        fields = ["id", "chunk", "role", "method", "quote", "context", "start_char", "end_char", "page", "score",
                  "raw_number", "normalized_value", "notes"]


class ValidationResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ValidationResult
        fields = ["id", "rule", "severity", "passed", "message", "details"]


class AnalystReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnalystReview
        fields = ["id", "result", "reviewer", "decision", "corrected_value", "corrected_unit", "evidence_quote",
                  "comment", "created_at"]
        read_only_fields = fields


class ExtractionResultSerializer(serializers.ModelSerializer):
    specification_key = serializers.CharField(source="specification.key", read_only=True)
    specification_name = serializers.CharField(source="specification.name", read_only=True)
    document_title = serializers.CharField(source="document.title", read_only=True)
    company = serializers.IntegerField(source="document.company_id", read_only=True)
    company_name = serializers.CharField(source="document.company.name", read_only=True)
    evidence = EvidenceSerializer(many=True, read_only=True)
    validations = ValidationResultSerializer(many=True, read_only=True)
    reviews = AnalystReviewSerializer(many=True, read_only=True)

    class Meta:
        model = ExtractionResult
        fields = ["id", "run", "document", "document_title", "company", "company_name", "specification",
                  "specification_key", "specification_name", "status", "raw_value", "value", "scale", "currency",
                  "unit_label", "normalized_value", "fiscal_year", "confidence", "method", "rationale", "warnings",
                  "retrieved_chunk_ids", "validation_status", "review_status", "final_value", "evidence",
                  "validations", "reviews", "created_at"]


class ExtractionRunSerializer(serializers.ModelSerializer):
    document_ids = serializers.PrimaryKeyRelatedField(source="documents", many=True, read_only=True)
    agent_name = serializers.CharField(source="agent.name", read_only=True, default=None)
    result_count = serializers.SerializerMethodField()

    class Meta:
        model = ExtractionRun
        fields = ["id", "document_ids", "agent", "agent_name", "prompt_version", "mode", "provider", "model",
                  "status", "specification_keys", "options", "error", "metrics", "usage", "created_by",
                  "started_at", "finished_at", "celery_task_id", "result_count", "created_at"]

    def get_result_count(self, obj) -> int:
        return obj.results.count()


class RunCreateSerializer(serializers.Serializer):
    document_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    company = serializers.IntegerField(required=False)
    fiscal_year = serializers.IntegerField(required=False)
    specification_keys = serializers.ListField(child=serializers.CharField(), required=False)
    agent = serializers.PrimaryKeyRelatedField(queryset=AgentConfiguration.objects.all(), required=False)
    mode = serializers.ChoiceField(choices=["deterministic", "llm"], required=False)
    provider = serializers.ChoiceField(choices=list(PROVIDERS), required=False)
    model = serializers.CharField(required=False, allow_blank=True)
    prompt_version = serializers.PrimaryKeyRelatedField(queryset=PromptVersion.objects.all(), required=False)
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=50)
    retrieval_mode = serializers.ChoiceField(choices=["hybrid", "bm25", "lexical"], required=False)
    graph_expansion = serializers.BooleanField(required=False)
    run_async = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if not (attrs.get("document_ids") or attrs.get("company") or attrs.get("fiscal_year")):
            attrs["all_documents"] = True
        return attrs


# --------------------------------------------------------------------------- reviews

class ReviewCreateSerializer(serializers.Serializer):
    result = serializers.PrimaryKeyRelatedField(queryset=ExtractionResult.objects.select_related("document", "specification"))
    decision = serializers.ChoiceField(choices=["approve", "reject", "correct"])
    reviewer = serializers.CharField(required=False, allow_blank=True, max_length=120)
    corrected_value = serializers.DecimalField(max_digits=38, decimal_places=6, required=False, allow_null=True)
    corrected_unit = serializers.CharField(required=False, allow_blank=True)
    evidence_quote = serializers.CharField(required=False, allow_blank=True)
    comment = serializers.CharField(required=False, allow_blank=True)


# --------------------------------------------------------------------------- evaluation

class EvaluationDatasetSerializer(serializers.ModelSerializer):
    case_count = serializers.SerializerMethodField()

    class Meta:
        model = EvaluationDataset
        fields = ["id", "name", "description", "case_count", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_case_count(self, obj) -> int:
        return obj.cases.count()


class EvaluationCaseSerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source="document.title", read_only=True)
    company_name = serializers.CharField(source="document.company.name", read_only=True)
    specification_key = serializers.CharField(source="specification.key", read_only=True)

    class Meta:
        model = EvaluationCase
        fields = ["id", "dataset", "document", "document_title", "company_name", "specification",
                  "specification_key", "expect_found", "expected_value", "tolerance", "notes"]
        validators = []

    def validate(self, attrs):
        expect = attrs.get("expect_found", getattr(self.instance, "expect_found", True))
        value = attrs.get("expected_value", getattr(self.instance, "expected_value", None))
        if expect and value is None:
            raise serializers.ValidationError({"expected_value": "Required when expect_found is true."})
        if not expect:
            attrs["expected_value"] = None
        return attrs


class EvaluationResultSerializer(serializers.ModelSerializer):
    specification_key = serializers.CharField(source="case.specification.key", read_only=True)
    document = serializers.IntegerField(source="case.document_id", read_only=True)
    company_name = serializers.CharField(source="case.document.company.name", read_only=True)
    fiscal_year = serializers.IntegerField(source="case.document.fiscal_year", read_only=True)

    class Meta:
        model = EvaluationResult
        fields = ["id", "run", "case", "document", "company_name", "fiscal_year", "specification_key",
                  "extraction_result", "outcome", "passed", "expected_value", "predicted_value", "detail"]


class EvaluationRunSerializer(serializers.ModelSerializer):
    dataset_name = serializers.CharField(source="dataset.name", read_only=True)
    agent_name = serializers.CharField(source="agent.name", read_only=True, default=None)

    class Meta:
        model = EvaluationRun
        fields = ["id", "dataset", "dataset_name", "agent", "agent_name", "extraction_run", "status", "metrics",
                  "error", "created_by", "created_at"]
        read_only_fields = ["extraction_run", "status", "metrics", "error", "created_by", "created_at"]


# --------------------------------------------------------------------------- audit / requests

class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = ["id", "actor", "action", "entity_type", "entity_id", "summary", "details", "created_at"]


class SearchRequestSerializer(serializers.Serializer):
    query = serializers.CharField(required=False, allow_blank=True)
    specification = serializers.CharField(required=False, help_text="Specification key; builds the query from aliases.")
    document_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    company = serializers.IntegerField(required=False)
    fiscal_year = serializers.IntegerField(required=False)
    top_k = serializers.IntegerField(required=False, default=8, min_value=1, max_value=50)
    mode = serializers.ChoiceField(choices=["hybrid", "bm25", "lexical"], required=False, default="hybrid")
    graph_expansion = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        if not (attrs.get("query") or "").strip() and not attrs.get("specification"):
            raise serializers.ValidationError("Provide 'query' or 'specification'.")
        return attrs


class PromptGenerateSerializer(serializers.Serializer):
    specification = serializers.CharField(required=False)
    specifications = serializers.ListField(child=serializers.CharField(), required=False)
    document = serializers.IntegerField(required=False)
    template = serializers.PrimaryKeyRelatedField(queryset=PromptTemplate.objects.all(), required=False)
    version = serializers.PrimaryKeyRelatedField(queryset=PromptVersion.objects.all(), required=False)
    top_k = serializers.IntegerField(required=False, default=6, min_value=1, max_value=30)
    fiscal_year = serializers.IntegerField(required=False)
    company_name = serializers.CharField(required=False, allow_blank=True)
    context = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if not attrs.get("specification") and not attrs.get("specifications"):
            raise serializers.ValidationError("Provide 'specification' or 'specifications'.")
        return attrs


class ChatRequestSerializer(serializers.Serializer):
    message = serializers.CharField()
    document_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    company = serializers.IntegerField(required=False)
    fiscal_year = serializers.IntegerField(required=False)
    provider = serializers.ChoiceField(choices=list(PROVIDERS), required=False, default="mock")
    model = serializers.CharField(required=False, allow_blank=True)
    history = serializers.ListField(child=serializers.DictField(), required=False)
    top_k = serializers.IntegerField(required=False, default=6, min_value=1, max_value=30)
