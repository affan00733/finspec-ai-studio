# Architecture

## Overview

FinSpec AI Studio is a two-tier system:

1. **Browser demo engine (TypeScript)** — default for Netlify and local UI without a server  
2. **Django REST backend + Python AI engine** — full local / optional hosted deployment  

```
┌─────────────────────────────────────────────────────────┐
│  React + TypeScript Analyst Studio                      │
│  Prompts · Agents · Graph · Chat · Evaluations          │
└───────────────────────────┬─────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌─────────────────────┐             ┌─────────────────────┐
│ Browser Demo Engine │             │ Django REST +       │
│ (bundled corpus)    │             │ Python AI Engine    │
└─────────────────────┘             └──────────┬──────────┘
                                               │
                                    ┌──────────┼──────────┐
                                    ▼          ▼          ▼
                                 Mock       OpenAI    Azure OpenAI
                              (default)   (optional)  (optional)
                                               │
                                    Evaluation · Feedback · Versioning
                                    Historical replay · Audit trail
```

## Design principles

- **Specification-driven** — extraction behavior comes from the business catalog, not ad-hoc prompts alone  
- **Explainable retrieval** — scores and relationship paths are visible  
- **Offline-first demo** — recruiters can use the product without credentials  
- **No silent provider fallback** — paid failures stay failed  
- **Analyst UX first** — technical knobs exist, but defaults and labels are plain language  

## Backend modules (`backend/engine/`)

| Module | Role |
|--------|------|
| `parsing.py` / `chunking.py` | Document normalize, sections, hierarchical chunks |
| `retrieval.py` | Lexical BM25-style search, RRF, filters, expansion |
| `extraction.py` | Deterministic structured extraction |
| `llm_extraction.py` | Live provider path with quote grounding |
| `validation.py` | Spec-linked checks |
| `prompts.py` | Template prompt generation |
| `evaluation.py` | Baseline/candidate compare, regression |
| `chat.py` | Grounded research assistant |
| `providers/` | Mock / OpenAI Responses / Azure adapters |

## Frontend modules (`frontend/src/`)

| Area | Role |
|------|------|
| `demo/` | Full offline pipeline mirroring the Python engine |
| `data/demo-dataset.json` | Bundled synthetic corpus |
| `lib/api.ts` | Backend client **or** demo service based on `VITE_API_URL` |
| `pages/` | All analyst surfaces (dashboard → settings) |

## Data flow (extraction)

```
Spec + company/year → Prompt/config → Retrieval (+ graph) → Context
  → Mock or LLM executor → Structured result → Validation
  → Review queue (if needed) → Evaluation corpus → Promotion gate
```

## Persistence

- **Browser demo:** `localStorage` (visitor-local; Reset Demo clears it)  
- **Django:** SQLite locally; PostgreSQL-compatible models for deployment  
- Ephemeral host filesystems are documented; durable public uploads are not assumed on free tiers  
