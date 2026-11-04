# Portfolio Copy

## Short description (card)

**FinSpec AI Studio** — Specification-driven financial research intelligence: hybrid retrieval, analyst prompt studio, human review, and regression-gated evaluation. Fully interactive offline demo (no API keys). React + Django.

## Longer technical description

FinSpec AI Studio is an open-source platform for extracting structured financial metrics from heterogeneous reports. Business specifications drive prompt generation, validation, and retrieval filters. A hybrid lexical + relationship-aware retrieval layer surfaces table evidence and adjacent interpretive notes. Analysts edit configurations, inspect evidence, correct results in a review queue, and run historical replays that block promotion when regressions appear. The public Netlify demo runs entirely in the browser on a synthetic corpus; a Django backend adds persistence and optional OpenAI / Azure OpenAI providers without exposing keys to the client.

This is an independent reconstruction inspired by production financial-document AI engineering experience — not affiliated with any employer’s proprietary systems.

## Feature bullets
- Specification-driven financial data extraction  
- Hybrid and relationship-aware RAG with explainable scores  
- Traceable source evidence and citations  
- Editable prompt & agent configurations  
- Analyst review and feedback loop  
- Evaluation + historical regression testing  
- OpenAI / Azure integration (backend-only)  
- Offline interactive demo for recruiters  

## Links
- Live Demo: https://finspec-ai-studio.netlify.app  
- GitHub: https://github.com/affan00733/finspec-ai-studio  
- Architecture: `/docs/ARCHITECTURE.md`  
- Documentation: `/docs/`  
- Reproducibility: `/docs/REPRODUCIBILITY.md`
