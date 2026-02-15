"""Numeric, currency, scale and emission-unit parsing.

All parsing is conservative: when a token cannot be interpreted with
confidence, ``None`` is returned instead of a guess.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional

CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"}
CURRENCY_CODES = (
    "USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "CNY", "INR",
)
CURRENCY_WORDS = {
    "us dollars": "USD", "u.s. dollars": "USD", "dollars": "USD",
    "euros": "EUR", "euro": "EUR", "pounds sterling": "GBP", "british pounds": "GBP",
    "sterling": "GBP",
}

SCALE_WORDS = {
    "thousand": Decimal(10) ** 3,
    "thousands": Decimal(10) ** 3,
    "million": Decimal(10) ** 6,
    "millions": Decimal(10) ** 6,
    "billion": Decimal(10) ** 9,
    "billions": Decimal(10) ** 9,
    "trillion": Decimal(10) ** 12,
    "trillions": Decimal(10) ** 12,
    "k": Decimal(10) ** 3,
    "mn": Decimal(10) ** 6,
    "mm": Decimal(10) ** 6,
    "m": Decimal(10) ** 6,
    "bn": Decimal(10) ** 9,
    "tn": Decimal(10) ** 12,
}
SCALE_CANONICAL = {
    Decimal(1): "units",
    Decimal(10) ** 3: "thousands",
    Decimal(10) ** 6: "millions",
    Decimal(10) ** 9: "billions",
    Decimal(10) ** 12: "trillions",
}

MISSING_TOKENS = {
    "", "-", "–", "—", "−", "n/a", "na", "n.a.", "nm", "n.m.", "nil", "none",
    "not disclosed", "not reported", "not available", "tbd", "*", "..",
}

_SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹⁰"


def is_missing_token(token: str) -> bool:
    return token.strip().lower() in MISSING_TOKENS


def parse_number(raw: str) -> Optional[Decimal]:
    """Parse a numeric token such as ``1,234.5``, ``(1,234.5)`` or ``1.234,5``.

    Returns ``None`` for anything that is not unambiguously a number.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s or is_missing_token(s):
        return None
    s = s.replace("\u2212", "-").replace("\u00a0", " ").replace("\u202f", " ")
    s = s.rstrip(_SUPERSCRIPTS + "*†‡ ")
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1].strip()
    s = re.sub(r"^[\$€£¥]\s*", "", s)
    s = re.sub(r"^(?:USD|EUR|GBP|CAD|AUD|CHF|JPY)\s*", "", s)
    if s.startswith("-"):
        negative = not negative if negative else True
        s = s[1:].strip()
    s = s.replace(" ", "")
    if not s or not re.fullmatch(r"[\d,.]+", s):
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        if re.fullmatch(r"\d{1,3}(,\d{3})+", s):
            s = s.replace(",", "")
        elif re.fullmatch(r"\d+,\d{1,2}", s):
            s = s.replace(",", ".")
        else:
            return None
    elif s.count(".") > 1:
        if re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
            s = s.replace(".", "")
        else:
            return None
    try:
        value = Decimal(s)
    except InvalidOperation:
        return None
    return -value if negative else value


def decimals_of(token: str) -> int:
    """Number of decimal places in the textual representation of a number."""
    t = token.strip().strip("()").lstrip("-")
    if "." in t and "," in t and t.rfind(",") > t.rfind("."):
        return len(t) - t.rfind(",") - 1
    if "." in t:
        return len(t) - t.rfind(".") - 1
    if re.fullmatch(r"\d+,\d{1,2}", t):
        return len(t) - t.rfind(",") - 1
    return 0


def detect_currency(text: str) -> Optional[str]:
    """Return the first currency mentioned in ``text`` (ISO code) or None."""
    if not text:
        return None
    best: tuple[int, str] | None = None
    for sym, code in CURRENCY_SYMBOLS.items():
        i = text.find(sym)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, code)
    for m in re.finditer(r"\b(" + "|".join(CURRENCY_CODES) + r")\b", text):
        if best is None or m.start() < best[0]:
            best = (m.start(), m.group(1))
        break
    low = text.lower()
    for word, code in CURRENCY_WORDS.items():
        i = low.find(word)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, code)
    return best[1] if best else None


_SCALE_RE = re.compile(
    r"(?<![A-Za-z])(thousands?|millions?|billions?|trillions?)(?![A-Za-z])"
    r"|(?<![A-Za-z])(mn|bn|tn|mm)(?![A-Za-z])"
    r"|(?:[\$€£]|\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY))\s?(m|k|bn)\b",
    re.IGNORECASE,
)


