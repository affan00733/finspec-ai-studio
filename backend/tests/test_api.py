import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from api.models import (
    AuditEvent, BusinessSpecification, Company, Document, EvaluationDataset, ExtractionResult, ExtractionRun,
)

pytestmark = pytest.mark.django_db
B = "/api/v1/"


def results(resp):
    return resp.data["results"] if isinstance(resp.data, dict) and "results" in resp.data else resp.data


def doc_of(company, year):
    return Document.objects.get(company__name=company, fiscal_year=year)


# ---------------------------------------------------------------- seed / basics

def test_seed_loaded_expected_entities():
    assert Company.objects.count() == 4
    assert set(Company.objects.values_list("name", flat=True)) == {
        "Northstar Energy", "Meridian Industrial", "Cascade Retail", "Atlas Materials"}
    assert Document.objects.count() == 12 and Document.objects.filter(status="indexed").count() == 12
    assert set(BusinessSpecification.objects.values_list("name", flat=True)) >= {
        "Revenue", "Net Sales", "Turnover", "Operating Revenue", "Operating Income", "EBITDA", "CapEx",
        "Green CapEx", "R&D", "Scope 1", "Scope 2", "Total Assets", "Total Liabilities"}
    assert EvaluationDataset.objects.get().cases.count() == 156


def test_health_and_provider_status(client):
    r = client.get(B + "health/")
    assert r.status_code == 200 and r.data["status"] == "ok" and r.data["counts"]["documents"] == 12
    r = client.get(B + "provider-status/")
    names = {p["name"]: p for p in r.data["providers"]}
    assert r.data["default_provider"] == "mock" and names["mock"]["configured"] is True
    assert names["openai"]["configured"] is False and "OPENAI_API_KEY" in names["openai"]["missing"]
    assert "never substituted" in r.data["fallback_policy"]


def test_cors_headers_for_frontend(client):
    r = client.get(B + "health/", HTTP_ORIGIN="http://localhost:5173")
    assert r["Access-Control-Allow-Origin"] == "http://localhost:5173"


# ---------------------------------------------------------------- companies / documents

def test_company_crud_and_audit(client):
    r = client.post(B + "companies/", {"name": "Test Corp", "ticker": "TST"}, format="json", HTTP_X_ACTOR="tester")
    assert r.status_code == 201
    cid = r.data["id"]
    assert client.patch(f"{B}companies/{cid}/", {"sector": "Tech"}, format="json").data["sector"] == "Tech"
    assert client.get(B + "companies/?q=test").data["count"] == 1
    assert client.delete(f"{B}companies/{cid}/").status_code == 204
    ev = AuditEvent.objects.filter(entity_type="company", entity_id=str(cid))
    assert set(ev.values_list("action", flat=True)) == {"company.created", "company.updated", "company.deleted"}
    assert ev.get(action="company.created").actor == "tester"


def test_document_list_filters_and_detail(client):
    r = client.get(B + "documents/?fiscal_year=2024")
    assert r.data["count"] == 4 and "raw_text" not in r.data["results"][0]
    d = doc_of("Atlas Materials", 2023)
    det = client.get(f"{B}documents/{d.id}/").data
    assert "Operating revenue" in det["raw_text"] and det["sections"] and det["chunk_count"] > 5
    chunks = client.get(f"{B}documents/{d.id}/chunks/?type=table").data
    assert chunks["count"] >= 4 and all(c["chunk_type"] == "table" for c in chunks["results"])
    assert client.get(f"{B}documents/{d.id}/sections/").data


def test_document_upload_text_file_is_parsed_chunked_and_extractable(client):
    comp = Company.objects.get(name="Atlas Materials")
    content = (b"# Newco Annual Report 2025\n\nFiscal Year 2025\n\nAll amounts are expressed in USD millions.\n\n"
               b"## Income Statement\n\nTable 1: Income (USD millions)\n\n| Line item | FY2025 | FY2024 |\n|---|---|---|\n"
               b"| Revenue | 777.7 | 700.0 |\n")
    f = SimpleUploadedFile("newco.md", content, content_type="text/markdown")
    r = client.post(B + "documents/", {"company": comp.id, "file": f, "fiscal_year": 2025}, format="multipart")
    assert r.status_code == 201, r.data
    assert r.data["status"] == "indexed" and r.data["title"] == "newco" and r.data["file_hash"]
    run = client.post(B + "runs/", {"document_ids": [r.data["id"]], "specification_keys": ["revenue"]}, format="json")
    assert run.status_code == 201
    res = results(client.get(f"{B}extractions/?run={run.data['id']}"))[0]
    assert res["normalized_value"] == "777700000.000000" and res["evidence"][0]["quote"].startswith("| Revenue")


