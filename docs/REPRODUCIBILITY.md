# Reproducibility Guide

This document explains how anyone can reproduce FinSpec AI Studio locally and verify the public demo.

## What is reproducible

| Artifact | How it is fixed |
|----------|-----------------|
| Synthetic companies & reports | Deterministic generator in `backend/engine/demo_corpus.py` (seeded RNG) |
| Browser demo corpus | `frontend/src/data/demo-dataset.json` exported by `scripts/export_demo_dataset.py` |
| Demo report files | `demo-data/reports/*` (md / html / txt) |
| Offline extraction | Same deterministic rules in Python (`backend/engine/`) and TypeScript (`frontend/src/demo/`) |
| Seeded evaluation / regression story | Built into demo seed + browser demo state |
| CI | `.github/workflows/ci.yml` runs frontend + backend tests on every push |

All companies and figures are **fictional**. No proprietary filings are included.

## Prerequisites

- **Node.js** 22+ (frontend / Netlify demo)
- **Python** 3.11+ (full local backend; optional for the public demo)
- Git

No OpenAI or Azure keys are required for the default Demo / Mock Mode.

## 1. Clone

```bash
git clone https://github.com/affan00733/finspec-ai-studio.git
cd finspec-ai-studio
```

## 2. Reproduce the public demo (browser only)

This matches the Netlify deployment: no Python, no API keys.

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173 → **Try the demo** or `/app/walkthrough`.

Verify:

```bash
npm test -- --run
npm run build
```

Expected: all frontend tests pass; `dist/` builds successfully.

Reset visitor state anytime with **Reset Demo** in the UI.

## 3. Regenerate the bundled dataset (optional)

```bash
# from repo root, with Python 3.11 venv
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/export_demo_dataset.py
```

This rewrites `frontend/src/data/demo-dataset.json` from the same generator used by the backend.

## 4. Reproduce the full Django stack

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd backend
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

In another terminal:

```bash
cd frontend
cp .env.example .env.local
# set: VITE_API_URL=http://localhost:8000/api
npm ci
npm run dev
```

Without `VITE_API_URL`, the UI stays in browser Demo Mode.

Backend tests:

```bash
cd backend
pytest -q
```

## 5. Acceptance checks (offline)

These should work with **no API keys**:

1. Extract **Northstar Energy · FY2024 · Revenue** → value + evidence quote  
2. Retrieval Explorer → basic top-K vs relationship-aware expansion  
3. Prompt Studio → structured control change affects validation/extraction  
4. Review Queue → correct a value with a real quote; see history  
5. Evaluation Lab → candidate improves some cases, regresses others; promotion blocked  
6. Chat → grounded answer with citation; unsupported → insufficient evidence  

Guided path: `/app/walkthrough`.

## 6. Live LLM mode (optional, not required)

Copy `.env.example` → `backend/.env`, set OpenAI or Azure variables, restart Django, select the provider in Settings.

Paid failures must **not** silently fall back to mock output.

## 7. Public Netlify demo

- **Live URL:** https://finspec-ai-studio.netlify.app  
- Config: `netlify.toml` (`base=frontend`, `npm ci && npm run build`, SPA redirect)  
- No backend URL or API keys in Netlify for the public site  
- Anyone with the live URL can use the demo without an account  

See also: [DEPLOYMENT.md](DEPLOYMENT.md), [SECURITY.md](SECURITY.md).

## Version pin summary

- Frontend: see `frontend/package.json` / lockfile  
- Backend: see root `requirements.txt`  
- Node for Netlify: `22` (set in `netlify.toml`)  
- Python for local API: `3.11` (`.python-version`)  
