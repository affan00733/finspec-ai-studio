"""Default business specifications (metric definitions).

These definitions drive both deterministic extraction (aliases / exclusions)
and prompt generation. They are seeded into ``BusinessSpecification`` rows and
can be edited through the API; the engine always works from the DB copies when
running inside Django.
"""
from __future__ import annotations

from .types import SpecDef

REVENUE_FAMILY = ("revenue", "net_sales", "turnover", "operating_revenue")

DEFAULT_SPECS: list[dict] = [
    {
        "key": "revenue", "name": "Revenue", "category": "financial", "unit_type": "currency",
        "sign_policy": "as_reported",
        "description": "Total revenue for the fiscal year, reported under the line item named 'Revenue'.",
        "aliases": ["Revenue", "Revenues", "Total revenue", "Total revenues"],
        "exclude_terms": ["segment", "deferred"],
        "rules": {"non_negative": True},
    },
    {
        "key": "net_sales", "name": "Net Sales", "category": "financial", "unit_type": "currency",
        "sign_policy": "as_reported",
        "description": "Net sales for the fiscal year, reported under the line item named 'Net sales'.",
        "aliases": ["Net sales", "Total net sales", "Consolidated net sales"],
        "exclude_terms": ["segment", "organic", "comparable"],
        "rules": {"non_negative": True},
    },
    {
        "key": "turnover", "name": "Turnover", "category": "financial", "unit_type": "currency",
        "sign_policy": "as_reported",
        "description": "Group turnover for the fiscal year, reported under the line item named 'Turnover'.",
        "aliases": ["Turnover", "Total turnover", "Group turnover"],
        "exclude_terms": ["segment"],
        "rules": {"non_negative": True},
    },
    {
        "key": "operating_revenue", "name": "Operating Revenue", "category": "financial",
        "unit_type": "currency", "sign_policy": "as_reported",
        "description": "Operating revenue for the fiscal year, reported under 'Operating revenue'.",
        "aliases": ["Operating revenue", "Operating revenues", "Total operating revenue",
                    "Total operating revenues"],
        "exclude_terms": ["segment"],
        "rules": {"non_negative": True},
    },
    {
        "key": "operating_income", "name": "Operating Income", "category": "financial",
        "unit_type": "currency", "sign_policy": "as_reported",
        "description": "Operating income (operating profit) for the fiscal year; may be negative.",
        "aliases": ["Operating income", "Income from operations", "Operating profit",
                    "Operating income (loss)"],
        "exclude_terms": ["adjusted", "margin"],
        "rules": {},
    },
    {
        "key": "ebitda", "name": "EBITDA", "category": "financial", "unit_type": "currency",
        "sign_policy": "as_reported",
        "description": "Reported EBITDA (earnings before interest, taxes, depreciation and amortization). "
                       "Adjusted EBITDA is a different measure and must not be used.",
        "aliases": ["EBITDA", "Reported EBITDA"],
        "exclude_terms": ["adjusted", "margin"],
        "rules": {},
    },
    {
        "key": "capex", "name": "CapEx", "category": "financial", "unit_type": "currency",
        "sign_policy": "absolute",
        "description": "Total capital expenditure for the fiscal year (cash outflow, reported as a positive magnitude). "
                       "Green / taxonomy-aligned CapEx is a separate specification.",
        "aliases": ["CapEx", "Capital expenditure", "Capital expenditures", "Total capital expenditure",
                    "Purchase of property, plant and equipment",
                    "Purchases of property, plant and equipment"],
        "exclude_terms": ["green", "taxonomy", "maintenance"],
        "rules": {"non_negative": True},
    },
    {
        "key": "green_capex", "name": "Green CapEx", "category": "esg", "unit_type": "currency",
        "sign_policy": "absolute",
        "description": "Capital expenditure on environmentally sustainable / taxonomy-aligned activities.",
        "aliases": ["Green CapEx", "Green capital expenditure", "Green capital expenditures",
                    "Taxonomy-aligned CapEx", "EU taxonomy-aligned CapEx"],
        "exclude_terms": [],
        "rules": {"non_negative": True},
    },
    {
        "key": "rd_expense", "name": "R&D", "category": "financial", "unit_type": "currency",
        "sign_policy": "absolute",
        "description": "Research and development expense for the fiscal year.",
        "aliases": ["Research and development", "Research and development expense",
                    "Research and development expenses", "Research and development costs",
                    "R&D", "R&D expense", "R&D expenses"],
        "exclude_terms": ["capitalised", "capitalized"],
        "rules": {"non_negative": True},
    },
    {
        "key": "scope_1", "name": "Scope 1", "category": "esg", "unit_type": "emissions",
        "sign_policy": "absolute",
        "description": "Scope 1 (direct) greenhouse gas emissions, normalised to tonnes CO2e.",
        "aliases": ["Scope 1 emissions", "Scope 1 GHG emissions", "Scope 1 greenhouse gas emissions",
                    "Gross Scope 1 emissions", "Direct emissions (Scope 1)", "Scope 1"],
        "exclude_terms": [],
        "rules": {"non_negative": True},
    },
    {
        "key": "scope_2", "name": "Scope 2", "category": "esg", "unit_type": "emissions",
        "sign_policy": "absolute",
        "description": "Scope 2 (indirect, purchased energy) location-based emissions, normalised to tonnes CO2e. "
                       "Market-based figures must not be used.",
        "aliases": ["Scope 2 emissions", "Scope 2 emissions (location-based)", "Scope 2 GHG emissions",
                    "Scope 2 greenhouse gas emissions", "Scope 2 location-based", "Scope 2"],
        "exclude_terms": ["market-based", "market based"],
        "rules": {"non_negative": True},
    },
    {
        "key": "total_assets", "name": "Total Assets", "category": "financial", "unit_type": "currency",
        "sign_policy": "as_reported",
        "description": "Total assets at fiscal year end (balance sheet).",
        "aliases": ["Total assets"],
        "exclude_terms": [],
        "rules": {"non_negative": True},
    },
    {
        "key": "total_liabilities", "name": "Total Liabilities", "category": "financial",
        "unit_type": "currency", "sign_policy": "as_reported",
        "description": "Total liabilities at fiscal year end (balance sheet). Not 'liabilities and equity'.",
        "aliases": ["Total liabilities"],
        "exclude_terms": ["equity"],
        "rules": {"non_negative": True},
    },
]

SPEC_KEYS = [s["key"] for s in DEFAULT_SPECS]


def spec_from_dict(d: dict) -> SpecDef:
    return SpecDef(
        key=d["key"], name=d["name"], aliases=list(d.get("aliases") or []),
        category=d.get("category", "financial"), unit_type=d.get("unit_type", "currency"),
        sign_policy=d.get("sign_policy", "as_reported"),
        exclude_terms=list(d.get("exclude_terms") or []),
        description=d.get("description", ""), rules=dict(d.get("rules") or {}),
    )


def default_spec_defs() -> list[SpecDef]:
    return [spec_from_dict(d) for d in DEFAULT_SPECS]
