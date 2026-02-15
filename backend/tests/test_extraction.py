"""Deterministic extraction: correctness against gold, year/company sensitivity and 'never invent'."""
from decimal import Decimal

import pytest

from engine import extraction
from engine.specs import default_spec_defs
from engine.types import DocContext

SPECS = {s.key: s for s in default_spec_defs()}


def run_all(make_index, corpus):
    texts = {i: d["text"] for i, d in enumerate(corpus)}
    years = {i: d["fiscal_year"] for i, d in enumerate(corpus)}
    index, ctxs = make_index(texts, years)
    ex = extraction.DeterministicExtractor(index)
    out = {}
    for i, d in enumerate(corpus):
        for key, spec in SPECS.items():
            out[(d["company"], d["fiscal_year"], key)] = ex.extract(spec, i, ctxs[i])
    return out


def test_matches_gold_for_every_company_year_and_metric(make_index, corpus):
    outcomes = run_all(make_index, corpus)
    wrong = []
    for d in corpus:
        for key, expected in d["gold"].items():
            o = outcomes[(d["company"], d["fiscal_year"], key)]
            got = o.best.normalized if o.best else None
            if got != expected:
                wrong.append((d["title"], key, expected, got, o.status))
    assert not wrong, wrong[:5]
    assert len(outcomes) == 12 * 13


def test_values_change_by_company_and_year(make_index, corpus):
    out = run_all(make_index, corpus)
    for key, company in (("revenue", "Northstar Energy"), ("net_sales", "Meridian Industrial"),
                         ("turnover", "Cascade Retail"), ("operating_revenue", "Atlas Materials")):
        vals = [out[(company, y, key)].best.normalized for y in (2022, 2023, 2024)]
        assert len(set(vals)) == 3, f"{company} {key} did not change by year"
    # same spec across companies differs too
    ebitda = {c: out[(c, 2024, "ebitda")].best.normalized for c in
              ("Northstar Energy", "Meridian Industrial", "Cascade Retail", "Atlas Materials")}
    assert len(set(ebitda.values())) == 4


def test_revenue_vocabulary_is_not_substituted(make_index, corpus):
    out = run_all(make_index, corpus)
    assert out[("Northstar Energy", 2024, "revenue")].status == "found"
    for key in ("net_sales", "turnover", "operating_revenue"):
        assert out[("Northstar Energy", 2024, key)].status == "not_found"
    # Meridian reports "Net sales" only: Revenue spec must NOT pick it up.
    assert out[("Meridian Industrial", 2024, "revenue")].status == "not_found"
    assert out[("Meridian Industrial", 2024, "net_sales")].status == "found"
    assert out[("Atlas Materials", 2023, "revenue")].status == "not_found"  # "Operating revenue" != "Revenue"
    assert out[("Atlas Materials", 2023, "operating_revenue")].status == "found"
    assert out[("Cascade Retail", 2023, "turnover")].status == "found"


def test_distractors_are_ignored(make_index, corpus):
    out = run_all(make_index, corpus)
    d = next(x for x in corpus if x["company"] == "Northstar Energy" and x["fiscal_year"] == 2024)
    # Adjusted EBITDA > EBITDA: must report plain EBITDA
    o = out[("Northstar Energy", 2024, "ebitda")]
    assert o.best.normalized == d["gold"]["ebitda"]
    assert "Adjusted" not in o.best.quote.split("|")[1]
    # Scope 2 location-based, not market-based
    assert "market-based" not in out[("Northstar Energy", 2024, "scope_2")].best.quote
    # Guidance "Management expects Revenue of ..." never chosen
    rev_q = out[("Northstar Energy", 2024, "revenue")]
    assert all("expects" not in c.quote for c in rev_q.candidates)
    # Green CapEx is not CapEx and vice-versa
    capex = out[("Northstar Energy", 2024, "capex")].best.normalized
    green = out[("Northstar Energy", 2024, "green_capex")].best.normalized
    assert green < capex and capex == d["gold"]["capex"]


def test_explicitly_unreported_metrics_are_not_found(make_index, corpus):
    out = run_all(make_index, corpus)
    o = out[("Cascade Retail", 2022, "green_capex")]
    assert o.status == "not_found" and o.best is None
    assert out[("Atlas Materials", 2022, "scope_2")].status == "not_found"
    assert out[("Atlas Materials", 2022, "ebitda")].status == "not_found"  # only Adjusted EBITDA reported
    assert out[("Meridian Industrial", 2022, "rd_expense")].status == "not_found"