def test_document_validation_errors(client):
    comp = Company.objects.first()
    assert client.post(B + "documents/", {"company": comp.id, "title": "x"}, format="json").status_code == 400
    assert client.post(B + "documents/", {"company": comp.id, "raw_text": "text"}, format="json").status_code == 400
    r = client.post(B + "documents/", {"company": comp.id, "title": "dup", "raw_text": "# H\n\nbody"}, format="json")
    assert r.status_code == 201
    r2 = client.post(B + "documents/", {"company": comp.id, "title": "dup", "raw_text": "# H\n\nbody"}, format="json")
    assert r2.status_code == 400


def test_document_reindex(client):
    d = doc_of("Cascade Retail", 2024)
    n = d.chunks.count()
    r = client.post(f"{B}documents/{d.id}/reindex/")
    assert r.status_code == 200 and d.chunks.count() == n


# ---------------------------------------------------------------- specifications / prompts / agents

def test_specification_crud_versioning_and_soft_delete(client):
    r = client.post(B + "specifications/", {"key": "dividends", "name": "Dividends", "aliases": ["Dividends paid"]},
                    format="json")
    assert r.status_code == 201 and r.data["version"] == 1
    sid = r.data["id"]
    r = client.patch(f"{B}specifications/{sid}/", {"aliases": ["Dividends paid", "Dividend"]}, format="json")
    assert r.data["version"] == 2
    assert client.post(B + "specifications/", {"key": "bad", "name": "Bad", "aliases": []}, format="json").status_code == 400
    assert client.delete(f"{B}specifications/{sid}/").status_code == 204
    rev = BusinessSpecification.objects.get(key="revenue")
    client.post(B + "runs/", {"document_ids": [doc_of("Northstar Energy", 2024).id], "specification_keys": ["revenue"]}, format="json")
    r = client.delete(f"{B}specifications/{rev.id}/")
    assert r.status_code == 200 and r.data["deactivated"] is True
    assert BusinessSpecification.objects.get(key="revenue").is_active is False


def test_prompt_templates_versions_and_generate(client):
    tpls = results(client.get(B + "prompts/"))
    tpl = next(t for t in tpls if t["name"] == "Metric Extraction")
    assert tpl["active_version"]["version"] == 2
    r = client.post(f"{B}prompts/{tpl['id']}/versions/", {
        "system_prompt": "Be precise.", "user_template": "Metric {{spec_name}} in {{company}}\n{{context}}",
        "output_schema": {}, "is_active": True}, format="json")
    assert r.status_code == 201 and r.data["version"] == 3 and r.data["variables"] == ["company", "context", "spec_name"]
    bad = client.post(f"{B}prompts/{tpl['id']}/versions/", {"system_prompt": "s", "user_template": "{{nonsense}}"}, format="json")
    assert bad.status_code == 400
    assert client.get(f"{B}prompts/{tpl['id']}/").data["active_version"]["version"] == 3
    v1 = client.get(B + f"prompts/versions/?template={tpl['id']}").data["results"][-1]
    assert client.post(f"{B}prompts/versions/{v1['id']}/activate/").data["is_active"] is True

    d = doc_of("Meridian Industrial", 2023)
    g = client.post(B + "prompts/generate/", {"specification": "net_sales", "document": d.id, "version": v1["id"]}, format="json")
    assert g.status_code == 200
    p = g.data["prompt"]
    assert "Meridian Industrial" in p["user"] and "Target fiscal year: 2023" in p["user"] and "Net sales" in p["user"]
    assert p["retrieved_chunk_ids"] and p["schema"]["required"]
    g2 = client.post(B + "prompts/generate/", {"specifications": ["ebitda", "capex"], "company_name": "X", "fiscal_year": 2024}, format="json")
    assert len(g2.data["prompts"]) == 2 and "(no excerpts retrieved)" in g2.data["prompts"][0]["user"]
    assert client.post(B + "prompts/generate/", {"specification": "nope"}, format="json").status_code == 404


