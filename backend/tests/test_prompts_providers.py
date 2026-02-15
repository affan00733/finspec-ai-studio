import json
from types import SimpleNamespace

import pytest

from engine import prompts as P
from engine.extraction import DeterministicExtractor
from engine.llm_extraction import LLMExtractor
from engine.providers import AzureOpenAIProvider, MockProvider, OpenAIProvider, get_provider, provider_statuses
from engine.providers.base import ProviderError, ProviderNotConfigured
from engine.specs import default_spec_defs

SPECS = {s.key: s for s in default_spec_defs()}


# ---------------------------------------------------------------- prompts

def test_render_template_and_undefined_variable():
    assert P.render_template("Hi {{ name }}!", {"name": "Bob"}) == "Hi Bob!"
    with pytest.raises(P.PromptError):
        P.render_template("Hi {{missing}}", {})
    assert P.template_variables("{{a}} {{b}} {{a}}") == ["a", "b"]


def test_generated_prompt_contains_spec_context_and_schema(make_index, corpus):
    d = corpus[3]  # Meridian 2022
    index, ctxs = make_index({0: d["text"]}, {0: d["fiscal_year"]})
    ex = DeterministicExtractor(index)
    hits = ex.retrieve(SPECS["net_sales"], 0)
    out = P.generate_extraction_prompt(SPECS["net_sales"], d["company"], d["fiscal_year"], hits)
    assert "<task spec_key=\"net_sales\"" in out["user"] and "Meridian Industrial" in out["user"]
    assert "Target fiscal year: 2022" in out["user"] and "<chunk id=" in out["user"]
    assert out["schema"]["required"] and out["schema"]["additionalProperties"] is False


# ---------------------------------------------------------------- providers

def test_registry_no_silent_fallback():
    with pytest.raises(ProviderNotConfigured) as e:
        get_provider("openai")
    assert "OPENAI_API_KEY" in str(e.value) and "No fallback" in str(e.value)
    with pytest.raises(ProviderNotConfigured):
        get_provider("azure")
    with pytest.raises(ProviderError):
        get_provider("nonsense")
    assert isinstance(get_provider("mock"), MockProvider)


