"""Prompt templates, rendering and structured-output schemas."""
from __future__ import annotations

import html
import re
from typing import Iterable, Optional

from .retrieval import Hit
from .types import SpecDef


class PromptError(Exception):
    pass


EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "value": {"type": ["string", "null"], "description": "Number exactly as written in the quote."},
        "currency": {"type": ["string", "null"], "description": "ISO code, e.g. USD."},
        "unit_scale": {"type": ["string", "null"], "enum": ["units", "thousands", "millions", "billions", None]},
        "unit_label": {"type": ["string", "null"], "description": "Emissions unit such as tCO2e, ktCO2e."},
        "fiscal_year": {"type": ["integer", "null"]},
        "chunk_id": {"type": ["string", "null"]},
        "quote": {"type": ["string", "null"], "description": "Verbatim source text containing the value."},
        "confidence": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["found", "value", "currency", "unit_scale", "unit_label", "fiscal_year", "chunk_id",
                 "quote", "confidence", "rationale"],
    "additionalProperties": False,
}

CHAT_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "citations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["answer", "citations"],
    "additionalProperties": False,
}

EXTRACTION_SYSTEM_V1 = (
    "You extract one financial or sustainability metric from excerpts of a company annual report.\n"
    "Rules:\n"
    "1. Use ONLY the excerpts provided. Never use outside knowledge, estimates or calculations.\n"
    "2. If the metric is not explicitly reported for the target fiscal year, return found=false.\n"
    "3. Match the metric by its reported line-item name; do not substitute similarly named measures "
    "(for example 'Net sales' is not 'Revenue').\n"
    "4. Ignore adjusted, segment, pro-forma, prior-year and forward-looking figures.\n"
    "5. Copy the number exactly as written and quote the verbatim passage that contains it.\n"
    "6. Report the unit scale and currency exactly as stated in the document."
)

EXTRACTION_SYSTEM_V2 = EXTRACTION_SYSTEM_V1 + (
    "\n7. When two excerpts disagree and you cannot tell which is authoritative, return found=false and "
    "explain the conflict in the rationale.\n"
    "8. Respond with JSON matching the provided schema and nothing else."
)

EXTRACTION_USER = (
    "{{task_tag}}\n"
    "Company: {{company}}\n"
    "Target fiscal year: {{fiscal_year}}\n"
    "Metric: {{spec_name}}\n"
    "Definition: {{spec_description}}\n"
    "Accepted line-item names: {{aliases}}\n"
    "Do not use: {{exclusions}}\n"
    "Unit guidance: {{unit_guidance}}\n\n"
    "Excerpts:\n{{context}}\n\n"
    "Return the value reported for the target fiscal year, or found=false."
)

CHAT_SYSTEM_V1 = (
    "You are a financial document assistant. Answer using ONLY the provided excerpts. "
    "Cite excerpts by chunk id. If the excerpts do not contain the answer, say so plainly. "
    "Never invent figures."
)
CHAT_USER = "Question: {{question}}\n\nExcerpts:\n{{context}}\n"

DEFAULT_PROMPTS = [
    {
        "name": "Metric Extraction", "kind": "extraction",
        "description": "Evidence-grounded single-metric extraction from retrieved excerpts.",
        "versions": [
            {"version": 1, "system_prompt": EXTRACTION_SYSTEM_V1, "user_template": EXTRACTION_USER,
             "output_schema": EXTRACTION_SCHEMA, "notes": "Initial baseline.", "is_active": False},
            {"version": 2, "system_prompt": EXTRACTION_SYSTEM_V2, "user_template": EXTRACTION_USER,
             "output_schema": EXTRACTION_SCHEMA, "notes": "Adds conflict handling and strict JSON.", "is_active": True},
        ],
    },
    {
        "name": "Document Chat", "kind": "chat",
        "description": "Grounded question answering over retrieved excerpts.",
        "versions": [
            {"version": 1, "system_prompt": CHAT_SYSTEM_V1, "user_template": CHAT_USER,
             "output_schema": CHAT_SCHEMA, "notes": "Initial baseline.", "is_active": True},
        ],
    },
]

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def render_template(template: str, variables: dict) -> str:
    missing = sorted({m for m in _VAR_RE.findall(template) if m not in variables})
    if missing:
        raise PromptError(f"Template references undefined variables: {', '.join(missing)}")
    return _VAR_RE.sub(lambda m: str(variables[m.group(1)]), template)


def template_variables(template: str) -> list[str]:
    return sorted(set(_VAR_RE.findall(template)))


def _attr(v) -> str:
    return html.escape(str(v), quote=True)


def task_tag(spec: SpecDef, fiscal_year: Optional[int]) -> str:
    return (
        f'<task spec_key="{_attr(spec.key)}" spec_name="{_attr(spec.name)}" fiscal_year="{_attr(fiscal_year or "")}" '
        f'unit_type="{_attr(spec.unit_type)}" sign_policy="{_attr(spec.sign_policy)}" '
        f'aliases="{_attr("|".join(spec.aliases))}" exclude="{_attr("|".join(spec.exclude_terms))}"/>'
    )


def build_context(hits: Iterable[Hit], max_chars_per_chunk: int = 4000) -> str:
    blocks = []
    for h in hits:
        c = h.chunk
        text = c.text if len(c.text) <= max_chars_per_chunk else c.text[:max_chars_per_chunk]
        blocks.append(
            f'<chunk id="{_attr(c.id)}" document="{_attr(c.document_id)}" start="{c.start_char}" '
            f'type="{_attr(c.chunk_type)}" section="{_attr(c.heading)}">\n{text}\n</chunk>'
        )
    return "\n".join(blocks) if blocks else "(no excerpts retrieved)"


def unit_guidance(spec: SpecDef) -> str:
    if spec.unit_type == "emissions":
        return "Report the emissions unit exactly as stated (tCO2e, ktCO2e, million tCO2e). Normalise nothing."
    return "Report currency and scale exactly as stated (thousands, millions, billions); do not convert."


def spec_variables(spec: SpecDef, company: str, fiscal_year: Optional[int], context: str) -> dict:
    return {
        "task_tag": task_tag(spec, fiscal_year),
        "company": company or "(unspecified)",
        "fiscal_year": fiscal_year or "(unspecified)",
        "spec_name": spec.name,
        "spec_description": spec.description or spec.name,
        "aliases": "; ".join(spec.aliases),
        "exclusions": "; ".join(spec.exclude_terms) or "none",
        "unit_guidance": unit_guidance(spec),
        "context": context,
    }


def generate_extraction_prompt(
    spec: SpecDef, company: str, fiscal_year: Optional[int], hits: Iterable[Hit],
    system_prompt: str = EXTRACTION_SYSTEM_V2, user_template: str = EXTRACTION_USER,
    output_schema: Optional[dict] = None,
) -> dict:
    variables = spec_variables(spec, company, fiscal_year, build_context(hits))
    return {
        "system": system_prompt,
        "user": render_template(user_template, variables),
        "schema": output_schema or EXTRACTION_SCHEMA,
        "variables": {k: v for k, v in variables.items() if k != "context"},
    }
