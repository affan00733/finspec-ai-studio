import pytest
from django.core.management import call_command

from api.models import Company, Document, EvaluationCase, ExtractionRun

pytestmark = pytest.mark.django_db


def test_seed_is_idempotent_and_runs_eval():
    n_docs = Document.objects.count()
    call_command("seed_demo", verbosity=0)  # includes initial run + evaluation
    assert Document.objects.count() == n_docs == 12
    assert Company.objects.count() == 4 and EvaluationCase.objects.count() == 156
    run = ExtractionRun.objects.order_by("-id").first()
    assert run.status == "completed" and run.metrics["total"] > 0
    from api.models import EvaluationRun

    er = EvaluationRun.objects.order_by("-id").first()
    assert er.status == "completed" and er.metrics["overall"]["accuracy"] == 1.0


def test_demo_documents_differ_by_company_and_year():
    texts = {(d.company.name, d.fiscal_year): d.raw_text for d in Document.objects.select_related("company")}
    assert len(set(texts.values())) == 12
    assert "Net sales" in texts[("Meridian Industrial", 2024)] and "Net sales" not in texts[("Northstar Energy", 2024)]
    assert "Turnover" in texts[("Cascade Retail", 2023)] and "Operating revenue" in texts[("Atlas Materials", 2022)]
