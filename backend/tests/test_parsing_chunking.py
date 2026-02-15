from engine import chunking, parsing


SAMPLE = """# Acme Annual Report 2024

Fiscal Year 2024 - Acme

All amounts are expressed in USD millions unless otherwise stated.

## Income Statement

Table 1: Income statement (USD millions)

| Line item | FY2024 | FY2023 |
|---|---|---|
| Revenue | 120.5 | 100.0 |
| Operating income | 20.1 | 15.0 |

## Notes

Revenue grew strongly. See Table 1 for the figures.
"""


def test_sections_detected_with_types():
    text = parsing.normalize_text(SAMPLE)
    secs = parsing.detect_sections(text)
    heads = [s.heading for s in secs]
    assert "Income Statement" in heads and "Notes" in heads
    assert [s for s in secs if s.heading == "Income Statement"][0].section_type == "income_statement"


def test_chunks_are_exact_substrings_and_tables_intact():
    text = parsing.normalize_text(SAMPLE)
    secs = parsing.detect_sections(text)
    chunks, rels = chunking.chunk_document(text, secs)
    for c in chunks:
        assert text[c.start:c.end] == c.text
    tables = [c for c in chunks if c.chunk_type == "table"]
    assert len(tables) == 1
    assert "Revenue | 120.5" in tables[0].text and "Operating income | 20.1" in tables[0].text
    assert tables[0].meta["caption"].startswith("Table 1")
    assert "Table 1: Income statement" in tables[0].text  # caption travels with the table


def test_relationships_include_neighbors_and_references():
    text = parsing.normalize_text(SAMPLE)
    chunks, rels = chunking.chunk_document(text, parsing.detect_sections(text))
    kinds = {r.relation for r in rels}
    assert {"next", "previous"} <= kinds
    assert "references" in kinds  # "See Table 1" -> table chunk
    ref = [r for r in rels if r.relation == "references"][0]
    assert chunks[ref.target].chunk_type == "table"


def test_large_table_split_keeps_rows_whole():
    rows = "\n".join(f"| Item {i} | {i * 10}.0 | {i * 9}.0 |" for i in range(200))
    text = parsing.normalize_text("## Big\n\n| Line | FY2024 | FY2023 |\n|---|---|---|\n" + rows + "\n")
    chunks, _ = chunking.chunk_document(text, parsing.detect_sections(text), max_table_chars=1200)
    tables = [c for c in chunks if c.chunk_type == "table"]
    assert len(tables) > 1
    for c in tables:
        assert text[c.start:c.end] == c.text
        for line in c.text.split("\n"):
            assert line.count("|") == 0 or line.strip().endswith("|")  # no half rows


def test_html_parsing_converts_tables():
    html = "<html><body><h1>Report 2024</h1><p>Hello</p><table><tr><th>Item</th><th>FY2024</th></tr><tr><td>Revenue</td><td>1,000</td></tr></table></body></html>"
    parsed = parsing.parse_bytes(html.encode(), "r.html")
    assert "# Report 2024" in parsed.text and "| Revenue | 1,000 |" in parsed.text


def test_context_detection():
    text = parsing.normalize_text(SAMPLE)
    ctx = parsing.detect_context(text)
    assert ctx.fiscal_year == 2024 and ctx.currency == "USD" and ctx.scale == 10 ** 6