def test_agent_configuration_rules(client):
    r = client.post(B + "agents/", {"name": "A1", "mode": "deterministic", "provider": "openai"}, format="json")
    assert r.status_code == 400
    r = client.post(B + "agents/", {"name": "A2", "mode": "llm", "provider": "openai", "model": "gpt-4.1", "top_k": 5},
                    format="json")
    assert r.status_code == 201
    r = client.post(B + "agents/", {"name": "A3", "mode": "deterministic", "provider": "mock", "is_default": True}, format="json")
    assert r.status_code == 201
    from api.models import AgentConfiguration

    assert AgentConfiguration.objects.filter(is_default=True).count() == 1


# ---------------------------------------------------------------- retrieval

def test_retrieval_search_hybrid_with_graph(client):
    d = doc_of("Northstar Energy", 2024)
    r = client.post(B + "retrieval/search/", {"query": "Scope 1 emissions", "document_ids": [d.id], "top_k": 3}, format="json")
    assert r.status_code == 200 and r.data["count"] >= 3
    top = r.data["hits"][0]
    assert top["via"] == "direct" and "Scope 1" in top["text"] and {"bm25", "lexical", "rrf"} <= set(top["scores"])
    assert any(h["via"] == "graph" and h["relation"] for h in r.data["hits"])
    nog = client.post(B + "retrieval/search/", {"query": "Scope 1 emissions", "document_ids": [d.id], "top_k": 3,
                                                "graph_expansion": False}, format="json")
    assert all(h["via"] == "direct" for h in nog.data["hits"])
    for mode in ("bm25", "lexical"):
        assert client.post(B + "retrieval/search/", {"query": "revenue", "mode": mode}, format="json").status_code == 200
    by_spec = client.post(B + "retrieval/search/", {"specification": "ebitda", "company": d.company_id, "fiscal_year": 2024}, format="json")
    assert by_spec.data["hits"] and "EBITDA" in by_spec.data["hits"][0]["text"]
    assert client.post(B + "retrieval/search/", {}, format="json").status_code == 400


# ---------------------------------------------------------------- runs / extractions