def test_units_are_normalized(make_index, corpus):
    out = run_all(make_index, corpus)
    n = out[("Northstar Energy", 2024, "revenue")].best
    assert n.scale == 10 ** 6 and n.currency == "USD" and n.normalized == n.value * 10 ** 6
    m = out[("Meridian Industrial", 2024, "net_sales")].best
    assert m.scale == 10 ** 3 and m.currency == "EUR"
    a = out[("Atlas Materials", 2024, "operating_revenue")].best
    assert a.scale == 10 ** 9 and a.normalized < 10 ** 11
    # emissions: kt vs t vs million t
    assert out[("Northstar Energy", 2024, "scope_1")].best.unit_label == "ktCO2e"
    assert out[("Meridian Industrial", 2024, "scope_1")].best.unit_label == "tCO2e"
    assert out[("Atlas Materials", 2024, "scope_1")].best.scale == 10 ** 6


def test_capex_outflow_in_parentheses_becomes_positive(make_index, corpus):
    out = run_all(make_index, corpus)
    o = out[("Cascade Retail", 2024, "capex")]
    assert "(" in o.best.quote and o.best.value > 0
    assert any("sign_normalized" in n for n in o.best.notes)


def test_evidence_offsets_point_to_exact_quote(make_index, corpus):
    out = run_all(make_index, corpus)
    from engine import parsing

    by_title = {(d["company"], d["fiscal_year"]): parsing.normalize_text(d["text"]) for d in corpus}
    checked = 0
    for (company, year, key), o in out.items():
        if o.best:
            text = by_title[(company, year)]
            assert text[o.best.start_char:o.best.end_char] == o.best.quote
            checked += 1
    assert checked > 100


def test_year_column_selection_not_first_column(make_index):
    text = """# Test Co Annual Report 2023

Fiscal Year 2023

All amounts are expressed in USD millions unless otherwise stated.

## Income Statement

| Line item | FY2024 | FY2023 | FY2022 |
|---|---|---|---|
| Revenue | 300.0 | 200.0 | 100.0 |
"""
    index, ctxs = make_index({0: text}, {0: 2023})
    ex = extraction.DeterministicExtractor(index)
    o = ex.extract(SPECS["revenue"], 0, ctxs[0])
    assert o.best.value == Decimal("200.0")
    o24 = ex.extract(SPECS["revenue"], 0, ctxs[0], target_year=2024)
    assert o24.best.value == Decimal("300.0")
    assert ex.extract(SPECS["revenue"], 0, ctxs[0], target_year=2019).status == "not_found"


def test_conflicting_equal_reliability_is_ambiguous_not_guessed(make_index):
    text = """# Test Co Annual Report 2024

Fiscal Year 2024

## Statement A

(USD millions)

| Line item | FY2024 |
|---|---|
| Revenue | 100.0 |

## Statement B

(USD millions)

| Line item | FY2024 |
|---|---|
| Revenue | 140.0 |
"""
    index, ctxs = make_index({0: text}, {0: 2024})
    o = extraction.DeterministicExtractor(index).extract(SPECS["revenue"], 0, ctxs[0])
    assert o.status == "ambiguous" and o.best is None and len(o.candidates) == 2


def test_narrative_only_and_table_agree_raises_confidence(make_index):
    base = """# Test Co Annual Report 2024

Fiscal Year 2024

All amounts are expressed in USD millions.

## MD&A

Revenue increased 10.0% to $110.0 million in fiscal 2024, from $100.0 million in 2023.

## Income Statement

| Line item | FY2024 | FY2023 |
|---|---|---|
| Revenue | 110.0 | 100.0 |
"""
    narrative_only = base.split("## Income Statement")[0]
    idx1, c1 = make_index({0: base}, {0: 2024})
    idx2, c2 = make_index({0: narrative_only}, {0: 2024})
    both = extraction.DeterministicExtractor(idx1).extract(SPECS["revenue"], 0, c1[0])
    only = extraction.DeterministicExtractor(idx2).extract(SPECS["revenue"], 0, c2[0])
    assert both.best.normalized == only.best.normalized == Decimal("110000000.0")
    assert both.confidence > only.confidence
    assert only.best.method == "narrative" and both.best.method == "table"


def test_prior_year_and_guidance_sentences_are_skipped(make_index):
    text = """# Test Co Annual Report 2024

Fiscal Year 2024

## MD&A

In fiscal 2023, Revenue was $90.0 million.

Management expects Revenue of $120.0 million in fiscal 2025.
"""
    index, ctxs = make_index({0: text}, {0: 2024})
    assert extraction.DeterministicExtractor(index).extract(SPECS["revenue"], 0, ctxs[0]).status == "not_found"


def test_empty_document_never_invents(make_index):
    index, ctxs = make_index({0: "# Empty\n\nNothing financial here.\n"}, {0: 2024})
    ex = extraction.DeterministicExtractor(index)
    for spec in SPECS.values():
        o = ex.extract(spec, 0, ctxs[0])
        assert o.status == "not_found" and o.best is None and not o.candidates
