"""Structure-aware chunking and chunk-graph construction.

* Tables are never split mid-row and keep their caption line.
* Text is packed by paragraph up to ``max_chars`` with sentence overlap only
  when a single paragraph is too large.
* Every chunk is an exact substring of the source text (``text[start:end]``),
  so downstream evidence offsets are always valid.
* Relationships form a lightweight document graph used for retrieval expansion.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .parsing import Section

_NUMCELL = re.compile(r"^\(?[-−]?[$€£¥]?\s?[\d][\d,.\s]*\)?%?[*¹²³†‡]?$")
_YEARCELL = re.compile(r"^(?:FY|Fiscal\s*)?\s?(?:19|20)\d{2}$", re.IGNORECASE)
_MISSING = {"n/a", "na", "nm", "-", "–", "—", "nil", "n.a."}


def split_cells(line: str) -> list[str]:
    s = line.strip()
    if "|" in s:
        s = s.strip("|")
        return [c.strip() for c in s.split("|")]
    return [c.strip() for c in re.split(r"\t+|\s{2,}", s) if c.strip()]


def is_table_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if s.count("|") >= 2:
        return True
    cells = split_cells(s)
    if len(cells) < 2:
        return False
    numeric = sum(
        1 for c in cells[1:] if _NUMCELL.match(c) or _YEARCELL.match(c) or c.lower() in _MISSING
    )
    return numeric >= 1 and (len(cells) >= 3 or numeric >= 1) and len(s) < 220 and numeric >= len(cells) - 2


@dataclass
class ChunkSpec:
    index: int
    text: str
    start: int
    end: int
    chunk_type: str
    section_index: int
    heading: str
    meta: dict = field(default_factory=dict)


@dataclass
class RelSpec:
    source: int
    target: int
    relation: str
    weight: float


@dataclass
class _Block:
    start: int
    end: int
    kind: str  # text | table


def _blocks(text: str, lo: int, hi: int) -> list[_Block]:
    """Split ``text[lo:hi]`` into paragraph and table blocks with exact offsets."""
    blocks: list[_Block] = []
    pos = lo
    cur_start: int | None = None
    cur_kind: str | None = None
    cur_end = lo
    for line in text[lo:hi].split("\n"):
        ls = pos
        le = pos + len(line)
        pos = le + 1
        if not line.strip():
            if cur_kind is not None:
                blocks.append(_Block(cur_start, cur_end, cur_kind))
                cur_kind = None
            continue
        kind = "table" if is_table_line(line) else "text"
        if cur_kind is None:
            cur_kind, cur_start, cur_end = kind, ls, le
        elif kind == cur_kind:
            cur_end = le
        else:
            blocks.append(_Block(cur_start, cur_end, cur_kind))
            cur_kind, cur_start, cur_end = kind, ls, le
    if cur_kind is not None:
        blocks.append(_Block(cur_start, cur_end, cur_kind))
    return blocks


def _is_caption(text: str, b: _Block) -> bool:
    if b.kind != "text":
        return False
    t = text[b.start:b.end].strip()
    return "\n" not in t and 0 < len(t) <= 220 and len(t.split()) <= 30


def _split_long_text(text: str, start: int, end: int, max_chars: int, overlap: int) -> list[tuple[int, int]]:
    """Window a long span on sentence boundaries with overlap; returns exact spans."""
    span = text[start:end]
    bounds = [0]
    for m in re.finditer(r"(?<=[.!?])\s+", span):
        bounds.append(m.end())
    bounds.append(len(span))
    bounds = sorted(set(bounds))
    out: list[tuple[int, int]] = []
    i = 0
    n = len(bounds)
    while i < n - 1:
        j = i + 1
        while j < n - 1 and bounds[j + 1] - bounds[i] <= max_chars:
            j += 1
        out.append((start + bounds[i], start + bounds[j]))
        if j >= n - 1:
            break
        # overlap: step back while the overlap budget allows
        k = j
        while k > i + 1 and bounds[j] - bounds[k - 1] <= overlap:
            k -= 1
        i = k if k > i else j
    return out


def _split_table(text: str, b: _Block, caption_start: int | None, max_chars: int) -> list[tuple[int, int, dict]]:
    start = caption_start if caption_start is not None else b.start
    if b.end - start <= max_chars:
        return [(start, b.end, {})]
    lines: list[tuple[int, int]] = []
    pos = b.start
    for line in text[b.start:b.end].split("\n"):
        lines.append((pos, pos + len(line)))
        pos += len(line) + 1
    header = []
    for ls, le in lines[:4]:
        header.append(text[ls:le])
        if len(re.findall(r"(?:19|20)\d{2}", text[ls:le])) >= 2:
            break
    parts: list[tuple[int, int, dict]] = []
    cur_s = start
    cur_e = start
    for ls, le in lines:
        if le - cur_s > max_chars and cur_e > cur_s:
            parts.append((cur_s, cur_e, {}))
            cur_s = ls
        cur_e = le
    parts.append((cur_s, cur_e, {}))
    out = []
    for idx, (s, e, _) in enumerate(parts):
        meta = {"table_part": idx + 1, "table_parts": len(parts), "table_header_lines": header}
        out.append((s, e, meta))
    return out


def chunk_document(
    text: str,
    sections: list[Section],
    max_chars: int = 1400,
    overlap: int = 200,
    max_table_chars: int = 6000,
) -> tuple[list[ChunkSpec], list[RelSpec]]:
    chunks: list[ChunkSpec] = []

    def add(start: int, end: int, ctype: str, sec_idx: int, heading: str, meta: dict | None = None) -> None:
        raw = text[start:end]
        lead = len(raw) - len(raw.lstrip("\n"))
        start += lead
        end = start + len(raw.strip("\n"))
        if not text[start:end].strip():
            return
        chunks.append(ChunkSpec(len(chunks), text[start:end], start, end, ctype, sec_idx, heading, dict(meta or {})))

    for si, sec in enumerate(sections):
        blocks = _blocks(text, sec.start, sec.end)
        pending: list[_Block] = []

        def flush_pending() -> None:
            if not pending:
                return
            cur_s = pending[0].start
            cur_e = pending[0].end
            for blk in pending[1:]:
                if blk.end - cur_s > max_chars:
                    _emit_text(cur_s, cur_e)
                    cur_s = blk.start
                cur_e = blk.end
            _emit_text(cur_s, cur_e)
            pending.clear()

        def _emit_text(s: int, e: int) -> None:
            if e - s > max_chars * 1.25:
                for a, b in _split_long_text(text, s, e, max_chars, overlap):
                    add(a, b, "text", si, sec.heading)
            else:
                add(s, e, "text", si, sec.heading)

        for b in blocks:
            if b.kind == "text":
                pending.append(b)
                continue
            caption = None
            if pending and _is_caption(text, pending[-1]):
                caption = pending.pop()
            flush_pending()
            caption_text = text[caption.start:caption.end].strip() if caption else ""
            for s, e, meta in _split_table(text, b, caption.start if caption else None, max_table_chars):
                meta = dict(meta)
                if caption_text:
                    meta["caption"] = caption_text
                add(s, e, "table", si, sec.heading, meta)
        flush_pending()

    rels = build_relationships(chunks, sections, text)
    return chunks, rels


_REF_RE = re.compile(r"\b(Note|Table|Section|Item|Figure)\s+(\d+(?:\.\d+)?[A-Za-z]?)", re.IGNORECASE)


def build_relationships(chunks: list[ChunkSpec], sections: list[Section], text: str) -> list[RelSpec]:
    rels: list[RelSpec] = []
    seen: set[tuple[int, int, str]] = set()

    def add(a: int, b: int, rel: str, w: float) -> None:
        if a == b or (a, b, rel) in seen:
            return
        seen.add((a, b, rel))
        rels.append(RelSpec(a, b, rel, w))

    for i in range(len(chunks) - 1):
        add(i, i + 1, "next", 0.9)
        add(i + 1, i, "previous", 0.9)

    by_section: dict[int, list[int]] = {}
    for c in chunks:
        by_section.setdefault(c.section_index, []).append(c.index)
    for idxs in by_section.values():
        lead = idxs[0]
        for j in idxs[1:]:
            add(j, lead, "section_lead", 0.5)
            add(lead, j, "section_member", 0.4)

    for i, c in enumerate(chunks):
        if c.chunk_type == "table":
            if i > 0 and chunks[i - 1].chunk_type == "text" and chunks[i - 1].section_index == c.section_index:
                add(i - 1, i, "table_context", 0.8)
                add(i, i - 1, "table_context", 0.8)
            if c.meta.get("table_part", 1) > 1 and i > 0 and chunks[i - 1].chunk_type == "table":
                add(i, i - 1, "table_continuation", 1.0)
                add(i - 1, i, "table_continuation", 1.0)

    # Cross references ("see Note 4", "Table 2") -> chunks whose heading/caption mention the same token
    targets: dict[str, list[int]] = {}
    for c in chunks:
        label = f"{c.heading} {c.meta.get('caption', '')}"
        for m in _REF_RE.finditer(label):
            targets.setdefault(f"{m.group(1).lower()} {m.group(2).lower()}", []).append(c.index)
    for c in chunks:
        for m in _REF_RE.finditer(c.text):
            key = f"{m.group(1).lower()} {m.group(2).lower()}"
            for t in targets.get(key, []):
                add(c.index, t, "references", 0.6)
    return rels