def test_run_extraction_offline_default_results_and_evidence(client):
    d = doc_of("Cascade Retail", 2024)
    r = client.post(B + "runs/", {"document_ids": [d.id]}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["status"] == "completed" and r.data["mode"] == "deterministic" and r.data["provider"] == "mock"
    assert r.data["result_count"] == 13 and r.data["metrics"]["by_status"]["found"] >= 8
    res = results(client.get(f"{B}runs/{r.data['id']}/results/"))
    by = {x["specification_key"]: x for x in res}
    t = by["turnover"]
    assert t["status"] == "found" and t["currency"] == "GBP" and t["fiscal_year"] == 2024 and t["confidence"] > 0.9
    assert t["evidence"][0]["quote"].startswith("| Turnover |") and t["evidence"][0]["chunk"]
    assert any(v["rule"] == "evidence_grounded" and v["passed"] for v in t["validations"])
    assert by["revenue"]["status"] == "not_found" and by["revenue"]["normalized_value"] is None
    cap = by["capex"]
    assert float(cap["value"]) > 0 and "(" in cap["evidence"][0]["quote"]
    d_text = Document.objects.get(pk=d.id).raw_text
    ev = t["evidence"][0]
    assert d_text[ev["start_char"]:ev["end_char"]] == ev["quote"]


def test_extractions_change_by_company_and_year(client):
    ids = [doc_of("Northstar Energy", y).id for y in (2022, 2023, 2024)] + [doc_of("Atlas Materials", 2024).id]
    r = client.post(B + "extractions/", {"document_ids": ids, "specification_keys": ["revenue", "operating_revenue", "scope_1"]}, format="json")
    assert r.status_code == 201
    rows = {(x["company_name"], x["fiscal_year"], x["specification_key"]): x for x in r.data["results"]}
    n_vals = {rows[("Northstar Energy", y, "revenue")]["normalized_value"] for y in (2022, 2023, 2024)}
    assert len(n_vals) == 3
    assert rows[("Atlas Materials", 2024, "revenue")]["status"] == "not_found"
    assert rows[("Atlas Materials", 2024, "operating_revenue")]["status"] == "found"
    assert rows[("Northstar Energy", 2024, "scope_1")]["unit_label"] == "ktCO2e"


def test_extractions_filters_and_latest(client):
    d = doc_of("Meridian Industrial", 2022)
    client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": ["net_sales", "rd_expense"]}, format="json")
    client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": ["net_sales"]}, format="json")
    allr = results(client.get(f"{B}extractions/?document={d.id}&specification=net_sales"))
    assert len(allr) == 2
    latest = results(client.get(f"{B}extractions/?document={d.id}&specification=net_sales&latest=true"))
    assert len(latest) == 1 and latest[0]["run"] == max(x["run"] for x in allr)
    assert results(client.get(f"{B}extractions/?document={d.id}&status=not_found"))[0]["specification_key"] == "rd_expense"
    detail = client.get(f"{B}extractions/{latest[0]['id']}/")
    assert detail.status_code == 200 and detail.data["evidence"]


def test_run_validation_and_rerun(client):
    assert client.post(B + "runs/", {"document_ids": [999999]}, format="json").status_code == 400
    d = doc_of("Atlas Materials", 2022)
    assert client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": ["nope"]}, format="json").status_code == 400
    r = client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": ["scope_2", "ebitda"], "top_k": 4,
                                  "retrieval_mode": "bm25"}, format="json")
    assert r.data["options"]["retrieval_mode"] == "bm25"
    again = client.post(f"{B}runs/{r.data['id']}/rerun/")
    assert again.status_code == 201 and again.data["id"] != r.data["id"] and again.data["options"]["top_k"] == 4
    assert client.get(B + "runs/?status=completed").data["count"] >= 2


def test_llm_mode_with_mock_provider_runs_full_pipeline(client):
    d = doc_of("Northstar Energy", 2023)
    r = client.post(B + "runs/", {"document_ids": [d.id], "mode": "llm", "provider": "mock",
                                  "specification_keys": ["revenue", "ebitda", "scope_2"]}, format="json")
    assert r.status_code == 201 and r.data["mode"] == "llm" and r.data["usage"]["calls"] == 3
    res = results(client.get(f"{B}extractions/?run={r.data['id']}"))
    assert all(x["status"] == "found" for x in res) and all(x["method"] == "llm" for x in res)
    assert all(x["validation_status"] == "pass" for x in res)


def test_paid_provider_without_credentials_fails_loudly_no_fallback(client):
    d = doc_of("Northstar Energy", 2023)
    before = ExtractionResult.objects.count()
    r = client.post(B + "runs/", {"document_ids": [d.id], "mode": "llm", "provider": "openai"}, format="json")
    assert r.status_code == 409
    assert r.data["error"]["code"] == "provider_not_configured" and "OPENAI_API_KEY" in r.data["error"]["message"]
    assert r.data["run"]["status"] == "failed" and r.data["run"]["provider"] == "openai"
    assert ExtractionResult.objects.count() == before  # nothing was produced by a silent mock
    az = client.post(B + "runs/", {"document_ids": [d.id], "mode": "llm", "provider": "azure"}, format="json")
    assert az.status_code == 409 and "AZURE_OPENAI" in az.data["error"]["message"]
    seeded = next(a for a in results(client.get(B + "agents/")) if a["provider"] == "openai")
    r3 = client.post(B + "runs/", {"document_ids": [d.id], "agent": seeded["id"]}, format="json")
    assert r3.status_code == 409
    assert AuditEvent.objects.filter(action="run.failed").exists()
    chat = client.post(B + "chat/", {"message": "revenue?", "provider": "openai"}, format="json")
    assert chat.status_code == 409


# ---------------------------------------------------------------- reviews

def _one_result(client, company="Northstar Energy", year=2024, spec="revenue"):
    d = doc_of(company, year)
    run = client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": [spec]}, format="json")
    return results(client.get(f"{B}extractions/?run={run.data['id']}"))[0], d


