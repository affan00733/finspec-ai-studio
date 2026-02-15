from decimal import Decimal

from django.db import models


class TimeStamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# --------------------------------------------------------------------------- corpus

class Company(TimeStamped):
    name = models.CharField(max_length=200, unique=True)
    ticker = models.CharField(max_length=20, blank=True)
    sector = models.CharField(max_length=120, blank=True)
    description = models.TextField(blank=True)
    reporting_currency = models.CharField(max_length=8, blank=True)
    is_fictional = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name


class Document(TimeStamped):
    STATUS = [("uploaded", "Uploaded"), ("indexed", "Indexed"), ("failed", "Failed")]
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="documents")
    title = models.CharField(max_length=300)
    doc_type = models.CharField(max_length=60, default="annual_report")
    fiscal_year = models.PositiveIntegerField(null=True, blank=True)
    source_filename = models.CharField(max_length=300, blank=True)
    file_hash = models.CharField(max_length=64, blank=True, db_index=True)
    raw_text = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default="uploaded")
    error = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["company__name", "-fiscal_year", "title"]
        unique_together = [("company", "title", "fiscal_year")]

    def __str__(self):
        return f"{self.company.name} - {self.title}"


class DocumentSection(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="sections")
    order = models.PositiveIntegerField()
    heading = models.CharField(max_length=300)
    level = models.PositiveSmallIntegerField(default=1)
    section_type = models.CharField(max_length=40, default="other")
    start_char = models.PositiveIntegerField()
    end_char = models.PositiveIntegerField()

    class Meta:
        ordering = ["document_id", "order"]
        unique_together = [("document", "order")]

    def __str__(self):
        return self.heading


class DocumentChunk(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="chunks")
    section = models.ForeignKey(DocumentSection, null=True, blank=True, on_delete=models.SET_NULL,
                                related_name="chunks")
    index = models.PositiveIntegerField()
    chunk_type = models.CharField(max_length=20, default="text")
    heading = models.CharField(max_length=300, blank=True)
    text = models.TextField()
    start_char = models.PositiveIntegerField()
    end_char = models.PositiveIntegerField()
    token_count = models.PositiveIntegerField(default=0)
    page = models.PositiveIntegerField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["document_id", "index"]
        unique_together = [("document", "index")]

    def __str__(self):
        return f"{self.document_id}#{self.index}"


class ChunkRelationship(models.Model):
    source = models.ForeignKey(DocumentChunk, on_delete=models.CASCADE, related_name="out_relations")
    target = models.ForeignKey(DocumentChunk, on_delete=models.CASCADE, related_name="in_relations")
    relation_type = models.CharField(max_length=40)
    weight = models.FloatField(default=1.0)

    class Meta:
        unique_together = [("source", "target", "relation_type")]


# --------------------------------------------------------------------------- specs & prompts

class BusinessSpecification(TimeStamped):
    CATEGORY = [("financial", "Financial"), ("esg", "ESG")]
    UNIT_TYPE = [("currency", "Currency"), ("emissions", "Emissions")]
    SIGN = [("as_reported", "As reported"), ("absolute", "Absolute value")]
    key = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY, default="financial")
    unit_type = models.CharField(max_length=20, choices=UNIT_TYPE, default="currency")
    sign_policy = models.CharField(max_length=20, choices=SIGN, default="as_reported")
    aliases = models.JSONField(default=list, blank=True)
    exclude_terms = models.JSONField(default=list, blank=True)
    rules = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.name


class PromptTemplate(TimeStamped):
    KIND = [("extraction", "Extraction"), ("chat", "Chat")]
    name = models.CharField(max_length=160, unique=True)
    kind = models.CharField(max_length=20, choices=KIND, default="extraction")
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def active_version(self):
        return self.versions.filter(is_active=True).order_by("-version").first() or \
            self.versions.order_by("-version").first()


