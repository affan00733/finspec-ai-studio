"""Document parsing: bytes/HTML/PDF/text -> normalized text, sections, context."""
from __future__ import annotations

import io
import re
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from .numeric import detect_currency, detect_emission_unit, detect_scale
from .types import DocContext


class ParseError(Exception):
    pass


@dataclass
class ParsedDocument:
    text: str
    pages: list[tuple[int, int]] = field(default_factory=list)  # (start, end) offsets per page
    metadata: dict = field(default_factory=dict)


@dataclass
class Section:
    heading: str
    level: int
    start: int
    end: int
    section_type: str = "other"


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip("\n") + "\n"


def html_to_text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    lines: list[str] = []

    def emit_table(table) -> None:
        rows = []
        for tr in table.find_all("tr"):
            cells = [re.sub(r"\s+", " ", c.get_text(" ", strip=True)) for c in tr.find_all(["th", "td"])]
            if any(cells):
                rows.append("| " + " | ".join(cells) + " |")
        caption = table.find("caption")
        if caption:
            lines.append(caption.get_text(" ", strip=True))
        lines.extend(rows)
        lines.append("")

    body = soup.body or soup
    for el in body.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "table", "pre"]):
        if el.name == "table":
            if el.find_parent("table") is None:
                emit_table(el)
            continue
        if el.find_parent("table") is not None:
            continue
        txt = re.sub(r"[ \t]+", " ", el.get_text(" ", strip=True) if el.name != "pre" else el.get_text())
        if not txt:
            continue
        if el.name.startswith("h") and len(el.name) == 2:
            lines.append("")
            lines.append("#" * int(el.name[1]) + " " + txt)
            lines.append("")
        elif el.name == "li":
            lines.append("- " + txt)
        else:
            lines.append(txt)
            lines.append("")
    return "\n".join(lines)


def pdf_to_text(content: bytes) -> ParsedDocument:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
    except Exception as exc:  # pragma: no cover - depends on malformed input
        raise ParseError(f"Could not read PDF: {exc}") from exc
    parts: list[str] = []
    pages: list[tuple[int, int]] = []
    cursor = 0
    for page in reader.pages:
        try:
            txt = page.extract_text() or ""
        except Exception:  # pragma: no cover
            txt = ""
        txt = txt.replace("\r\n", "\n").replace("\r", "\n")
        start = cursor
        parts.append(txt)
        cursor += len(txt)
        pages.append((start, cursor))
        parts.append("\n\n")
        cursor += 2
    text = "".join(parts)
    if not text.strip():
        raise ParseError("PDF contains no extractable text (scanned PDFs require OCR, which is not enabled).")
    return ParsedDocument(text=text, pages=pages, metadata={"page_count": len(pages), "format": "pdf"})


def parse_bytes(content: bytes, filename: str = "", content_type: str = "") -> ParsedDocument:
    name = (filename or "").lower()
    ctype = (content_type or "").lower()
    if name.endswith(".pdf") or "pdf" in ctype or content[:5] == b"%PDF-":
        return pdf_to_text(content)
    try:
        raw = content.decode("utf-8")
    except UnicodeDecodeError:
        raw = content.decode("latin-1")
    if name.endswith((".html", ".htm")) or "html" in ctype or raw.lstrip()[:15].lower().startswith(("<!doctype", "<html")):
        text = normalize_text(html_to_text(raw))
        return ParsedDocument(text=text, metadata={"format": "html"})
    return ParsedDocument(text=normalize_text(raw), metadata={"format": "text"})


def parse_text(text: str) -> ParsedDocument:
    return ParsedDocument(text=normalize_text(text), metadata={"format": "text"})


# --------------------------------------------------------------------------- sections

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_NUM_HEADING = re.compile(r"^(\d+(?:\.\d+){0,3})[.)]?\s+([A-Z][^|\n]{2,90})$")
_ITEM_HEADING = re.compile(r"^(?:ITEM|Item|PART|Part|NOTE|Note|SECTION|Section)\s+[\dA-Za-z.]+[.:\-–—]?\s*(.{0,90})$")

