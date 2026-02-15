"""Fictional demo corpus generator.

Four fictional companies with *different* reporting vocabularies, units and
table layouts, over FY2022-FY2024. Every number in a document is derived from a
deterministic per-company/per-year table, so documents differ by company and
year, and the gold values used for evaluation are known exactly.

All companies, figures and events are fictional.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

YEARS = (2022, 2023, 2024)
FIRST_DATA_YEAR = 2021  # prior-year column for the first report

D = Decimal


@dataclass
class CompanyProfile:
    name: str
    ticker: str
    sector: str
    description: str
    currency: str
    symbol: str
    revenue_key: str
    revenue_label: str
    unit_word: str  # millions | thousands | billions
    unit_mult: Decimal
    decimals: int
    base_revenue_m: float  # revenue in millions of currency for 2021
    layout: str  # pipe | space
    col_order: str  # desc | asc
    note_col: bool
    change_col: bool
    capex_negative: bool
    scope_style: str  # row_unit | caption | narrative | table_million
    scope_mult: Decimal  # multiplier from display unit to tCO2e
    scope_unit: str
    scope_decimals: int
    base_scope1_t: float
    base_scope2_t: float
    # (year, key) pairs that are legitimately not reported
    not_reported: tuple = ()
    adjusted_only_ebitda_years: tuple = ()


PROFILES: list[CompanyProfile] = [
    CompanyProfile(
        name="Northstar Energy", ticker="NSTR", sector="Energy & Utilities",
        description="Fictional integrated power producer with gas, wind and solar generation.",
        currency="USD", symbol="$", revenue_key="revenue", revenue_label="Revenue",
        unit_word="millions", unit_mult=D(10) ** 6, decimals=1, base_revenue_m=8200.0,
        layout="pipe", col_order="desc", note_col=False, change_col=True, capex_negative=False,
        scope_style="row_unit", scope_mult=D(1000), scope_unit="ktCO2e", scope_decimals=1,
        base_scope1_t=4_200_000, base_scope2_t=610_000,
        not_reported=((2022, "rd_expense"),),
    ),
    CompanyProfile(
        name="Meridian Industrial", ticker="MRDN", sector="Industrial Manufacturing",
        description="Fictional European maker of precision industrial components.",
        currency="EUR", symbol="€", revenue_key="net_sales", revenue_label="Net sales",
        unit_word="thousands", unit_mult=D(10) ** 3, decimals=0, base_revenue_m=3100.0,
        layout="pipe", col_order="desc", note_col=False, change_col=False, capex_negative=False,
        scope_style="caption", scope_mult=D(1), scope_unit="tCO2e", scope_decimals=0,
        base_scope1_t=1_250_000, base_scope2_t=480_000,
        not_reported=((2022, "rd_expense"), (2023, "green_capex")),
    ),
    CompanyProfile(
        name="Cascade Retail", ticker="CSCD", sector="Consumer Retail",
        description="Fictional multi-format retailer operating across the United Kingdom.",
        currency="GBP", symbol="£", revenue_key="turnover", revenue_label="Turnover",
        unit_word="millions", unit_mult=D(10) ** 6, decimals=1, base_revenue_m=5600.0,
        layout="pipe", col_order="desc", note_col=True, change_col=False, capex_negative=True,
        scope_style="narrative", scope_mult=D(1000), scope_unit="ktCO2e", scope_decimals=1,
        base_scope1_t=98_000, base_scope2_t=143_000,
        not_reported=((2022, "green_capex"), (2022, "rd_expense"), (2023, "rd_expense"), (2024, "rd_expense")),
    ),
    CompanyProfile(
        name="Atlas Materials", ticker="ATLS", sector="Basic Materials",
        description="Fictional producer of cement, aggregates and specialty chemicals.",
        currency="USD", symbol="$", revenue_key="operating_revenue", revenue_label="Operating revenue",
        unit_word="billions", unit_mult=D(10) ** 9, decimals=3, base_revenue_m=4800.0,
        layout="space", col_order="asc", note_col=False, change_col=False, capex_negative=False,
        scope_style="table_million", scope_mult=D(10) ** 6, scope_unit="million tCO2e", scope_decimals=3,
        base_scope1_t=6_400_000, base_scope2_t=1_900_000,
        not_reported=((2022, "scope_2"),),
        adjusted_only_ebitda_years=(2022,),
    ),
]
PROFILE_BY_NAME = {p.name: p for p in PROFILES}


def _rng(*parts) -> random.Random:
    return random.Random(":".join(str(p) for p in parts))


def _q(value: float, decimals: int) -> Decimal:
    return D(repr(value)).quantize(D(1).scaleb(-decimals), rounding=ROUND_HALF_UP)


def yearly_values(p: CompanyProfile, year: int) -> dict:
    """All display-unit values for one company-year (Decimal or None)."""
    rev_m = p.base_revenue_m
    for y in range(FIRST_DATA_YEAR + 1, year + 1):
        rev_m *= 1 + _rng(p.name, y, "growth").uniform(-0.025, 0.115)
    def r(key: str, lo: float, hi: float) -> float:
        # Company-specific structural ratio with modest year-to-year drift.
        center = _rng(p.name, "structure", key).uniform(lo, hi)
        return center * (1 + _rng(p.name, year, key).uniform(-0.06, 0.06))
    to_unit = lambda m: m * 1e6 / float(p.unit_mult)  # noqa: E731  (millions -> display unit)
    dec = p.decimals
    op_inc_m = rev_m * r("op", 0.07, 0.19)
    da_m = rev_m * r("da", 0.045, 0.085)
    capex_m = rev_m * r("capex", 0.055, 0.115)
    green_m = capex_m * r("green", 0.18, 0.46)
    rd_m = rev_m * r("rd", 0.012, 0.041)
    assets_m = rev_m * r("assets", 1.55, 2.35)
    liab_m = assets_m * r("liab", 0.48, 0.66)
    seg = [r("seg1", 0.22, 0.34), r("seg2", 0.28, 0.4)]
    vals: dict = {
        "revenue_value": _q(to_unit(rev_m), dec),
        "operating_income": _q(to_unit(op_inc_m), dec),
        "ebitda": _q(to_unit(op_inc_m + da_m), dec),
        "adjusted_ebitda": _q(to_unit(op_inc_m + da_m + rev_m * r("adj", 0.006, 0.02)), dec),
        "depreciation": _q(to_unit(da_m), dec),
        "capex": _q(to_unit(capex_m), dec),
        "green_capex": _q(to_unit(green_m), dec),
        "rd_expense": _q(to_unit(rd_m), dec),
        "total_assets": _q(to_unit(assets_m), dec),
        "total_liabilities": _q(to_unit(liab_m), dec),
        "seg1": _q(to_unit(rev_m * seg[0]), dec),
        "seg2": _q(to_unit(rev_m * seg[1]), dec),
    }
    sd = p.scope_decimals
    scale_t = float(p.scope_mult)
    drift1 = _rng(p.name, year, "s1").uniform(0.88, 1.04) * (0.985 ** (year - FIRST_DATA_YEAR))
    drift2 = _rng(p.name, year, "s2").uniform(0.85, 1.05) * (0.975 ** (year - FIRST_DATA_YEAR))
    vals["scope_1"] = _q(p.base_scope1_t * drift1 / scale_t, sd)
    vals["scope_2"] = _q(p.base_scope2_t * drift2 / scale_t, sd)
    vals["scope_2_market"] = _q(float(vals["scope_2"]) * _rng(p.name, year, "mkt").uniform(0.55, 0.9), sd)
    for (y, key) in p.not_reported:
        if y == year:
            vals[key] = None
    if year in p.adjusted_only_ebitda_years:
        vals["ebitda"] = None
    vals[p.revenue_key] = vals["revenue_value"]
    return vals


def gold_values(p: CompanyProfile, year: int) -> dict:
    """Expected normalized value (base currency units / tCO2e) per spec key, or None."""
    v = yearly_values(p, year)
    out: dict = {}
    for key in ("revenue", "net_sales", "turnover", "operating_revenue"):
        out[key] = v["revenue_value"] * p.unit_mult if key == p.revenue_key else None
    for key in ("operating_income", "ebitda", "capex", "green_capex", "rd_expense", "total_assets",
                "total_liabilities"):
        out[key] = v[key] * p.unit_mult if v.get(key) is not None else None
    out["scope_1"] = v["scope_1"] * p.scope_mult if v.get("scope_1") is not None else None
    out["scope_2"] = v["scope_2"] * p.scope_mult if v.get("scope_2") is not None else None
    return out


# --------------------------------------------------------------------------- rendering

def _fmt(v: Optional[Decimal], dec: int, negative: bool = False, missing: str = "n/a") -> str:
    if v is None:
        return missing
    s = f"{v:,.{dec}f}"
    return f"({s})" if negative else s


def _table(p: CompanyProfile, header: list[str], rows: list[list[str]]) -> str:
    if p.layout == "pipe":
        lines = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
        lines += ["| " + " | ".join(r) + " |" for r in rows]
        return "\n".join(lines)
    all_rows = [header] + rows
    widths = [max(len(r[i]) for r in all_rows) for i in range(len(header))]
    out = []
    for r in all_rows:
        cells = [r[0].ljust(widths[0])] + [c.rjust(widths[i + 1]) for i, c in enumerate(r[1:])]
        out.append("    ".join(cells))
    return "\n".join(out)


def _years_for_cols(p: CompanyProfile, year: int, n: int) -> list[int]:
    ys = [year - i for i in range(n) if year - i >= FIRST_DATA_YEAR]
    return ys if p.col_order == "desc" else list(reversed(ys))


def render_report(p: CompanyProfile, year: int) -> str:
    n_cols = 3 if p.name == "Meridian Industrial" else 2
    ys = _years_for_cols(p, year, n_cols)
    vy = {y: yearly_values(p, y) for y in ys}
    cur = vy[year]
    prev = yearly_values(p, year - 1)
    dec = p.decimals
    unit = f"{p.currency} {p.unit_word}"
    sym = p.symbol

    def row(label: str, key: str, negative: bool = False, with_change: bool = True) -> list[str]:
        cells = [label]
        if p.note_col:
            cells.append("")
        for y in ys:
            cells.append(_fmt(vy[y].get(key), dec, negative=negative and vy[y].get(key) is not None))
        if p.change_col:
            a, b = cur.get(key), prev.get(key)
            cells.append(f"{(a - b) / b * 100:+.1f}%" if (with_change and a is not None and b) else "n/a")
        return cells

    def header(first: str) -> list[str]:
        h = [first]
        if p.note_col:
            h.append("Note")
        h += [f"FY{y}" for y in ys]
        if p.change_col:
            h.append("Change %")
        return h

    def with_note(r: list[str], note: str) -> list[str]:
        if p.note_col:
            r[1] = note
        return r

    rev_label = p.revenue_label
    rev_now, rev_prev = cur["revenue_value"], prev["revenue_value"]
    # Narrative figures are always stated in millions (or billions for Atlas) with one inline unit.
    if p.unit_word == "billions":
        nar = lambda v: f"{sym}{v:,.{dec}f} billion"  # noqa: E731
    elif p.unit_word == "thousands":
        nar = lambda v: f"{sym}{v / 1000:,.1f} million"  # noqa: E731
    else:
        nar = lambda v: f"{sym}{v:,.{dec}f} million"  # noqa: E731
    pct = (rev_now - rev_prev) / rev_prev * 100
    verb = "increased" if pct >= 0 else "decreased"
    op_margin = cur["operating_income"] / cur["revenue_value"] * 100

    parts: list[str] = []
    parts.append(f"# {p.name} Annual Report {year}")
    parts.append(f"Fiscal Year {year} - {p.name} ({p.ticker}) - Sector: {p.sector}")
    parts.append(f"{p.description} All companies, people and figures in this document are fictional and "
                 f"were generated for software demonstration.")
    parts.append(f"All amounts are expressed in {unit} unless otherwise stated. "
                 f"The fiscal year ended 31 December {year}.")

    # ---- MD&A
    parts.append("## Management's Discussion and Analysis")
    mdna = [
        f"{rev_label} {verb} {abs(pct):.1f}% to {nar(rev_now)} in fiscal {year}, from {nar(rev_prev)} in {year - 1}.",
        f"Operating income margin was {op_margin:.1f}% for fiscal {year}, reflecting cost discipline across the group.",
        f"Segment {rev_label.lower()} from Division A was {nar(cur['seg1'])} and Division B contributed "
        f"{nar(cur['seg2'])} in fiscal {year}.",
        f"In fiscal {year - 1}, {rev_label} was {nar(rev_prev)}, which provides the comparison base for this year.",
        f"Management expects {rev_label} of {nar(rev_now * D('1.04'))} in fiscal {year + 1}; this guidance is a "
        f"forward-looking statement and not a reported result.",
    ]
    if cur["adjusted_ebitda"] is not None:
        mdna.append(f"Adjusted EBITDA was {nar(cur['adjusted_ebitda'])} in fiscal {year}; adjusted measures exclude "
                    f"restructuring and one-off items and are not comparable with reported EBITDA.")
    if cur.get("green_capex") is not None:
        mdna.append(f"Green capital expenditure was {nar(cur['green_capex'])} in fiscal {year}, directed to "
                    f"low-carbon assets and efficiency projects.")
    else:
        mdna.append(f"Green capital expenditure was not separately disclosed for fiscal {year}.")
    parts.append("\n\n".join(mdna))

    # ---- Income statement
    parts.append("## Consolidated Income Statement")
    inc_rows = [
        row(rev_label, p.revenue_key),
        row("Segment revenue (Division A)", "seg1"),
        row("Segment revenue (Division B)", "seg2"),
        row("Operating income", "operating_income"),
        row("Research and development", "rd_expense"),
    ]
    with_note(inc_rows[0], "3")
    with_note(inc_rows[3], "4")
    parts.append(f"Table 1: Consolidated income statement ({unit})")
    parts.append(_table(p, header("Line item"), inc_rows))

    # ---- EBITDA reconciliation
    parts.append("## EBITDA Reconciliation")
    rec_rows = [row("Operating income", "operating_income"), row("Depreciation and amortization", "depreciation")]
    if cur["ebitda"] is not None or prev["ebitda"] is not None:
        rec_rows.append(row("EBITDA", "ebitda"))
    rec_rows.append(row("Adjusted EBITDA", "adjusted_ebitda"))
    parts.append(f"Table 2: EBITDA reconciliation ({unit})")
    parts.append(_table(p, header("Measure"), rec_rows))

    # ---- Balance sheet
    parts.append("## Consolidated Balance Sheet")
    bs_rows = [row("Total assets", "total_assets"), row("Total liabilities", "total_liabilities")]
    eq_row = ["Total liabilities and equity"] + ([""] if p.note_col else [])
    eq_row += [_fmt(vy[y]["total_assets"], dec) for y in ys] + (["n/a"] if p.change_col else [])
    bs_rows.append(eq_row)
    parts.append(f"Table 3: Consolidated balance sheet ({unit})")
    parts.append(_table(p, header("Line item"), bs_rows))

    # ---- Cash flow
    parts.append("## Cash Flow and Capital Expenditure")
    if p.capex_negative:
        cf_rows = [row("Purchase of property, plant and equipment", "capex", negative=True),
                   row("Green capital expenditure", "green_capex", negative=True)]
    else:
        cf_rows = [row("Capital expenditure", "capex"), row("Green capital expenditure", "green_capex")]
    parts.append(f"Table 4: Capital expenditure ({unit})")
    parts.append(_table(p, header("Cash flow item"), cf_rows))
    if p.capex_negative:
        parts.append("Capital expenditure is shown as a cash outflow, in parentheses.")

    # ---- Sustainability
    parts.append("## Sustainability and Emissions")
    sd = p.scope_decimals
    sc1, sc2 = cur["scope_1"], cur["scope_2"]
    if p.scope_style == "row_unit":
        parts.append(f"Table 5: Greenhouse gas emissions (location-based)")
        rows = [row(f"Scope 1 emissions ({p.scope_unit})", "scope_1", with_change=False),
                row(f"Scope 2 emissions (location-based) ({p.scope_unit})", "scope_2", with_change=False),
                row(f"Scope 2 emissions (market-based) ({p.scope_unit})", "scope_2_market", with_change=False)]
        parts.append(_table(p, header("Metric"), rows))
    elif p.scope_style in ("caption", "table_million"):
        parts.append(f"Table 5: Greenhouse gas emissions ({p.scope_unit})")
        rows = [row("Scope 1 emissions", "scope_1"), row("Scope 2 emissions (location-based)", "scope_2"),
                row("Scope 2 emissions (market-based)", "scope_2_market")]
        parts.append(_table(p, header("Metric"), rows))
    else:  # narrative
        sc2_txt = (f"Scope 2 emissions (location-based) were {sc2:,.{sd}f} {p.scope_unit}"
                   if sc2 is not None else "Scope 2 emissions (location-based) were not reported")
        parts.append(f"In fiscal {year}, Scope 1 emissions were {sc1:,.{sd}f} {p.scope_unit}. {sc2_txt}. "
                     f"Scope 2 emissions (market-based) were {cur['scope_2_market']:,.{sd}f} {p.scope_unit}, "
                     f"which are not used for regulatory comparison.")
        parts.append(f"In fiscal {year - 1}, Scope 1 emissions were {prev['scope_1']:,.{sd}f} {p.scope_unit}.")
    parts.append("## Risk Factors")
    parts.append(f"Changes in commodity prices, regulation and demand could affect {rev_label.lower()} and "
                 f"profitability. See Table 1 and Table 2 for the reported figures.")
    return "\n\n".join(parts) + "\n"


def build_corpus() -> list[dict]:
    """Return one dict per demo document (company profile, year, text, gold)."""
    docs = []
    for p in PROFILES:
        for y in YEARS:
            docs.append({
                "company": p.name, "fiscal_year": y,
                "title": f"{p.name} Annual Report {y}",
                "filename": f"{p.ticker.lower()}_annual_report_{y}.md",
                "text": render_report(p, y),
                "gold": gold_values(p, y),
            })
    return docs