def detect_scale(text: str, prefer_last: bool = False) -> Optional[Decimal]:
    """Detect a unit scale (thousand/million/billion) in a unit statement."""
    if not text:
        return None
    matches = list(_SCALE_RE.finditer(text))
    if not matches:
        return None
    m = matches[-1] if prefer_last else matches[0]
    word = (m.group(1) or m.group(2) or m.group(3)).lower()
    return SCALE_WORDS.get(word)


def scale_label(scale: Decimal | None) -> str:
    if scale is None:
        return "units"
    return SCALE_CANONICAL.get(Decimal(scale), f"x{scale}")


_EMISSION_RE = re.compile(
    r"(?:(?P<pre>thousand|million|billion)\s+)?"
    r"(?:(?P<sym>kt|Mt|Gt|t)\s?CO\s?2\s?-?e(?:q)?\b"
    r"|(?:metric\s+)?(?:tonnes?|tons?)\s+(?:of\s+)?CO\s?2\s?-?e(?:q|quivalent)?\b)",
    re.IGNORECASE,
)
_PRE_MULT = {"thousand": Decimal(10) ** 3, "million": Decimal(10) ** 6, "billion": Decimal(10) ** 9}


def detect_emission_unit(text: str, prefer_last: bool = False) -> Optional[tuple[Decimal, str]]:
    """Return ``(multiplier_to_tCO2e, label)`` if an emissions unit is present."""
    if not text:
        return None
    text = text.replace("\u2082", "2")
    matches = list(_EMISSION_RE.finditer(text))
    if not matches:
        return None
    m = matches[-1] if prefer_last else matches[0]
    mult = Decimal(1)
    label = "tCO2e"
    sym = m.group("sym")
    if sym:
        s = sym.lower()
        if s == "kt":
            mult, label = Decimal(1000), "ktCO2e"
        elif s == "mt":
            mult, label = Decimal(10) ** 6, "MtCO2e"
        elif s == "gt":
            mult, label = Decimal(10) ** 9, "GtCO2e"
    pre = m.group("pre")
    if pre:
        mult *= _PRE_MULT[pre.lower()]
        label = f"{pre.lower()} {label}"
    return mult, label


@dataclass
class Amount:
    raw: str
    number: Decimal
    currency: Optional[str] = None
    scale: Optional[Decimal] = None
    decimals: int = 0
    start: int = 0
    end: int = 0
    percent: bool = False


AMOUNT_RE = re.compile(
    r"(?P<cur>USD|EUR|GBP|CAD|AUD|CHF|JPY|[\$€£¥])?\s?"
    r"(?P<num>\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|\(?-?\d+(?:\.\d+)?\)?)"
    r"(?P<pct>\s?%)?"
    r"(?:\s?(?P<scale>thousand|million|billion|trillion|mn|bn|mm|tn|m|k)\b(?![\w-]))?",
    re.IGNORECASE,
)


def find_amounts(text: str) -> list[Amount]:
    """Find numeric amounts with optional inline currency / scale in ``text``."""
    out: list[Amount] = []
    for m in AMOUNT_RE.finditer(text):
        num = parse_number(m.group("num"))
        if num is None:
            continue
        cur_tok = m.group("cur")
        cur = None
        if cur_tok:
            cur = CURRENCY_SYMBOLS.get(cur_tok) or cur_tok.upper()
        scale_tok = m.group("scale")
        scale = SCALE_WORDS.get(scale_tok.lower()) if scale_tok else None
        # ``m`` / ``k`` only count as a scale when a currency is attached.
        if scale_tok and scale_tok.lower() in ("m", "k") and not cur:
            scale = None
            end = m.end("pct") if m.group("pct") else m.end("num")
        else:
            end = m.end()
        out.append(
            Amount(
                raw=text[m.start("num"):m.end("num")],
                number=num,
                currency=cur,
                scale=scale,
                decimals=decimals_of(m.group("num")),
                start=m.start(),
                end=end,
                percent=bool(m.group("pct")),
            )
        )
    return out


def normalize_value(value: Decimal, scale: Decimal | None) -> Decimal:
    return value * (scale if scale is not None else Decimal(1))


def format_decimal(value: Decimal | None, places: int = 4) -> str:
    if value is None:
        return ""
    q = Decimal(1).scaleb(-places)
    try:
        return format(value.quantize(q).normalize(), "f")
    except InvalidOperation:
        return str(value)


def values_agree(a: Decimal, a_granularity: Decimal, b: Decimal, b_granularity: Decimal) -> bool:
    """True if two normalized values are the same up to reporting precision."""
    if a == b:
        return True
    diff = abs(a - b)
    tol = max(a_granularity, b_granularity) / 2 + Decimal("0.0000001")
    if diff <= tol:
        return True
    base = max(abs(a), abs(b))
    return base > 0 and diff / base < Decimal("0.0005")