_SECTION_TYPES = [
    ("income_statement", ("income statement", "statement of operations", "profit or loss", "statement of income", "consolidated results")),
    ("balance_sheet", ("balance sheet", "financial position")),
    ("cash_flow", ("cash flow", "capital expenditure", "investing")),
    ("sustainability", ("sustainab", "emission", "climate", "ghg", "esg", "environment", "taxonomy")),
    ("mdna", ("management's discussion", "management discussion", "md&a", "operating and financial review", "financial review", "performance")),
    ("segments", ("segment",)),
    ("risk", ("risk",)),
    ("notes", ("note ",)),
]


def classify_section(heading: str) -> str:
    h = heading.lower()
    for stype, keys in _SECTION_TYPES:
        if any(k in h for k in keys):
            return stype
    return "other"


def _is_heading_line(line: str) -> Optional[tuple[int, str]]:
    s = line.strip()
    if not s or len(s) > 110:
        return None
    m = _MD_HEADING.match(s)
    if m:
        return len(m.group(1)), m.group(2).strip()
    if "|" in s:
        return None
    m = _NUM_HEADING.match(s)
    if m and not s.endswith((".", ",", ";")) and len(s.split()) <= 14:
        return min(m.group(1).count(".") + 1, 4), s
    m = _ITEM_HEADING.match(s)
    if m and len(s.split()) <= 14 and not s.endswith("."):
        return 2, s
    letters = [c for c in s if c.isalpha()]
    if len(letters) >= 4 and s.upper() == s and len(s.split()) <= 10 and not re.search(r"\d{2,}", s):
        return 1, s
    return None


def detect_sections(text: str) -> list[Section]:
    sections: list[Section] = []
    current: Optional[Section] = None
    pos = 0
    for line in text.split("\n"):
        line_start = pos
        pos += len(line) + 1
        h = _is_heading_line(line)
        if h:
            if current is not None:
                current.end = line_start
                sections.append(current)
            elif line_start > 0 and text[:line_start].strip():
                sections.append(Section("Preamble", 1, 0, line_start, "other"))
            current = Section(h[1], h[0], line_start, len(text), classify_section(h[1]))
    if current is not None:
        current.end = len(text)
        sections.append(current)
    if not sections:
        sections.append(Section("Document", 1, 0, len(text), "other"))
    # Trim empty sections
    return [s for s in sections if text[s.start:s.end].strip()]


# --------------------------------------------------------------------------- context

_YEAR_RE = re.compile(r"\b(?:fiscal\s+year|fiscal|FY|year\s+ended[^\n]{0,24}?|annual\s+report)\s*[-–]?\s*((?:19|20)\d{2})\b", re.IGNORECASE)
_UNIT_STATEMENT = re.compile(
    r"(?i)(?:amounts?|figures?|numbers?|values?|results|tables?|data)[^.\n]{0,70}?"
    r"\b(?:in|expressed in|stated in|presented in|reported in)\b[^.\n]{0,80}"
)


def detect_fiscal_year(text: str) -> Optional[int]:
    head = text[:3000]
    m = _YEAR_RE.search(head)
    if m:
        return int(m.group(1))
    years = [int(y) for y in _YEAR_RE.findall(text)]
    if years:
        return Counter(years).most_common(1)[0][0]
    return None


def detect_context(text: str, fiscal_year: Optional[int] = None) -> DocContext:
    ctx = DocContext(fiscal_year=fiscal_year or detect_fiscal_year(text))
    for m in _UNIT_STATEMENT.finditer(text):
        stmt = m.group(0)
        cur = detect_currency(stmt)
        sc = detect_scale(stmt)
        em = detect_emission_unit(stmt)
        if cur and ctx.currency is None:
            ctx.currency = cur
        if sc is not None and ctx.scale is None:
            ctx.scale = sc
        if em and ctx.emission_unit is None:
            ctx.emission_unit = em
    if ctx.currency is None:
        ctx.currency = detect_currency(text[:4000])
    return ctx


def page_for_offset(pages: list[tuple[int, int]], offset: int) -> Optional[int]:
    for i, (s, e) in enumerate(pages):
        if s <= offset <= e:
            return i + 1
    return None
