# Synthetic demo data

All companies, figures, and narratives here are **fictional**. They exist only to exercise FinSpec AI Studio.

- `reports/` — Markdown, HTML, and plain-text annual reports (FY2022–FY2024) for four companies  
- `demo-dataset.json` — Bundled corpus export used by the browser demo (also mirrored under `frontend/src/data/`)  
- `INDEX.json` — File index  

Regenerate:

```bash
# Report files
.venv/bin/python -c "..."  # or re-run the export helpers in scripts/

# Browser dataset
.venv/bin/python scripts/export_demo_dataset.py
```

Do not replace this with confidential or proprietary filings.
