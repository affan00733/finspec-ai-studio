"""Validation of extraction outcomes: grounding, units, sign, plausibility and
cross-metric consistency rules."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from .numeric import parse_number
from .specs import REVENUE_FAMILY
from .types import DocContext, ExtractionOutcome, SpecDef


@dataclass
class Check:
    rule: str
    severity: str  # info | warning | error
    passed: bool
    message: str
    details: dict = field(default_factory=dict)


def _digits(s: str) -> str:
    return re.sub(r"[^\d]", "", s)


def validate_outcome(
    outcome: ExtractionOutcome,
    spec: SpecDef,
    ctx: DocContext,
    doc_text: Optional[str] = None,
) -> list[Check]:
    checks: list[Check] = []
    if outcome.status == "ambiguous":
        checks.append(Check("ambiguous_evidence", "error", False, outcome.rationale))
        return checks
    if outcome.status == "rejected":
        checks.append(Check("model_output_rejected", "error", False, outcome.rationale))
        return checks
    if outcome.status == "not_found":
        checks.append(Check("value_reported", "info", False, outcome.rationale or "No value found."))
        return checks
    c = outcome.best
    assert c is not None
    checks.append(Check("evidence_present", "error", bool(c.quote and c.chunk_id is not None),
                        "Value is backed by a quoted source passage." if c.quote else "No evidence quote."))
    grounded = _digits(c.raw_number) != "" and _digits(c.raw_number) in _digits(c.quote)
    checks.append(Check("evidence_grounded", "error", grounded,
                        "Reported number appears verbatim in the quoted evidence." if grounded
                        else f"Number '{c.raw_number}' not found in quoted evidence."))
    if doc_text is not None:
        exact = doc_text[c.start_char:c.end_char] == c.quote
        checks.append(Check("evidence_offsets", "error", exact,
                            "Evidence offsets point at the exact quote in the document." if exact
                            else "Evidence offsets do not match the document text."))
    if outcome.fiscal_year is not None:
        if c.method == "table":
            ok = bool(c.year_matched)
            checks.append(Check("fiscal_year_alignment", "warning", ok,
                                f"Value read from the {outcome.fiscal_year} column." if ok
                                else "No year header found; first value column assumed."))
        else:
            ok = bool(c.year_matched)
            checks.append(Check("fiscal_year_alignment", "info" if not ok else "info", True,
                                f"Sentence explicitly refers to {outcome.fiscal_year}." if ok
                                else "Sentence does not name a year; document fiscal year assumed."))
    stated = c.unit_source != "unknown"
    checks.append(Check("unit_stated", "warning", stated,
                        f"Unit '{c.unit_label}' stated in {c.unit_source}." if stated
                        else "No unit statement found; value assumed to be in base units."))
    if spec.unit_type == "currency":
        checks.append(Check("currency_known", "warning", bool(c.currency),
                            f"Currency {c.currency}." if c.currency else "Currency could not be determined."))
        if c.currency and ctx.currency and c.currency != ctx.currency:
            checks.append(Check("currency_matches_document", "error", False,
                                f"Currency {c.currency} differs from document currency {ctx.currency}."))
    if spec.rules.get("non_negative"):
        checks.append(Check("non_negative", "error", c.normalized >= 0,
                            "Value is non-negative." if c.normalized >= 0 else "Negative value for a non-negative metric."))
    if spec.unit_type == "currency":
        plausible = Decimal(10) ** 4 <= abs(c.normalized) <= Decimal(10) ** 13 or c.normalized == 0
    else:
        plausible = Decimal(1) <= abs(c.normalized) <= Decimal(10) ** 10 or c.normalized == 0
    checks.append(Check("magnitude_plausible", "warning", plausible,
                        "Magnitude is in a plausible range." if plausible
                        else f"Normalized value {c.normalized} is outside the plausible range."))
    conflicting = [x for x in outcome.candidates if x.role == "conflicting"]
    checks.append(Check("no_conflicting_evidence", "warning", not conflicting,
                        "No conflicting values found." if not conflicting
                        else f"{len(conflicting)} lower-reliability conflicting value(s) found."))
    n_support = len([x for x in outcome.candidates if x.role in ("primary", "supporting")])
    checks.append(Check("corroborated", "info", n_support > 1,
                        f"{n_support} independent source(s) agree." if n_support > 1 else "Single source."))
    return checks


def validate_cross(outcomes: dict[str, ExtractionOutcome]) -> dict[str, list[Check]]:
    """Cross-metric consistency rules for one document. Returns checks keyed by spec key."""
    out: dict[str, list[Check]] = {}

    def val(key: str) -> Optional[Decimal]:
        o = outcomes.get(key)
        return o.best.normalized if o and o.status == "found" and o.best else None

    def add(key: str, check: Check) -> None:
        out.setdefault(key, []).append(check)

    rev = next((val(k) for k in REVENUE_FAMILY if val(k) is not None), None)
    rules = [
        ("green_capex", "capex", "green_capex_le_capex", "error",
         "Green CapEx must not exceed total CapEx", lambda a, b: a <= b),
        ("ebitda", "operating_income", "ebitda_ge_operating_income", "warning",
         "EBITDA is normally >= operating income", lambda a, b: a >= b),
        ("total_liabilities", "total_assets", "liabilities_le_assets", "warning",
         "Total liabilities are normally <= total assets", lambda a, b: a <= b),
        ("capex", "total_assets", "capex_le_assets", "warning",
         "CapEx is normally far below total assets", lambda a, b: a <= b),
    ]
    for a_key, b_key, rule, sev, text, fn in rules:
        a, b = val(a_key), val(b_key)
        if a is None or b is None:
            continue
        ok = fn(a, b)
        msg = text + (" - satisfied." if ok else f" - violated ({a} vs {b}).")
        add(a_key, Check(rule, sev, ok, msg, {"other": b_key}))
        add(b_key, Check(rule, sev, ok, msg, {"other": a_key}))
    if rev is not None:
        for key, rule, sev in (("operating_income", "operating_income_le_revenue", "error"),
                               ("rd_expense", "rd_le_revenue", "warning"),
                               ("capex", "capex_le_revenue", "warning")):
            v = val(key)
            if v is None:
                continue
            ok = v <= rev
            add(key, Check(rule, sev, ok,
                           f"{key} <= revenue measure" + (" - satisfied." if ok else f" - violated ({v} vs {rev})."),
                           {"other": "revenue_family"}))
    currencies = {o.best.currency for k, o in outcomes.items()
                  if o.status == "found" and o.best and o.best.currency and k not in ("scope_1", "scope_2")}
    if len(currencies) > 1:
        for k, o in outcomes.items():
            if o.status == "found" and o.best and o.best.currency:
                add(k, Check("currency_consistent", "error", False, f"Multiple currencies in one document: {sorted(currencies)}"))
    return out


def summarize(checks: list[Check], status: str = "found") -> str:
    if status in ("not_found",):
        return "not_applicable"
    if any(c.severity == "error" and not c.passed for c in checks):
        return "fail"
    if any(c.severity == "warning" and not c.passed for c in checks):
        return "warn"
    return "pass"
