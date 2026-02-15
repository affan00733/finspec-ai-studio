from django.contrib import admin

from . import models

for m in (models.Company, models.Document, models.BusinessSpecification, models.PromptTemplate,
          models.PromptVersion, models.AgentConfiguration, models.ExtractionRun, models.ExtractionResult,
          models.AnalystReview, models.EvaluationDataset, models.EvaluationRun, models.AuditEvent):
    admin.site.register(m)
