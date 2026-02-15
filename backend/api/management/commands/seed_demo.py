"""Seed the database with the fictional FinSpec demo corpus.

    python manage.py seed_demo            # idempotent upsert + initial run + evaluation
    python manage.py seed_demo --reset    # wipe domain data first
    python manage.py seed_demo --no-run   # data only; skip extraction/evaluation
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api import services
from api.models import (
    AgentConfiguration, AuditEvent, BusinessSpecification, Company, Document, EvaluationCase, EvaluationDataset,
    EvaluationRun, ExtractionRun, PromptTemplate, PromptVersion,
)
from engine.demo_corpus import PROFILES, build_corpus
from engine.prompts import DEFAULT_PROMPTS
from engine.specs import DEFAULT_SPECS


class Command(BaseCommand):
    help = "Seed fictional demo companies, annual reports, specifications, prompts, agents and a gold dataset."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing domain data first.")
        parser.add_argument("--no-run", action="store_true", help="Skip the initial extraction + evaluation run.")

    def handle(self, *args, **opts):
        if opts["reset"]:
            self.stdout.write("Resetting domain data...")
            for model in (EvaluationRun, EvaluationDataset, ExtractionRun, Document, Company, AgentConfiguration,
                          PromptTemplate, BusinessSpecification, AuditEvent):
                model.objects.all().delete()
        with transaction.atomic():
            specs = self._specs()
            templates = self._prompts()
            self._agents(templates)
            docs = self._corpus()
            dataset = self._gold(docs, specs)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(specs)} specifications, {len(templates)} prompt templates, {len(docs)} documents, "
            f"{dataset.cases.count()} gold cases."))
        if not opts["no_run"]:
            self._initial_run(docs, dataset)

    # ------------------------------------------------------------------
    def _specs(self):
        out = {}
        for d in DEFAULT_SPECS:
            obj, _ = BusinessSpecification.objects.update_or_create(
                key=d["key"], defaults={k: d[k] for k in (
                    "name", "description", "category", "unit_type", "sign_policy", "aliases", "exclude_terms",
                    "rules")} | {"is_active": True})
            out[d["key"]] = obj
        return out

    def _prompts(self):
        out = {}
        for p in DEFAULT_PROMPTS:
            tpl, _ = PromptTemplate.objects.update_or_create(
                name=p["name"], defaults={"kind": p["kind"], "description": p["description"]})
            for v in p["versions"]:
                PromptVersion.objects.update_or_create(
                    template=tpl, version=v["version"],
                    defaults={"system_prompt": v["system_prompt"], "user_template": v["user_template"],
                              "output_schema": v["output_schema"], "notes": v["notes"],
                              "is_active": v["is_active"], "created_by": "seed_demo"})
            out[p["name"]] = tpl
        return out

    def _agents(self, templates):
        tpl = templates["Metric Extraction"]
        AgentConfiguration.objects.update_or_create(
            name="Deterministic Reader (offline)",
            defaults={"mode": "deterministic", "provider": "mock", "is_default": True, "top_k": 8,
                      "description": "Default. Evidence-grounded text reader; no network, no API keys."})
        AgentConfiguration.objects.update_or_create(
            name="Mock LLM Pipeline (offline)",
            defaults={"mode": "llm", "provider": "mock", "is_default": False, "top_k": 8, "prompt_template": tpl,
                      "description": "Exercises the full prompt -> model -> grounding-verification path offline."})
        AgentConfiguration.objects.update_or_create(
            name="OpenAI Responses API",
            defaults={"mode": "llm", "provider": "openai", "model": "gpt-4.1-mini", "is_default": False, "top_k": 8,
                      "prompt_template": tpl,
                      "description": "Paid. Requires OPENAI_API_KEY. Fails loudly if unconfigured - no mock fallback."})
        AgentConfiguration.objects.update_or_create(
            name="Azure OpenAI Responses API",
            defaults={"mode": "llm", "provider": "azure", "model": "", "is_default": False, "top_k": 8,
                      "prompt_template": tpl,
                      "description": "Paid. Requires AZURE_OPENAI_ENDPOINT / _API_KEY / _DEPLOYMENT. No fallback."})

    def _corpus(self):
        profiles = {p.name: p for p in PROFILES}
        companies = {}
        for name, p in profiles.items():
            companies[name], _ = Company.objects.update_or_create(
                name=name, defaults={"ticker": p.ticker, "sector": p.sector, "description": p.description,
                                     "reporting_currency": p.currency, "is_fictional": True})
        docs = []
        for item in build_corpus():
            doc, _ = Document.objects.update_or_create(
                company=companies[item["company"]], title=item["title"], fiscal_year=item["fiscal_year"],
                defaults={"doc_type": "annual_report", "raw_text": item["text"],
                          "source_filename": item["filename"], "metadata": {"format": "text", "demo": True}})
            services.ingest_document(doc, actor="seed_demo")
            doc.demo_gold = item["gold"]
            docs.append(doc)
        return docs

    def _gold(self, docs, specs):
        ds, _ = EvaluationDataset.objects.update_or_create(
            name="Demo Gold Set (FY2022-FY2024)",
            defaults={"description": "Expected values derived from the generated demo corpus. Includes cases where "
                                     "a metric is legitimately absent (expect_found=false), e.g. 'Revenue' for a "
                                     "company that reports 'Net sales'."})
        for doc in docs:
            for key, expected in doc.demo_gold.items():
                EvaluationCase.objects.update_or_create(
                    dataset=ds, document=doc, specification=specs[key],
                    defaults={"expect_found": expected is not None,
                              "expected_value": Decimal(expected) if expected is not None else None,
                              "tolerance": 0.0005,
                              "notes": "" if expected is not None else "Not reported under this line-item name."})
        return ds

    def _initial_run(self, docs, dataset):
        agent = services.get_default_agent()
        run = services.create_run([d.id for d in docs], None, agent, {}, "seed_demo")
        run = services.execute_run(run.id)
        self.stdout.write(f"Extraction run #{run.id}: {run.status} {run.metrics.get('by_status', {})}")
        er = EvaluationRun.objects.create(dataset=dataset, agent=agent, created_by="seed_demo")
        er = services.execute_evaluation(er.id)
        overall = er.metrics.get("overall", {})
        self.stdout.write(self.style.SUCCESS(
            f"Evaluation #{er.id}: {er.status} accuracy={overall.get('accuracy')} f1={overall.get('f1')} "
            f"({overall.get('correct', 0)} correct, {overall.get('correct_absent', 0)} correct-absent, "
            f"{overall.get('incorrect_value', 0)} wrong, {overall.get('missed', 0)} missed, "
            f"{overall.get('false_positive', 0)} false positives)"))