def test_review_approve_reject_correct_flow(client):
    res, d = _one_result(client)
    r = client.post(B + "reviews/", {"result": res["id"], "decision": "approve", "reviewer": "ana"}, format="json")
    assert r.status_code == 201 and r.data["result_state"]["review_status"] == "approved"
    assert r.data["result_state"]["final_value"] == res["normalized_value"]
    r = client.post(B + "reviews/", {"result": res["id"], "decision": "reject", "comment": "wrong"}, format="json")
    assert r.data["result_state"]["review_status"] == "rejected" and r.data["result_state"]["final_value"] is None
    quote = res["evidence"][0]["quote"]
    r = client.post(B + "reviews/", {"result": res["id"], "decision": "correct", "corrected_value": "123000000",
                                     "evidence_quote": quote, "comment": "restated"}, format="json")
    assert r.status_code == 201 and r.data["result_state"]["review_status"] == "corrected"
    detail = client.get(f"{B}extractions/{res['id']}/").data
    assert detail["final_value"] == "123000000.000000" and len(detail["reviews"]) == 3
    assert any(e["role"] == "analyst" for e in detail["evidence"])
    assert AuditEvent.objects.filter(action="review.correct", entity_id=str(res["id"])).exists()
    assert client.get(B + f"reviews/?result={res['id']}").data["count"] == 3


def test_review_rules(client):
    res, d = _one_result(client, "Meridian Industrial", 2024, "revenue")  # not found
    assert res["status"] == "not_found"
    assert client.post(B + "reviews/", {"result": res["id"], "decision": "approve"}, format="json").status_code == 400
    assert client.post(B + "reviews/", {"result": res["id"], "decision": "correct", "corrected_value": "5"}, format="json").status_code == 400
    r = client.post(B + "reviews/", {"result": res["id"], "decision": "correct", "corrected_value": "5",
                                     "evidence_quote": "this text is not in the document"}, format="json")
    assert r.status_code == 400 and r.data["error"]["code"] == "evidence_not_found"
    assert client.post(B + "reviews/", {"result": res["id"], "decision": "maybe"}, format="json").status_code == 400


# ---------------------------------------------------------------- evaluations

def test_evaluation_run_over_gold_dataset(client):
    ds = client.get(B + "evaluations/datasets/").data["results"][0]
    assert ds["case_count"] == 156
    cases = client.get(f"{B}evaluations/datasets/{ds['id']}/cases/").data
    assert cases["count"] == 156
    r = client.post(B + "evaluations/runs/", {"dataset": ds["id"]}, format="json")
    assert r.status_code == 201, r.data
    m = r.data["metrics"]
    assert r.data["status"] == "completed" and m["overall"]["total"] == 156
    assert m["overall"]["accuracy"] == 1.0 and m["overall"]["f1"] == 1.0
    assert m["overall"]["correct_absent"] == 45 and set(m["by_company"]) == {
        "Northstar Energy", "Meridian Industrial", "Cascade Retail", "Atlas Materials"}
    res = client.get(f"{B}evaluations/runs/{r.data['id']}/results/?passed=false")
    assert res.data["count"] == 0
    assert client.get(B + "evaluations/").data["recent_runs"][0]["id"] == r.data["id"]


def test_evaluation_detects_wrong_gold_and_case_validation(client):
    ds = EvaluationDataset.objects.create(name="tmp")
    d = doc_of("Northstar Energy", 2024)
    spec = BusinessSpecification.objects.get(key="revenue")
    bad = client.post(B + "evaluations/cases/", {"dataset": ds.id, "document": d.id, "specification": spec.id,
                                                 "expect_found": True}, format="json")
    assert bad.status_code == 400
    ok = client.post(B + "evaluations/cases/", {"dataset": ds.id, "document": d.id, "specification": spec.id,
                                                "expect_found": True, "expected_value": "1"}, format="json")
    assert ok.status_code == 201
    absent = BusinessSpecification.objects.get(key="net_sales")
    fp = client.post(B + "evaluations/cases/", {"dataset": ds.id, "document": d.id, "specification": absent.id,
                                                "expect_found": True, "expected_value": "5"}, format="json")
    assert fp.status_code == 201
    r = client.post(B + "evaluations/runs/", {"dataset": ds.id}, format="json")
    outcomes = {x["specification_key"]: x["outcome"] for x in client.get(f"{B}evaluations/runs/{r.data['id']}/results/").data["results"]}
    assert outcomes == {"revenue": "incorrect_value", "net_sales": "missed"}
    assert r.data["metrics"]["overall"]["accuracy"] == 0.0