class PromptVersion(models.Model):
    template = models.ForeignKey(PromptTemplate, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    system_prompt = models.TextField()
    user_template = models.TextField()
    output_schema = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=False)
    created_by = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["template_id", "-version"]
        unique_together = [("template", "version")]

    def __str__(self):
        return f"{self.template.name} v{self.version}"


class AgentConfiguration(TimeStamped):
    MODE = [("deterministic", "Deterministic text reader"), ("llm", "LLM reader")]
    name = models.CharField(max_length=160, unique=True)
    description = models.TextField(blank=True)
    mode = models.CharField(max_length=20, choices=MODE, default="deterministic")
    provider = models.CharField(max_length=20, default="mock")  # mock | openai | azure
    model = models.CharField(max_length=120, blank=True)
    temperature = models.FloatField(default=0.0)
    top_k = models.PositiveIntegerField(default=8)
    retrieval_mode = models.CharField(max_length=20, default="hybrid")  # hybrid | bm25 | lexical
    graph_expansion = models.BooleanField(default=True)
    prompt_template = models.ForeignKey(PromptTemplate, null=True, blank=True, on_delete=models.SET_NULL,
                                        related_name="agents")
    prompt_version = models.ForeignKey(PromptVersion, null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="agents")
    is_default = models.BooleanField(default=False)
    settings = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-is_default", "name"]

    def __str__(self):
        return self.name


# --------------------------------------------------------------------------- extraction

class ExtractionRun(TimeStamped):
    STATUS = [("pending", "Pending"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")]
    documents = models.ManyToManyField(Document, related_name="runs")
    agent = models.ForeignKey(AgentConfiguration, null=True, blank=True, on_delete=models.SET_NULL,
                              related_name="runs")
    prompt_version = models.ForeignKey(PromptVersion, null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="runs")
    mode = models.CharField(max_length=20, default="deterministic")
    provider = models.CharField(max_length=20, default="mock")
    model = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default="pending")
    specification_keys = models.JSONField(default=list)
    options = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    metrics = models.JSONField(default=dict, blank=True)
    usage = models.JSONField(default=dict, blank=True)
    created_by = models.CharField(max_length=120, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    celery_task_id = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["-id"]


class ExtractionResult(TimeStamped):
    STATUS = [("found", "Found"), ("not_found", "Not found"), ("ambiguous", "Ambiguous"),
              ("rejected", "Rejected")]
    REVIEW = [("unreviewed", "Unreviewed"), ("approved", "Approved"), ("rejected", "Rejected"),
              ("corrected", "Corrected")]
    run = models.ForeignKey(ExtractionRun, on_delete=models.CASCADE, related_name="results")
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="results")
    specification = models.ForeignKey(BusinessSpecification, on_delete=models.CASCADE, related_name="results")
    status = models.CharField(max_length=20, choices=STATUS)
    raw_value = models.CharField(max_length=60, blank=True)
    value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)
    scale = models.DecimalField(max_digits=20, decimal_places=0, default=Decimal(1))
    currency = models.CharField(max_length=8, blank=True)
    unit_label = models.CharField(max_length=60, blank=True)
    normalized_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)
    fiscal_year = models.PositiveIntegerField(null=True, blank=True)
    confidence = models.FloatField(default=0.0)
    method = models.CharField(max_length=20, blank=True)
    rationale = models.TextField(blank=True)
    warnings = models.JSONField(default=list, blank=True)
    retrieved_chunk_ids = models.JSONField(default=list, blank=True)
    validation_status = models.CharField(max_length=20, default="not_applicable")
    review_status = models.CharField(max_length=20, choices=REVIEW, default="unreviewed")
    final_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)

    class Meta:
        ordering = ["run_id", "document_id", "specification_id"]
        unique_together = [("run", "document", "specification")]