def test_provider_status_never_leaks_keys(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-123")
    statuses = provider_statuses()
    assert json.dumps(statuses).count("sk-secret-123") == 0
    assert {s["name"] for s in statuses} == {"mock", "openai", "azure"}
    assert next(s for s in statuses if s["name"] == "openai")["configured"] is True


class FakeResponses:
    def __init__(self, payload=None, status="completed", exc=None):
        self.payload, self.status, self.exc, self.calls = payload, status, exc, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return SimpleNamespace(output_text=json.dumps(self.payload) if not isinstance(self.payload, str) else self.payload,
                               status=self.status, id="resp_1",
                               usage=SimpleNamespace(input_tokens=11, output_tokens=7, total_tokens=18))


def fake_client(**kw):
    return SimpleNamespace(responses=FakeResponses(**kw))


def test_openai_provider_uses_responses_api_with_json_schema():
    client = fake_client(payload={"answer": "ok", "citations": []})
    p = OpenAIProvider(api_key="k", client=client)
    r = p.generate("sys", "usr", json_schema=P.CHAT_SCHEMA, schema_name="chat", temperature=0.0)
    call = client.responses.calls[0]
    assert call["instructions"] == "sys" and call["input"] == "usr" and call["model"]
    assert call["text"]["format"]["type"] == "json_schema" and call["text"]["format"]["strict"] is True
    assert r.json() == {"answer": "ok", "citations": []} and r.usage["total_tokens"] == 18 and r.provider == "openai"


def test_azure_provider_uses_deployment_as_model():
    client = fake_client(payload={"x": 1})
    p = AzureOpenAIProvider(endpoint="https://e", api_key="k", deployment="my-deploy", client=client)
    p.generate("s", "u")
    assert client.responses.calls[0]["model"] == "my-deploy"
    assert AzureOpenAIProvider(endpoint="", api_key="", deployment="d").is_configured() is False


def test_provider_errors_are_wrapped_not_swallowed():
    p = OpenAIProvider(api_key="k", client=fake_client(exc=RuntimeError("boom")))
    with pytest.raises(ProviderError) as e:
        p.generate("s", "u")
    assert "boom" in str(e.value)
    p2 = OpenAIProvider(api_key="k", client=fake_client(payload="{}", status="incomplete"))
    with pytest.raises(ProviderError):
        p2.generate("s", "u")
    p3 = OpenAIProvider(api_key="k", client=fake_client(payload="not json"))
    with pytest.raises(ProviderError):
        p3.generate("s", "u").json()


# ---------------------------------------------------------------- LLM extraction grounding

def _setup(make_index, corpus, idx=0):
    d = corpus[idx]
    index, ctxs = make_index({0: d["text"]}, {0: d["fiscal_year"]})
    return d, index, ctxs[0]


def test_mock_llm_pipeline_matches_gold(make_index, corpus):
    d, index, ctx = _setup(make_index, corpus, 0)
    llm = LLMExtractor(index, MockProvider())
    for key in ("revenue", "operating_income", "scope_1", "total_assets", "net_sales"):
        o = llm.extract(SPECS[key], 0, ctx, d["company"])
        exp = d["gold"][key]
        assert (o.best.normalized if o.best else None) == exp, key


def test_llm_hallucinated_value_is_rejected(make_index, corpus):
    d, index, ctx = _setup(make_index, corpus, 0)
    first_chunk = next(h.chunk for h in DeterministicExtractor(index).retrieve(SPECS["revenue"], 0))
    # model claims a quote that is not in the excerpt
    payload = {"found": True, "value": "9,999.9", "currency": "USD", "unit_scale": "millions", "unit_label": None,
               "fiscal_year": 2022, "chunk_id": str(first_chunk.id), "quote": "| Revenue | 9,999.9 | 1.0 |",
               "confidence": 0.99, "rationale": "invented"}
    llm = LLMExtractor(index, OpenAIProvider(api_key="k", client=fake_client(payload=payload)))
    o = llm.extract(SPECS["revenue"], 0, ctx, d["company"])
    assert o.status == "rejected" and o.best is None and "not found verbatim" in o.rationale


def test_llm_value_not_in_quote_and_wrong_chunk_rejected(make_index, corpus):
    d, index, ctx = _setup(make_index, corpus, 0)
    real = DeterministicExtractor(index).extract(SPECS["revenue"], 0, ctx).best
    chunk = next(h.chunk for h in DeterministicExtractor(index).retrieve(SPECS["revenue"], 0)
                 if h.chunk.id == real.chunk_id)
    base = {"found": True, "currency": "USD", "unit_scale": "millions", "unit_label": None, "fiscal_year": 2022,
            "confidence": 0.9, "rationale": "r"}
    wrong_value = dict(base, value="1,234.5", chunk_id=str(chunk.id), quote=real.quote)
    o = LLMExtractor(index, OpenAIProvider(api_key="k", client=fake_client(payload=wrong_value))).extract(
        SPECS["revenue"], 0, ctx, d["company"])
    assert o.status == "rejected" and "does not appear" in o.rationale
    wrong_chunk = dict(base, value=real.raw_number, chunk_id="99999999", quote=real.quote)
    o = LLMExtractor(index, OpenAIProvider(api_key="k", client=fake_client(payload=wrong_chunk))).extract(
        SPECS["revenue"], 0, ctx, d["company"])
    assert o.status == "rejected" and "not among the retrieved" in o.rationale


def test_llm_accepts_grounded_value_and_document_overrides_wrong_unit(make_index, corpus):
    d, index, ctx = _setup(make_index, corpus, 0)
    real = DeterministicExtractor(index).extract(SPECS["revenue"], 0, ctx).best
    payload = {"found": True, "value": real.raw_number, "currency": "USD", "unit_scale": "billions",
               "unit_label": None, "fiscal_year": 2022, "chunk_id": str(real.chunk_id), "quote": real.quote,
               "confidence": 0.9, "rationale": "table row"}
    o = LLMExtractor(index, OpenAIProvider(api_key="k", client=fake_client(payload=payload))).extract(
        SPECS["revenue"], 0, ctx, d["company"])
    assert o.status == "found" and o.best.normalized == d["gold"]["revenue"]  # millions per the document, not billions
    assert any("unit_overridden_by_document" in n for n in o.best.notes)


def test_llm_provider_failure_propagates_no_fallback(make_index, corpus):
    d, index, ctx = _setup(make_index, corpus, 0)
    llm = LLMExtractor(index, OpenAIProvider(api_key="k", client=fake_client(exc=RuntimeError("rate limited"))))
    with pytest.raises(ProviderError):
        llm.extract(SPECS["revenue"], 0, ctx, d["company"])
