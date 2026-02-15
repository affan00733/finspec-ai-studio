# REST API (`/api/v1/`)

Django REST Framework. Browse locally at `http://localhost:8000/api/v1/` when the server is running.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health/` | Liveness |
| GET | `/provider-status/` | Mock / OpenAI / Azure availability (no secrets) |
| GET/POST | `/companies/` | Company catalog |
| GET/POST | `/documents/` | Documents (+ sections/chunks/reindex) |
| GET/POST | `/specifications/` | Business specs |
| GET/POST | `/prompts/` | Prompt templates & versions |
| POST | `/prompts/generate/` | Generate prompt from specification |
| GET | `/agents/` | Agent configurations |
| POST | `/retrieval/search/` | Hybrid / graph retrieval |
| POST | `/extractions/` | Start extraction |
| GET | `/runs/`, `/runs/{id}/` | Run status & results |
| POST | `/reviews/` | Analyst review actions |
| GET/POST | `/evaluations/` | Datasets, cases, runs |
| POST | `/chat/` | Research assistant |
| GET | `/graph/` | Relationship graph payload |
| GET | `/audit/` | Audit events |

## Auth & safety
- Public demo does not expose unrestricted paid LLM endpoints.  
- Live providers require backend configuration; unconfigured selection returns an explicit error (HTTP 409), not mock data.  
- Never send API keys from the browser.
