from engine.retrieval import RetrievalIndex, tokenize
from engine.types import ChunkRef


def mk(i, text, doc=1, heading="", ctype="text"):
    return ChunkRef(id=i, document_id=doc, index=i, text=text, heading=heading, chunk_type=ctype)


def test_tokenize_stems_and_drops_stopwords():
    assert tokenize("The Revenues of the Companies") == ["revenue", "company"]


def test_bm25_ranks_relevant_chunk_first():
    idx = RetrievalIndex([
        mk(1, "Greenhouse gas emissions scope 1 scope 2 tonnes"),
        mk(2, "Total revenue and net sales for the year"),
        mk(3, "Risk factors include commodity prices"),
    ])
    hits = idx.search("scope 1 emissions", top_k=3, mode="bm25", graph_expansion=False)
    assert hits[0].chunk.id == 1


def test_modes_and_hybrid_fusion_scores():
    idx = RetrievalIndex([mk(1, "capital expenditure was high"), mk(2, "capex capital expenditure table"),
                          mk(3, "unrelated text about employees")])
    h = idx.search("capital expenditure", top_k=3, mode="hybrid", graph_expansion=False)
    assert {"bm25", "lexical", "rrf"} <= set(h[0].scores)
    assert h[0].chunk.id in (1, 2)
    assert all(x.chunk.id != 3 for x in h)
    for mode in ("bm25", "lexical"):
        assert idx.search("capital expenditure", mode=mode, graph_expansion=False)
    try:
        idx.search("x", mode="vector")
        assert False
    except ValueError:
        pass


def test_rrf_combines_rank_lists():
    # chunk 2 is 2nd in BM25 and lexical-phrase matched; RRF score should equal sum of reciprocal ranks
    idx = RetrievalIndex([mk(1, "alpha alpha alpha beta"), mk(2, "alpha beta gamma"), mk(3, "gamma delta")])
    hit = idx.search("alpha beta", top_k=3, mode="hybrid", graph_expansion=False)[0]
    assert abs(hit.scores["rrf"] - hit.score) < 1e-12 and hit.score <= 2 / 61 + 1e-9


def test_graph_expansion_adds_neighbors():
    chunks = [mk(1, "Scope 1 emissions table", ctype="table"), mk(2, "intro paragraph about the sustainability report"),
              mk(3, "Unrelated"), ]
    idx = RetrievalIndex(chunks, [(1, 2, "table_context", 0.8), (2, 1, "table_context", 0.8)])
    no_exp = idx.search("scope 1 emissions", top_k=1, graph_expansion=False)
    exp = idx.search("scope 1 emissions", top_k=1, graph_expansion=True)
    assert [h.chunk.id for h in no_exp] == [1]
    assert [h.chunk.id for h in exp] == [1, 2]
    assert exp[1].via == "graph" and exp[1].relation == "table_context" and exp[1].from_chunk_id == 1


def test_document_filter():
    idx = RetrievalIndex([mk(1, "revenue figures", doc=1), mk(2, "revenue figures", doc=2)])
    hits = idx.search("revenue", document_ids=[2], graph_expansion=False)
    assert [h.chunk.document_id for h in hits] == [2]
    assert idx.search("", top_k=3) == []
