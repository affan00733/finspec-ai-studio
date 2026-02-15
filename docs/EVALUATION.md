# Evaluation, Historical Replay & Promotion

## Dataset
Each case: company, report, metric, expected value/unit/period, expected evidence.

## Metrics (computed, not fabricated)
- Exact-match accuracy  
- Normalized numeric match  
- Evidence recall@K / retrieval hit rate  
- Validation failure rate  
- Missing-answer rate  
- Review workload  
- Duration (and estimated cost when a live provider reports usage)

## Baseline vs candidate
Compare runs and classify cases: improved · regressed · unchanged correct · unchanged incorrect · new failures.

## Historical replay
Select a candidate config → historical suite → inspect progress → compare to baseline → approve or reject.

The seeded demo includes a scenario where a candidate **fixes some cases but regresses others** (e.g. Scope 2 handling). Promotion is blocked when acceptance criteria fail — improving one example is not enough.

## Prompt lifecycle
`Draft → Candidate → Evaluation → Review → Approved → Production`  
Immutable version IDs; rollback supported; every extraction run records the version used.