class Evidence(models.Model):
    ROLE = [("primary", "Primary"), ("supporting", "Supporting"), ("conflicting", "Conflicting"),
            ("analyst", "Analyst")]
    result = models.ForeignKey(ExtractionResult, on_delete=models.CASCADE, related_name="evidence")
    chunk = models.ForeignKey(DocumentChunk, null=True, blank=True, on_delete=models.SET_NULL,
                              related_name="evidence")
    role = models.CharField(max_length=20, choices=ROLE, default="primary")
    method = models.CharField(max_length=20, blank=True)
    quote = models.TextField()
    context = models.TextField(blank=True)
    start_char = models.PositiveIntegerField(null=True, blank=True)
    end_char = models.PositiveIntegerField(null=True, blank=True)
    page = models.PositiveIntegerField(null=True, blank=True)
    score = models.FloatField(default=0.0)
    raw_number = models.CharField(max_length=60, blank=True)
    normalized_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)
    notes = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["result_id", "-score", "id"]


class ValidationResult(models.Model):
    SEVERITY = [("info", "Info"), ("warning", "Warning"), ("error", "Error")]
    result = models.ForeignKey(ExtractionResult, on_delete=models.CASCADE, related_name="validations")
    rule = models.CharField(max_length=80)
    severity = models.CharField(max_length=10, choices=SEVERITY)
    passed = models.BooleanField()
    message = models.TextField(blank=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["result_id", "id"]


class AnalystReview(models.Model):
    DECISION = [("approve", "Approve"), ("reject", "Reject"), ("correct", "Correct")]
    result = models.ForeignKey(ExtractionResult, on_delete=models.CASCADE, related_name="reviews")
    reviewer = models.CharField(max_length=120, default="analyst")
    decision = models.CharField(max_length=10, choices=DECISION)
    corrected_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)
    corrected_unit = models.CharField(max_length=60, blank=True)
    evidence_quote = models.TextField(blank=True)
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


# --------------------------------------------------------------------------- evaluation

class EvaluationDataset(TimeStamped):
    name = models.CharField(max_length=160, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]


class EvaluationCase(models.Model):
    dataset = models.ForeignKey(EvaluationDataset, on_delete=models.CASCADE, related_name="cases")
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="eval_cases")
    specification = models.ForeignKey(BusinessSpecification, on_delete=models.CASCADE, related_name="eval_cases")
    expect_found = models.BooleanField(default=True)
    expected_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True,
                                         help_text="Normalized value (base currency units / tCO2e).")
    tolerance = models.FloatField(default=0.0005)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["dataset_id", "document_id", "specification_id"]
        unique_together = [("dataset", "document", "specification")]


class EvaluationRun(TimeStamped):
    STATUS = [("pending", "Pending"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")]
    dataset = models.ForeignKey(EvaluationDataset, on_delete=models.CASCADE, related_name="runs")
    agent = models.ForeignKey(AgentConfiguration, null=True, blank=True, on_delete=models.SET_NULL,
                              related_name="eval_runs")
    extraction_run = models.ForeignKey(ExtractionRun, null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="eval_runs")
    status = models.CharField(max_length=20, choices=STATUS, default="pending")
    metrics = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    created_by = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["-id"]


class EvaluationResult(models.Model):
    run = models.ForeignKey(EvaluationRun, on_delete=models.CASCADE, related_name="results")
    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="results")
    extraction_result = models.ForeignKey(ExtractionResult, null=True, blank=True, on_delete=models.SET_NULL,
                                          related_name="eval_results")
    outcome = models.CharField(max_length=30)
    passed = models.BooleanField(default=False)
    expected_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)
    predicted_value = models.DecimalField(max_digits=38, decimal_places=6, null=True, blank=True)
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["run_id", "case_id"]
        unique_together = [("run", "case")]


# --------------------------------------------------------------------------- audit

class AuditEvent(models.Model):
    actor = models.CharField(max_length=120, default="system")
    action = models.CharField(max_length=80, db_index=True)
    entity_type = models.CharField(max_length=60, db_index=True)
    entity_id = models.CharField(max_length=60, blank=True)
    summary = models.CharField(max_length=300, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]
