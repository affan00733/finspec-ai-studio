"""Evaluation of extraction output against gold cases."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Optional

CORRECT = "correct"
CORRECT_ABSENT = "correct_absent"
INCORRECT = "incorrect_value"
MISSED = "missed"
FALSE_POSITIVE = "false_positive"
AMBIGUOUS_ABSTAIN = "abstained"  # model abstained (ambiguous/rejected) on an answerable case


def compare(
    expected: Optional[Decimal],
    expect_found: bool,
    predicted: Optional[Decimal],
    status: str,
    tolerance: float = 0.0005,
) -> str:
    """Classify one prediction. ``tolerance`` is a relative tolerance."""
    has_pred = predicted is not None and status == "found"
    if not expect_found:
        return FALSE_POSITIVE if has_pred else CORRECT_ABSENT
    if not has_pred:
        return AMBIGUOUS_ABSTAIN if status in ("ambiguous", "rejected") else MISSED
    if expected is None:
        return INCORRECT
    if expected == predicted:
        return CORRECT
    base = max(abs(expected), abs(predicted))
    if base > 0 and abs(expected - predicted) / base <= Decimal(str(tolerance)):
        return CORRECT
    return INCORRECT


def _prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if (tp + fp) else 1.0
    r = tp / (tp + fn) if (tp + fn) else 1.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f1, 4)}


def aggregate(rows: list[dict]) -> dict:
    """``rows``: dicts with ``outcome``, ``spec_key``, ``company`` and optional ``grounded``/``confidence``."""

    def block(subset: list[dict]) -> dict:
        n = len(subset)
        cnt = defaultdict(int)
        for r in subset:
            cnt[r["outcome"]] += 1
        tp = cnt[CORRECT]
        fp = cnt[INCORRECT] + cnt[FALSE_POSITIVE]
        fn = cnt[MISSED] + cnt[AMBIGUOUS_ABSTAIN] + cnt[INCORRECT]
        correct_total = cnt[CORRECT] + cnt[CORRECT_ABSENT]
        out = {
            "total": n,
            "correct": cnt[CORRECT],
            "correct_absent": cnt[CORRECT_ABSENT],
            "incorrect_value": cnt[INCORRECT],
            "missed": cnt[MISSED],
            "false_positive": cnt[FALSE_POSITIVE],
            "abstained": cnt[AMBIGUOUS_ABSTAIN],
            "accuracy": round(correct_total / n, 4) if n else 0.0,
        }
        out.update(_prf(tp, fp, fn))
        found = [r for r in subset if r.get("predicted_found")]
        if found:
            out["grounded_rate"] = round(sum(1 for r in found if r.get("grounded", True)) / len(found), 4)
            out["mean_confidence"] = round(sum(r.get("confidence", 0.0) for r in found) / len(found), 4)
        return out

    overall = block(rows)
    by_spec: dict[str, list[dict]] = defaultdict(list)
    by_company: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_spec[r["spec_key"]].append(r)
        by_company[r.get("company", "")].append(r)
    return {
        "overall": overall,
        "by_specification": {k: block(v) for k, v in sorted(by_spec.items())},
        "by_company": {k: block(v) for k, v in sorted(by_company.items())},
    }
