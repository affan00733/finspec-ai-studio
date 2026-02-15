"""Deterministic, evidence-grounded extraction from document text.

Values are only ever read out of the text of retrieved chunks. Nothing is
inferred, estimated or filled from priors: if a line item is absent, reported
as unavailable, or contradictory, the outcome says so.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Optional

from .chunking import is_table_line, split_cells
from .numeric import (
    AMOUNT_RE, decimals_of, detect_currency, detect_emission_unit, detect_scale,
    is_missing_token, parse_number, scale_label, values_agree,
)
from .retrieval import RetrievalIndex
from .types import Candidate, ChunkRef, DocContext, ExtractionOutcome, SpecDef

_YEAR_IN_CELL = re.compile(r"(?<!\d)(?<!\d[,.])((?:19|20)\d{2})(?!\d)(?!,\d)(?!\.\d)")

ALLOWED_PRECEDING = frozenset(
    """the our its their total consolidated reported group company and or while with that as in for of
    fiscal year annual whereas but by from to at on against versus vs than was were is are had has have which
    because full-year full group's company's reported""".split()
)

_CONNECTOR = re.compile(
    r"""
    (?:\s+(?:in|for|during)\s+(?:fiscal\s+(?:year\s+)?|FY\s?|the\s+year\s+(?:ended\s+)?)?(?:19|20)\d{2})?
    \s*,?\s*
    (?:(?:increased|decreased|rose|fell|grew|declined|climbed|dropped)\s+
        (?:by\s+(?:approximately\s+)?)?(?:\d[\d.,]*\s?%\s+)?)?
    (?:was|were|of|totaled|totalled|reached|amounted\s+to|came\s+to|to|stood\s+at|is|are|:|-|–|—)\s*
    (?:approximately\s+|about\s+|around\s+)?
    """,
    re.IGNORECASE | re.VERBOSE,
)

_UNIT_PAREN = re.compile(
    r"\((?:[^)]*?(?:usd|eur|gbp|million|thousand|billion|tco2|ktco2|mtco2|\bco2|%|\$|€|£|\bm\b|\bbn\b)[^)]*?)\)",
    re.IGNORECASE,
)


def normalize_label(s: str) -> str:
    s = s.lower().replace("&", " and ")
    s = re.sub(r"\((?:note|notes)\s*[\w.,\s-]*\)", "", s)
    s = _UNIT_PAREN.sub("", s)
    s = re.sub(r"\(\d\)", "", s)
    s = re.sub(r"[¹²³⁴⁵⁶⁷⁸⁹*†‡:]+", "", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—.,")
    return s


class _SpecMatcher:
    def __init__(self, spec: SpecDef):
        self.spec = spec
        self.aliases = {normalize_label(a) for a in spec.aliases}
        alts = sorted({a for a in spec.aliases}, key=len, reverse=True)
        pat = "|".join(re.escape(a).replace(r"\ ", r"\s+") for a in alts)
        self.alias_re = re.compile(r"(?<![\w/-])(?:" + pat + r")(?![\w-])", re.IGNORECASE)
        self.excludes = [e.lower() for e in spec.exclude_terms]


def _sentence_start(line: str, pos: int) -> int:
    cut = 0
    for sep in (". ", "; ", "! ", "? "):
        i = line.rfind(sep, 0, pos)
        if i >= 0:
            cut = max(cut, i + len(sep))
    return cut


def _sentence_end(line: str, pos: int) -> int:
    m = re.search(r"(?<=[a-zA-Z0-9%)])[.!?](?=\s|$)", line[pos:])
    return pos + m.end() if m else len(line)


def _row_is_data(cells: list[str]) -> bool:
    for c in cells[1:]:
        if _YEAR_IN_CELL.fullmatch(c.strip()):
            continue
        if parse_number(c) is not None:
            return True
    return False


def _parse_header(cells: list[str]) -> Optional[dict[int, int]]:
    years: dict[int, int] = {}
    for j, c in enumerate(cells):
        m = _YEAR_IN_CELL.search(c)
        if m and not re.search(r"\d{1,3},\d{3}", c):
            years[j] = int(m.group(1))
        elif j > 0 and parse_number(c) is not None:
            return None
    return years or None


def _pick_column(header_cells: list[str], years: dict[int, int], row_cells: list[str], target: int) -> Optional[int]:
    cols = [j for j, y in years.items() if y == target]
    if not cols:
        return None
    j = cols[0]
    if len(header_cells) == len(row_cells):
        return j
    ordered = sorted(years)
    value_idx = [k for k, c in enumerate(row_cells) if k > 0 and (parse_number(c) is not None or is_missing_token(c))]
    pos = ordered.index(j)
    if len(value_idx) == len(ordered):
        return value_idx[pos]
    if len(value_idx) > len(ordered) and ordered[-1] == len(header_cells) - 1:
        return value_idx[len(value_idx) - len(ordered) + pos]
    return None


class ScanResult:
    def __init__(self) -> None:
        self.candidates: list[Candidate] = []
        self.missing: list[str] = []  # explicit "not available" mentions


def _resolve_units(
    spec: SpecDef, row_text: str, pre_text: str, chunk: ChunkRef, ctx: DocContext, inline: tuple | None = None
) -> tuple[Optional[str], Decimal, str, str]:
    """Return (currency, multiplier, unit_label, source)."""
    sources = [("row", row_text), ("table_header", pre_text), ("caption", chunk.meta.get("caption", "")),
               ("heading", chunk.heading)]
    if spec.unit_type == "emissions":
        if inline:
            return None, inline[0], inline[1], "inline"
        for name, txt in sources:
            em = detect_emission_unit(txt, prefer_last=(name == "table_header"))
            if em:
                return None, em[0], em[1], name
        if ctx.emission_unit:
            return None, ctx.emission_unit[0], ctx.emission_unit[1], "document"
        return None, Decimal(1), "tCO2e", "unknown"
    cur = None
    scale = None
    src = "unknown"
    if inline:
        cur, scale = inline[0], inline[1]
        if scale is not None:
            src = "inline"
    for name, txt in sources:
        if cur is None:
            cur = detect_currency(txt)
        if scale is None:
            sc = detect_scale(txt, prefer_last=(name == "table_header"))
            if sc is not None:
                scale, src = sc, name
    if scale is None and ctx.scale is not None:
        scale, src = ctx.scale, "document"
    if cur is None:
        cur = ctx.currency
    scale = scale if scale is not None else Decimal(1)
    label = f"{cur or ''} {scale_label(scale)}".strip()
    return cur, scale, label, src


def scan_chunk(chunk: ChunkRef, matcher: _SpecMatcher, ctx: DocContext, year: Optional[int]) -> ScanResult:
    spec = matcher.spec
    res = ScanResult()
    lines = chunk.text.split("\n")
    header_cells: Optional[list[str]] = None
    header_years: Optional[dict[int, int]] = None
    for hl in chunk.meta.get("table_header_lines", []) or []:
        hc = split_cells(hl)
        hy = _parse_header(hc)
        if hy:
            header_cells, header_years = hc, hy
    non_data: list[str] = []
    if chunk.meta.get("caption"):
        non_data.append(chunk.meta["caption"])
    pos = 0
    for line in lines:
        line_off = pos
        pos += len(line) + 1
        s = line.strip()
        if not s:
            continue
        if is_table_line(line):
            cells = split_cells(line)
            if re.fullmatch(r"[|\-:+=\s]+", s):
                continue
            hy = _parse_header(cells) if cells else None
            if hy and not _row_is_data(cells):
                header_cells, header_years = cells, hy
                non_data.append(s)
                continue
            if not _row_is_data(cells) and not any(is_missing_token(c) and c for c in cells[1:]):
                non_data.append(s)
                continue
            _scan_table_row(chunk, matcher, ctx, year, line, line_off, cells, header_cells, header_years,
                            "\n".join(non_data), res)
        else:
            non_data.append(s)
            _scan_narrative_line(chunk, matcher, ctx, year, line, line_off, "\n".join(non_data[-6:]), res)
    return res


def _scan_table_row(chunk, matcher, ctx, year, line, line_off, cells, header_cells, header_years, pre_text, res):
    spec = matcher.spec
    label_raw = cells[0]
    if normalize_label(label_raw) not in matcher.aliases:
        return
    if any(e in label_raw.lower() for e in matcher.excludes):
        return
    notes: list[str] = []
    col: Optional[int] = None
    year_matched: Optional[bool] = None
    score = 0.95
    if header_cells and header_years and year is not None:
        col = _pick_column(header_cells, header_years, cells, year)
        if col is None:
            if year not in header_years.values():
                return  # table covers other years only: never reuse another year's number
            return  # ambiguous alignment: do not guess
        year_matched = True
    else:
        value_idx = [k for k, c in enumerate(cells) if k > 0 and (parse_number(c) is not None or is_missing_token(c))]
        if not value_idx:
            return
        col = value_idx[0]
        score = 0.5
        notes.append("no_year_header:assumed_first_value_column")
    cell = cells[col].strip()
    if is_missing_token(cell):
        res.missing.append(f"'{label_raw.strip()}' is reported as '{cell or 'blank'}' for {year}")
        return
    if "%" in cell:
        return
    value = parse_number(cell)
    if value is None:
        return
    row_text = " ".join(c for k, c in enumerate(cells) if k != col)
    if spec.sign_policy == "absolute" and value < 0:
        value = abs(value)
        notes.append("sign_normalized:outflow_shown_negative")
    cur, mult, ulabel, usrc = _resolve_units(spec, row_text, pre_text, chunk, ctx)
    dec = decimals_of(cell)
    gran = (Decimal(1).scaleb(-dec)) * mult
    stripped = line.strip()
    start = chunk.start_char + line_off + (len(line) - len(line.lstrip()))
    header_ctx = ""
    if header_cells:
        header_ctx = " | ".join(header_cells)
    if chunk.meta.get("caption"):
        header_ctx = (chunk.meta["caption"] + " :: " + header_ctx).strip(" :")
    res.candidates.append(Candidate(
        spec_key=spec.key, method="table", label=label_raw.strip(), raw_number=cell, value=value, scale=mult,
        currency=cur, unit_label=ulabel, normalized=value * mult, granularity=gran, chunk_id=chunk.id,
        document_id=chunk.document_id, quote=stripped, start_char=start, end_char=start + len(stripped),
        score=score, year=year, year_matched=year_matched, unit_source=usrc, notes=notes, context=header_ctx,
    ))


def _scan_narrative_line(chunk, matcher, ctx, year, line, line_off, pre_text, res):
    spec = matcher.spec
    for m in matcher.alias_re.finditer(line):
        pre = line[:m.start()]
        wm = re.search(r"([A-Za-z][A-Za-z'’-]*)\s+$", pre)
        if wm and wm.group(1).lower() not in ALLOWED_PRECEDING:
            continue
        pos = m.end()
        paren = re.match(r"\s*\(([^)]{0,40})\)", line[pos:])
        if paren:
            ptxt = paren.group(1).lower()
            if any(e in ptxt for e in matcher.excludes):
                continue
            if re.search(r"\d", ptxt) and not re.search(r"scope|location", ptxt):
                paren = None
            if paren:
                pos += paren.end()
        cm = _CONNECTOR.match(line, pos)
        if not cm:
            continue
        am = AMOUNT_RE.match(line, cm.end())
        if not am:
            continue
        if am.group("pct"):
            continue
        raw_num = am.group("num")
        value = parse_number(raw_num)
        if value is None:
            continue
        cur_tok = am.group("cur")
        scale_tok = am.group("scale")
        inline = None
        end = am.end()
        if spec.unit_type == "emissions":
            tail = line[am.end():am.end() + 40]
            if not re.match(r"\s*(?:[kMG]?t\s?CO\s?[2₂]|(?:metric\s+)?(?:tonnes?|tons?)\b)", tail, re.IGNORECASE):
                continue
            em = detect_emission_unit(tail.replace("₂", "2"))
            if not em:
                continue
            amt_scale = Decimal(1)
            if scale_tok and scale_tok.lower() in ("thousand", "million", "billion", "k", "mn", "bn"):
                from .numeric import SCALE_WORDS
                amt_scale = SCALE_WORDS[scale_tok.lower()]
            mult = amt_scale * em[0]
            ulabel = em[1] if amt_scale == 1 else f"{scale_label(amt_scale)} {em[1]}"
            inline = (mult, ulabel)
            tm = re.match(r"\s*(?:[kMG]?t\s?CO\s?[2₂]\s?-?e(?:q)?|(?:metric\s+)?(?:tonnes?|tons?)(?:\s+of)?\s+CO\s?[2₂]\s?-?e(?:q|quivalent)?|(?:metric\s+)?(?:tonnes?|tons?))", tail, re.IGNORECASE)
            end = am.end() + (tm.end() if tm else 0)
        else:
            from .numeric import CURRENCY_SYMBOLS, SCALE_WORDS
            sl = scale_tok.lower() if scale_tok else None
            if sl in ("m", "k") and not cur_tok:
                sl = None
            if not cur_tok and not sl:
                continue
            cur = CURRENCY_SYMBOLS.get(cur_tok) or (cur_tok.upper() if cur_tok else None)
            inline = (cur, SCALE_WORDS.get(sl) if sl else None)
        # Year resolution: years mentioned before the end of the amount decide the period.
        sent_start = _sentence_start(line, m.start())
        span = line[sent_start:end]
        years_in = [int(y) for y in _YEAR_IN_CELL.findall(span)]
        year_matched: Optional[bool] = None
        score = 0.72
        notes: list[str] = []
        if year is not None and years_in:
            if year in years_in:
                year_matched, score = True, 0.8
            else:
                continue  # sentence is about a different period
        else:
            notes.append("no_year_in_sentence")
        sent_end = _sentence_end(line, end)
        quote = line[sent_start:sent_end].strip()
        q_off = sent_start + (len(line[sent_start:sent_end]) - len(line[sent_start:sent_end].lstrip()))
        start = chunk.start_char + line_off + q_off
        if re.search(r"\b(expect|guid|forecast|outlook|target|anticipate|plan to|projected)\w*", quote, re.IGNORECASE) and \
                not year_matched:
            continue
        if spec.sign_policy == "absolute" and value < 0:
            value = abs(value)
            notes.append("sign_normalized")
        cur, mult, ulabel, usrc = _resolve_units(spec, "", pre_text, chunk, ctx, inline=inline)
        dec = decimals_of(raw_num)
        gran = Decimal(1).scaleb(-dec) * mult
        res.candidates.append(Candidate(
            spec_key=spec.key, method="narrative", label=m.group(0), raw_number=raw_num.strip(), value=value,
            scale=mult, currency=cur, unit_label=ulabel, normalized=value * mult, granularity=gran,
            chunk_id=chunk.id, document_id=chunk.document_id, quote=quote, start_char=start,
            end_char=start + len(quote), score=score, year=year, year_matched=year_matched, unit_source=usrc,
            notes=notes, context=chunk.heading,
        ))


def select_outcome(spec: SpecDef, cands: list[Candidate], missing: list[str], year: Optional[int],
                   retrieved_ids: list) -> ExtractionOutcome:
    uniq: dict[tuple, Candidate] = {}
    for c in cands:
        key = (c.document_id, c.start_char, c.end_char)
        if key not in uniq or c.score > uniq[key].score:
            uniq[key] = c
    cands = sorted(uniq.values(), key=lambda c: (-c.score, c.start_char))
    out = ExtractionOutcome(spec_key=spec.key, status="not_found", fiscal_year=year,
                            retrieved_chunk_ids=list(retrieved_ids))
    if not cands:
        if missing:
            out.rationale = "Line item present but no value reported: " + "; ".join(missing[:2])
        else:
            out.rationale = (f"No line item matching {spec.aliases[:4]} with a value for fiscal year {year} "
                             f"found in {len(retrieved_ids)} retrieved chunks.")
        return out
    best = cands[0]
    agree = [best]
    conflicts: list[Candidate] = []
    for c in cands[1:]:
        if values_agree(best.normalized, best.granularity, c.normalized, c.granularity):
            agree.append(c)
        else:
            conflicts.append(c)
    near = [c for c in conflicts if c.score >= best.score - 0.10]
    for c in agree[1:]:
        c.role = "supporting"
    for c in conflicts:
        c.role = "conflicting"
    out.candidates = agree + conflicts
    if near:
        out.status = "ambiguous"
        out.best = None
        vals = sorted({f"{c.raw_number} {c.unit_label}" for c in [best] + near})
        out.rationale = ("Conflicting values of comparable reliability found (" + "; ".join(vals) +
                         "); no value selected - analyst review required.")
        out.confidence = 0.0
        return out
    out.status = "found"
    out.best = best
    conf = best.score + 0.03 * (len(agree) - 1)
    if best.unit_source == "unknown":
        conf -= 0.10
        out.warnings.append("unit_not_stated")
    if conflicts:
        conf -= 0.05
        out.warnings.append("lower_reliability_conflicting_evidence")
    out.confidence = round(max(0.05, min(conf, 0.99)), 3)
    basis = "table row" if best.method == "table" else "narrative sentence"
    out.rationale = (f"Matched '{best.label}' in a {basis}"
                     + (f" under the {year} column" if best.method == "table" and best.year_matched else "")
                     + f"; {len(agree)} agreeing source(s)."
                     + (f" {len(conflicts)} lower-reliability conflicting source(s) noted." if conflicts else ""))
    return out


class DeterministicExtractor:
    """Retrieve-then-read extractor that works purely from document text."""

    def __init__(self, index: RetrievalIndex):
        self.index = index

    def retrieve(self, spec: SpecDef, document_id, top_k: int = 8, mode: str = "hybrid",
                 graph_expansion: bool = True):
        query = f"{spec.name} " + " ".join(spec.aliases)
        return self.index.search(query, top_k=top_k, mode=mode, graph_expansion=graph_expansion,
                                 extra_phrases=spec.aliases, document_ids=[document_id])

    def extract(self, spec: SpecDef, document_id, ctx: DocContext, top_k: int = 8, mode: str = "hybrid",
                graph_expansion: bool = True, target_year: Optional[int] = None) -> ExtractionOutcome:
        year = target_year or ctx.fiscal_year
        hits = self.retrieve(spec, document_id, top_k=top_k, mode=mode, graph_expansion=graph_expansion)
        matcher = _SpecMatcher(spec)
        cands: list[Candidate] = []
        missing: list[str] = []
        for h in hits:
            r = scan_chunk(h.chunk, matcher, ctx, year)
            cands.extend(r.candidates)
            missing.extend(r.missing)
        return select_outcome(spec, cands, missing, year, [h.chunk.id for h in hits])
