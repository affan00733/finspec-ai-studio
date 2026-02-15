# Design Decisions

1. **Django + DRF** — matches analyst-facing production API patterns; modular `engine/` stays usable outside Django.  
2. **Offline-first public demo** — portfolio visitors get a real workflow without keys or a sleeping free-tier backend.  
3. **Dual engines (TS + Python)** — parity-tested deterministic extraction so Netlify and local backend agree.  
4. **Specification catalog** — single source of truth for synonyms, units, validation, and prompts.  
5. **Relationship-aware retrieval without full GraphRAG** — understandable graph expansion; avoids heavy indexing costs for a free demo.  
6. **Structured controls vs free-form prompts** — free-form edits matter in live LLM mode; mock mode documents the limitation honestly.  
7. **Regression-first evaluation** — promotion gated when a candidate improves some cases but hurts others.  
8. **Synthetic-only data** — no confidential filings; clear fictional branding.  
9. **Configurable model IDs** — avoid hardcoding brittle deployment names.  
10. **Optional Celery** — real async path available; sync fallback is honest about not being distributed compute.  
