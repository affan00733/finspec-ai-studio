import os

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

# Tests must never touch paid providers or the network.
for var in ("OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"):
    os.environ.pop(var, None)


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    """Seed the demo corpus once; individual tests run inside rolled-back transactions."""
    with django_db_blocker.unblock():
        call_command("seed_demo", "--no-run", verbosity=0)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def corpus():
    from engine.demo_corpus import build_corpus

    return build_corpus()


@pytest.fixture
def make_index():
    """Build an in-memory engine index (no DB) from raw document texts."""
    from engine import chunking, parsing, retrieval
    from engine.types import ChunkRef

    def _make(texts: dict, fiscal_years: dict | None = None):
        refs, edges, ctxs = [], [], {}
        for di, text in texts.items():
            text = parsing.normalize_text(text)
            secs = parsing.detect_sections(text)
            chs, rels = chunking.chunk_document(text, secs)
            refs += [ChunkRef(id=(di, c.index), document_id=di, index=c.index, text=c.text, start_char=c.start,
                              end_char=c.end, chunk_type=c.chunk_type, heading=c.heading, meta=c.meta) for c in chs]
            edges += [((di, r.source), (di, r.target), r.relation, r.weight) for r in rels]
            ctxs[di] = parsing.detect_context(text, (fiscal_years or {}).get(di))
        return retrieval.RetrievalIndex(refs, edges), ctxs

    return _make