# ---------------------------------------------------------------- chat

def test_chat_infers_company_and_year_and_never_substitutes_revenue(client):
    r = client.post(B + "chat/", {"message": "What was Meridian Industrial's revenue in 2024?"}, format="json")
    assert r.status_code == 200 and r.data["provider"] == "mock" and r.data["mode"] == "extractive"
    assert [d["title"] for d in r.data["scope"]["documents"]] == ["Meridian Industrial Annual Report 2024"]
    assert "not reported" in r.data["answer"] and "'Net Sales'" in r.data["answer"]
    assert r.data["extractions"][0]["status"] == "not_found" and r.data["citations"]


def test_chat_answers_with_citation_and_value(client):
    r = client.post(B + "chat/", {"message": "What is the EBITDA for Northstar Energy in FY2023?"}, format="json")
    ex = r.data["extractions"][0]
    assert ex["status"] == "found" and ex["company"] == "Northstar Energy" and ex["fiscal_year"] == 2023
    d = doc_of("Northstar Energy", 2023)
    raw = d.raw_text
    cite = r.data["citations"][0]
    assert raw[cite["start_char"]:cite["end_char"]] == cite["quote"]
    assert ex["reported"].split()[0] in r.data["answer"]
    r2 = client.post(B + "chat/", {"message": "Compare scope 2 emissions", "fiscal_year": 2024}, format="json")
    assert {e["company"] for e in r2.data["extractions"]} == {
        "Northstar Energy", "Meridian Industrial", "Cascade Retail", "Atlas Materials"}


def test_chat_free_text_and_empty_scope(client):
    r = client.post(B + "chat/", {"message": "What guidance does management give?", "company": Company.objects.get(name="Northstar Energy").id}, format="json")
    assert r.status_code == 200 and r.data["citations"] and "guidance" in r.data["answer"].lower()
    r = client.post(B + "chat/", {"message": "revenue", "fiscal_year": 1999}, format="json")
    assert "No matching" in r.data["answer"]
    assert client.post(B + "chat/", {}, format="json").status_code == 400


# ---------------------------------------------------------------- audit / graph

def test_audit_log_filters(client):
    d = doc_of("Atlas Materials", 2024)
    client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": ["ebitda"]}, format="json")
    r = client.get(B + "audit/?entity_type=extraction_run")
    actions = {e["action"] for e in r.data["results"]}
    assert {"run.created", "run.completed"} <= actions
    assert client.get(B + "audit/?action_prefix=document.").data["count"] >= 12
    assert client.get(B + "audit/?q=indexed").data["count"] >= 12
    e = r.data["results"][0]
    assert client.get(f"{B}audit/{e['id']}/").data["id"] == e["id"]
    assert client.delete(f"{B}audit/{e['id']}/").status_code == 405  # append-only


def test_graph_endpoint(client):
    d = doc_of("Northstar Energy", 2024)
    run = client.post(B + "runs/", {"document_ids": [d.id], "specification_keys": ["revenue", "scope_1"]}, format="json")
    g = client.get(f"{B}graph/?document={d.id}&run={run.data['id']}")
    assert g.status_code == 200
    types = {n["type"] for n in g.data["nodes"]}
    assert {"company", "document", "chunk", "specification", "result"} <= types
    etypes = {e["type"] for e in g.data["edges"]}
    assert {"published", "contains", "next", "evidence_primary", "measured_as"} <= etypes
    ids = {n["id"] for n in g.data["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in g.data["edges"])
    assert client.get(f"{B}graph/?run=999999").status_code == 404
    assert client.get(f"{B}graph/?company={d.company_id}").data["stats"]["nodes"] > 20


def test_not_found_routes_and_pagination(client):
    assert client.get(B + "runs/9999999/").status_code == 404
    r = client.get(B + "documents/?page_size=5")
    assert len(r.data["results"]) == 5 and r.data["next"]
