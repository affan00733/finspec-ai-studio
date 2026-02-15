from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("companies", views.CompanyViewSet, basename="company")
router.register("documents", views.DocumentViewSet, basename="document")
router.register("specifications", views.BusinessSpecificationViewSet, basename="specification")
# NB: register versions before templates so "prompts/versions/" is not read as a template pk.
router.register("prompts/versions", views.PromptVersionViewSet, basename="prompt-version")
router.register("prompts", views.PromptTemplateViewSet, basename="prompt")
router.register("agents", views.AgentConfigurationViewSet, basename="agent")
router.register("extractions", views.ExtractionResultViewSet, basename="extraction")
router.register("runs", views.ExtractionRunViewSet, basename="run")
router.register("reviews", views.ReviewViewSet, basename="review")
router.register("evaluations/datasets", views.EvaluationDatasetViewSet, basename="evaluation-dataset")
router.register("evaluations/cases", views.EvaluationCaseViewSet, basename="evaluation-case")
router.register("evaluations/runs", views.EvaluationRunViewSet, basename="evaluation-run")
router.register("audit", views.AuditViewSet, basename="audit")

urlpatterns = [
    path("health/", views.health, name="health"),
    path("provider-status/", views.provider_status, name="provider-status"),
    path("prompts/generate/", views.prompts_generate, name="prompts-generate"),
    path("retrieval/search/", views.retrieval_search, name="retrieval-search"),
    path("evaluations/", views.evaluations_overview, name="evaluations"),
    path("chat/", views.chat, name="chat"),
    path("graph/", views.graph, name="graph"),
    path("", include(router.urls)),
]
