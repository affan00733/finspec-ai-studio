# RAG Design — Hybrid & Relationship-Aware Retrieval

## What this is (and is not)

This is a transparent, maintainable hybrid retrieval stack with a **document-structure graph**.  
It is **not** a claim to reimplement Microsoft GraphRAG or any proprietary search system.

## Pipeline

### 1. Ingestion
Preserve company, year, report type, headings, table vs narrative chunks, offsets.

### 2. Hierarchical chunking
Chunks keep parent section, prev/next neighbors, heading path, and type (`table` | `narrative`).

### 3. Hybrid retrieval modes
1. **Lexical** — BM25 / TF-IDF style term scoring (always available)  
2. **Semantic** — optional embeddings when installed (backend); otherwise clearly falls back to lexical  
3. **Hybrid** — Reciprocal Rank Fusion over ranked lists  
4. **Hybrid + relationship expansion** — expand one/two hops along the graph  

### 4. Graph nodes & edges
Derived only from structure and explainable rules:

- Company → Report → Period  
- Section → Chunk; Chunk → next Chunk  
- Table ↔ explanatory note  
- Chunk mentions metric (rule-based)  

Never invent decorative edges.

### 5. Expansion examples
- Table hit → adjacent footnote / interpretation paragraph  
- Metric mention → related definition subsection  
- CapEx table → cash-flow note  

Expansion is budgeted (hop limit + token/context budget).

### 6. Ranking signals
Lexical · (optional) semantic · relationship · specification match · metadata filters · evidence completeness.  
UI distinguishes raw vs combined scores.

### 7. Evidence UI
Each hit shows rank, score, document metadata, text, match highlights, relationship path, and whether it entered final context.  
**Compare basic top-K vs relationship-aware** side by side.

## Offline demo note

The browser engine implements lexical + graph expansion over the bundled corpus so the public demo stays interactive without embeddings or paid APIs.
