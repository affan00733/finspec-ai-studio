# FinSpec AI Studio

**Specification-Driven Financial Research Intelligence**

*From complex financial documents to explainable, analyst-verified intelligence.*

![License](https://img.shields.io/badge/license-MIT-blue)
![Demo Mode](https://img.shields.io/badge/demo-offline%20first-0ea5e9)
![Stack](https://img.shields.io/badge/stack-React%20%7C%20Django%20%7C%20TypeScript%20%7C%20Python-6366f1)

An independent, open-source financial research and AI engineering platform by **[Mohammed Afaan Ansari](https://afaanansari.com/)**.

It demonstrates the full AI application lifecycle for financial-document intelligence: ingestion → specification-driven prompts → hybrid / relationship-aware retrieval → structured extraction → deterministic validation → human review → evaluation → historical replay → controlled promotion.

> **Independent reconstruction.** This project is inspired by general financial-document AI engineering workflows from my professional experience. It is **not** affiliated with, endorsed by, or derived from any proprietary MSCI system, data, prompts, or code. All companies, figures, and reports in this repository are **synthetic and fictional**.

---

## Why this exists

Financial reports describe the same concepts with different words (*Revenue*, *Net Sales*, *Turnover*, *Operating Revenue*), units, currencies, and table layouts. Regex-only pipelines break under that variation. FinSpec AI Studio shows a production-style alternative:

1. **Business specifications** as the source of truth  
2. **Analyst-editable prompts and controls**  
3. **Hybrid + relationship-aware retrieval** (not just top-K vector search)  
4. **Deterministic validation and human review**  
5. **Evaluation and regression testing before promotion**

The LLM is only one component — and the public demo works **without any LLM API key**.

---

## Two execution modes

| Mode | When | What happens |
|------|------|--------------|
| **Demo / Mock (default)** | No API keys | Real local parsing, lexical retrieval, graph expansion, rule-based extraction, validation, evaluation |
| **Live AI** | OpenAI or Azure OpenAI configured on the **backend** | Same workflow with provider adapter; structured output + schema validation |

API keys never appear in browser code, Netlify builds, or public commits.

---

## Quick start — public-style offline demo (no Python required)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 → **Try Demo** or `/app/walkthrough`.

This is the same browser engine intended for Netlify: fully interactive on synthetic data, with session state in `localStorage` and a **Reset Demo** button.

---

## Full local stack (Django + React)

```bash
# Backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd backend
python manage.py migrate
python manage.py seed_demo
python manage.py runserver

# Frontend (new terminal) — point at the API
cd frontend
cp .env.example .env.local   # set VITE_API_URL=http://localhost:8000/api
npm install
npm run dev
```

Without `VITE_API_URL`, the UI stays in browser demo mode.

---

## Repository structure

```
finspec-ai-studio/
├── frontend/          # React + TypeScript + Vite (Netlify demo)
│   └── src/demo/      # Browser offline engine
├── backend/           # Django REST API + modular AI engine
│   ├── api/           # Models, views, serializers
│   └── engine/        # Retrieval, extraction, providers, eval
├── demo-data/         # Synthetic reports (md/html/txt) + dataset JSON
├── docs/              # Architecture & analyst docs
├── scripts/           # Dataset export utilities
├── netlify.toml
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Core capabilities

- **Specification catalog** — definitions, synonyms, units, validation rules, versions  
- **Prompt Studio** — template generation, structured analyst controls, versioning  
- **Hybrid retrieval** — BM25/lexical + optional embeddings + RRF + graph expansion  
- **Graph Explorer** — document → section → chunk → metric relationships  
- **Extraction Workbench** — structured results with source evidence  
- **Review Queue** — accept / reject / correct with audit trail  
- **Evaluation Lab** — baseline vs candidate, historical replay, regression gates  
- **Version Registry** — Draft → Candidate → Evaluation → Approved → Production  
- **Research Chat** — grounded Q&A with citations over the corpus  
- **Monitoring & audit** — run history, durations, failure categories  

---

## Synthetic dataset

Four fictional companies with distinct reporting vocabularies:

| Company | Ticker | Top-line label | Currency |
|---------|--------|----------------|----------|
| Northstar Energy | NSTR | Revenue | USD |
| Meridian Industrial | MRDN | Net sales | EUR |
| Cascade Retail | CSCD | Turnover | GBP |
| Atlas Materials | ATLS | Operating revenue | USD |

FY2022–FY2024 reports, 13 business specifications, ground-truth cases, and intentional hard cases (unit scale, missing disclosures, adjusted vs reported figures, conflicting passages).

Regenerate the browser dataset:

```bash
.venv/bin/python scripts/export_demo_dataset.py
```

---

## Tests

```bash
# Backend (80+ tests)
cd backend && pytest -q

# Frontend (50+ tests)
cd frontend && npm test -- --run

# Production build
cd frontend && npm run build
```

CI runs both suites via GitHub Actions (`.github/workflows/ci.yml`).

---

## Live demo

- **GitHub:** https://github.com/affan00733/finspec-ai-studio  
- **Live demo (Netlify):** https://finspec-ai-studio.netlify.app — open to everyone, no login, no API keys  

Anyone can reproduce the same demo locally with [docs/REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md).

## Deploy the free public demo (Netlify)

1. Repo: https://github.com/affan00733/finspec-ai-studio  
2. In Netlify: **Add new site → Import from Git** (or CLI deploy).  
3. Build settings are already in `netlify.toml` (`base=frontend`, publish `dist`).  
4. Do **not** set OpenAI/Azure keys in Netlify env vars for the public demo.  
5. Optional: set `VITE_API_URL` only if you also host a secured Django backend.

Visitors get a fully interactive demo with no accounts and no API keys.

---

## Enable live LLM providers (backend only)

Copy `.env.example` → `backend/.env`:

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

# Or Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT
AZURE_OPENAI_API_VERSION=2025-03-01-preview
```

Select the corresponding agent/provider in Settings. Failed paid calls do **not** silently fall back to mock output.

---

## Documentation

| Doc | Topic |
|-----|--------|
| [REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md) | Clone, verify, regenerate data, acceptance checks |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [RAG_DESIGN.md](docs/RAG_DESIGN.md) | Hybrid & relationship-aware retrieval |
| [AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) | Logical pipeline stages |
| [ANALYST_GUIDE.md](docs/ANALYST_GUIDE.md) | Non-technical walkthrough |
| [EVALUATION.md](docs/EVALUATION.md) | Metrics, replay, promotion gates |
| [API.md](docs/API.md) | REST endpoints |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Netlify, Render, local, Docker |
| [SECURITY.md](docs/SECURITY.md) | Keys, demo isolation, uploads |
| [DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md) | Why these choices |
| [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | 60–90s walkthrough |
| [PORTFOLIO.md](docs/PORTFOLIO.md) | Portfolio blurbs |

---

## Author

**Mohammed Afaan Ansari**  
Portfolio: [afaanansari.com](https://afaanansari.com/) · GitHub: [@affan00733](https://github.com/affan00733)

Related work: [rag-pipeline](https://github.com/affan00733/rag-pipeline) · [CSV-AI-EVADB](https://github.com/affan00733/CSV-AI-EVADB)

---

## License

MIT — see [LICENSE](LICENSE). Synthetic demo data is fictional and provided for demonstration only.
