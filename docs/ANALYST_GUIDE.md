# Analyst Guide

You do not need to know Python, embeddings, or prompt engineering to use FinSpec AI Studio.

## Guided path

**Choose data point → Select reports → Review specification → Generate prompt → Run extraction → Inspect evidence → Validate → Review → Save**

## Plain-language controls

| You see | Means |
|---------|--------|
| How many relevant passages? | `top_k` |
| How much should adjacent sections share? | chunk overlap |
| Prioritize tables | Prefer tabular evidence |
| Require reporting-year match | Reject wrong-year hits |
| Require citations | Evidence mandatory for acceptance |

Presets: **Fast** · **Balanced** · **Thorough**.

## Demo / Mock Mode

Outputs are produced by offline deterministic logic over the synthetic corpus.  
They are **not** GPT answers. Free-form prompt text is editable for realism, but in mock mode only **structured controls** change behavior (the UI explains this).

## Suggested first run

1. Open **Try Demo** / Walkthrough  
2. Extract **Northstar Energy · FY2024 · Revenue**  
3. Open evidence and Retrieval Explorer  
4. Toggle relationship-aware vs basic top-K  
5. Visit Evaluation Lab for the regression story  
6. Ask Chat: “What was Northstar Energy's FY2024 revenue?”  
