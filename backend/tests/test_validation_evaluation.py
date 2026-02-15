from decimal import Decimal

from engine import evaluation as ev
from engine.extraction import DeterministicExtractor
from engine.specs import default_spec_defs
from engine.types import Candidate, ExtractionOutcome
from engine.validation import summarize, validate_cross, validate_outcome

SPECS = {s.key: s for s in default_spec_defs()}


def outcome(key, normalized, quote="| X | 1 |", raw="1", currency="USD", status="found", year=2024):
    c = Candidate(spec_key=key, method="table", label="X", raw_number=raw, value=Decimal(raw), scale=Decimal(1),
                  currency=currency, unit_label=f"{currency} units", normalized=Decimal(normalized),
                  granularity=Decimal(1), chunk_id=1, document_id=1, quote=quote, start_char=0,
                  end_char=len(quote), score=0.95, year=year, year_matched=True, unit_source="table_header")
    return ExtractionOutcome(spec_key=key, status=status, fiscal_year=year, best=c, candidates=[c], confidence=0.95)


def test_real_extraction_passes_validation(make_index, corpus):
    d = corpus[0]
    index, ctxs = make_index({0: d["text"]}, {0: d["fiscal_year"]})
    ex = DeterministicExtractor(index)
    o = ex.extract(SPECS["revenue"], 0, ctxs[0])
    from engine import parsing

    checks = validate_outcome(o, SPECS["revenue"], ctxs[0], parsing.normalize_text(d["text"]))
    assert summarize(checks) == "pass", [(c.rule, c.passed) for c in checks if not c.passed]


def test_ungrounded_value_fails_validation():
    o = outcome("revenue", 5_000_000, quote="| Revenue | 999 |", raw="1234")
    checks = validate_outcome(o, SPECS["revenue"], ctx=type("C", (), {"currency": "USD"})())
    bad = {c.rule for c in checks if not c.passed}
    assert "evidence_grounded" in bad and summarize(checks) == "fail"


def test_negative_revenue_and_currency_mismatch_fail():
    o = outcome("revenue", -5_000_000, quote="| Revenue | -5 |", raw="-5", currency="EUR")
    checks = validate_outcome(o, SPECS["revenue"], ctx=type("C", (), {"currency": "USD"})())
    bad = {c.rule for c in checks if not c.passed}
    assert {"non_negative", "currency_matches_document"} <= bad


def test_not_found_and_ambiguous_summaries():
    nf = ExtractionOutcome("revenue", "not_found", 2024, rationale="none")
    assert summarize(validate_outcome(nf, SPECS["revenue"], None), "not_found") == "not_applicable"
    amb = ExtractionOutcome("revenue", "ambiguous", 2024, rationale="conflict")
    assert summarize(validate_outcome(amb, SPECS["revenue"], None), "ambiguous") == "fail"


def test_cross_metric_rules():
    ok = {"capex": outcome("capex", 100), "green_capex": outcome("green_capex", 30),
          "ebitda": outcome("ebitda", 200), "operating_income": outcome("operating_income", 150),
          "total_assets": outcome("total_assets", 1000), "total_liabilities": outcome("total_liabilities", 600),
          "revenue": outcome("revenue", 900)}
    res = validate_cross(ok)
    assert all(c.passed for cs in res.values() for c in cs)
    bad = dict(ok, green_capex=outcome("green_capex", 300), total_liabilities=outcome("total_liabilities", 5000))
    res = validate_cross(bad)
    failed = {c.rule for cs in res.values() for c in cs if not c.passed}
    assert {"green_capex_le_capex", "liabilities_le_assets"} <= failed


def test_compare_outcomes():
    D = Decimal
    assert ev.compare(D(100), True, D(100), "found") == ev.CORRECT
    assert ev.compare(D(100), True, D("100.01"), "found", 0.001) == ev.CORRECT
    assert ev.compare(D(100), True, D(105), "found") == ev.INCORRECT
    assert ev.compare(D(100), True, None, "not_found") == ev.MISSED
    assert ev.compare(D(100), True, None, "ambiguous") == ev.AMBIGUOUS_ABSTAIN
    assert ev.compare(None, False, None, "not_found") == ev.CORRECT_ABSENT
    assert ev.compare(None, False, D(5), "found") == ev.FALSE_POSITIVE


def test_aggregate_metrics():
    rows = [
        {"outcome": ev.CORRECT, "spec_key": "a", "company": "X", "predicted_found": True, "grounded": True, "confidence": 0.9},
        {"outcome": ev.INCORRECT, "spec_key": "a", "company": "X", "predicted_found": True, "grounded": True, "confidence": 0.8},
        {"outcome": ev.CORRECT_ABSENT, "spec_key": "b", "company": "Y"},
        {"outcome": ev.MISSED, "spec_key": "b", "company": "Y"},
    ]
    m = ev.aggregate(rows)
    assert m["overall"]["total"] == 4 and m["overall"]["accuracy"] == 0.5
    assert set(m["by_specification"]) == {"a", "b"} and set(m["by_company"]) == {"X", "Y"}
    assert m["overall"]["precision"] == 0.5 and m["overall"]["recall"] == 0.3333
