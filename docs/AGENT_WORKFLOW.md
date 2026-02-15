# Logical Agent Workflow

Stages are **logical responsibilities**, not necessarily separate autonomous LLM services.

| # | Stage | Typical implementation |
|---|--------|-------------------------|
| 1 | Specification Interpreter | Load catalog rules, synonyms, units |
| 2 | Prompt / Config Generator | Template (offline) or optional AI refine |
| 3 | Retrieval / Context Selector | Hybrid + optional graph expansion |
| 4 | Extraction Executor | Deterministic mock **or** live LLM |
| 5 | Validation | Spec-driven deterministic checks |
| 6 | Structured Result Formatter | JSON schema / typed result |
| 7 | Human Review Router | Queue needs-review / failed cases |
| 8 | Evaluation / Feedback Processor | Metrics, replay, promotion gates |

In the Agent Workflow Studio, analysts can inspect inputs/outputs, durations, logs, and safe configuration toggles. Required validation cannot be disabled on promoted configurations.
