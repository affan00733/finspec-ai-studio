"""Plain data containers shared across the engine (no Django dependency)."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional


@dataclass
class ChunkRef:
    """A retrievable slice of a document.

    ``start_char`` / ``end_char`` are offsets into the full document text so
    that evidence can always be traced back to the source.
    """

    id: Any
    document_id: Any
    index: int
    text: str
    start_char: int = 0
    end_char: int = 0
    chunk_type: str = "text"
    heading: str = ""
    meta: dict = field(default_factory=dict)


@dataclass
class DocContext:
    """Document-level context used for year and unit resolution."""

    fiscal_year: Optional[int] = None
    currency: Optional[str] = None
    scale: Optional[Decimal] = None
    emission_unit: Optional[tuple] = None  # (multiplier, label)


@dataclass
class SpecDef:
    key: str
    name: str
    aliases: list[str]
    category: str = "financial"
    unit_type: str = "currency"  # currency | emissions
    sign_policy: str = "as_reported"  # as_reported | absolute
    exclude_terms: list[str] = field(default_factory=list)
    description: str = ""
    rules: dict = field(default_factory=dict)


@dataclass
class Candidate:
    """A potential value for a specification found in a chunk."""

    spec_key: str
    method: str  # table | narrative | llm
    label: str
    raw_number: str
    value: Decimal  # as reported (before scale)
    scale: Decimal
    currency: Optional[str]
    unit_label: str
    normalized: Decimal
    granularity: Decimal
    chunk_id: Any
    document_id: Any
    quote: str
    start_char: int
    end_char: int
    score: float
    year: Optional[int] = None
    year_matched: Optional[bool] = None
    unit_source: str = "unknown"
    notes: list[str] = field(default_factory=list)
    role: str = "primary"  # primary | supporting | conflicting
    context: str = ""  # table header / caption / section that frames the quote


@dataclass
class ExtractionOutcome:
    spec_key: str
    status: str  # found | not_found | ambiguous | rejected
    fiscal_year: Optional[int]
    best: Optional[Candidate] = None
    candidates: list[Candidate] = field(default_factory=list)
    confidence: float = 0.0
    rationale: str = ""
    retrieved_chunk_ids: list = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
