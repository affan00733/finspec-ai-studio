"""Offline hybrid retrieval: BM25 + lexical coverage, fused with RRF, then
expanded over the chunk relationship graph.

No network, no embeddings: results are fully deterministic.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from .types import ChunkRef

STOPWORDS = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was were will with".split()
)
_TOKEN_RE = re.compile(r"[a-z0-9]+(?:[.&][a-z0-9]+)*")


def tokenize(text: str) -> list[str]:
    toks = []
    for t in _TOKEN_RE.findall(text.lower().replace("&", " & ")):
        t = t.replace("&", "")
        if not t or t in STOPWORDS:
            continue
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        toks.append(t)
    return toks


@dataclass
class Hit:
    chunk: ChunkRef
    score: float
    rank: int
    via: str = "direct"  # direct | graph
    scores: dict = field(default_factory=dict)
    from_chunk_id: Any = None
    relation: Optional[str] = None

    def to_dict(self, include_text: bool = True) -> dict:
        d = {
            "chunk_id": self.chunk.id,
            "document_id": self.chunk.document_id,
            "index": self.chunk.index,
            "heading": self.chunk.heading,
            "chunk_type": self.chunk.chunk_type,
            "score": round(self.score, 6),
            "rank": self.rank,
            "via": self.via,
            "scores": {k: round(v, 6) for k, v in self.scores.items()},
            "from_chunk_id": self.from_chunk_id,
            "relation": self.relation,
            "start_char": self.chunk.start_char,
            "end_char": self.chunk.end_char,
        }
        if include_text:
            d["text"] = self.chunk.text
        return d


class RetrievalIndex:
    """In-memory index over chunks (possibly from multiple documents)."""

    K1 = 1.5
    B = 0.75
    RRF_K = 60

    def __init__(self, chunks: Iterable[ChunkRef], edges: Iterable[tuple[Any, Any, str, float]] = ()):
        self.chunks: list[ChunkRef] = list(chunks)
        self.by_id = {c.id: c for c in self.chunks}
        self.adj: dict[Any, list[tuple[Any, str, float]]] = defaultdict(list)
        for s, t, rel, w in edges:
            if s in self.by_id and t in self.by_id:
                self.adj[s].append((t, rel, w))
        self._tf: list[Counter] = []
        self._len: list[int] = []
        self._phrase_text: list[str] = []
        df: Counter = Counter()
        for c in self.chunks:
            toks = tokenize(c.text) + tokenize(c.heading) * 2 + tokenize(c.meta.get("caption", "")) * 2
            tf = Counter(toks)
            self._tf.append(tf)
            self._len.append(sum(tf.values()))
            self._phrase_text.append(" ".join(tokenize(c.text + " " + c.heading)))
            df.update(tf.keys())
        n = len(self.chunks)
        self.n = n
        self.avgdl = (sum(self._len) / n) if n else 0.0
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}

    # ------------------------------------------------------------------ scorers
    def _bm25(self, q_terms: list[str]) -> list[float]:
        scores = [0.0] * self.n
        for i, tf in enumerate(self._tf):
            dl = self._len[i] or 1
            s = 0.0
            for t in set(q_terms):
                f = tf.get(t, 0)
                if not f:
                    continue
                idf = self.idf.get(t, 0.0)
                s += idf * (f * (self.K1 + 1)) / (f + self.K1 * (1 - self.B + self.B * dl / (self.avgdl or 1)))
            scores[i] = s
        return scores

    def _lexical(self, q_terms: list[str], phrases: list[str]) -> list[float]:
        uniq = list(dict.fromkeys(q_terms))
        total_idf = sum(self.idf.get(t, 0.0) for t in uniq) or 1.0
        scores = [0.0] * self.n
        for i, tf in enumerate(self._tf):
            covered = sum(self.idf.get(t, 0.0) for t in uniq if t in tf)
            s = covered / total_idf
            ptxt = self._phrase_text[i]
            for ph in phrases:
                if ph and ph in ptxt:
                    s += 0.5
                    break
            if self.chunks[i].chunk_type == "table" and s > 0:
                s += 0.05
            scores[i] = s
        return scores

    @staticmethod
    def _rank(scores: list[float]) -> list[int]:
        order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))
        return [i for i in order if scores[i] > 0]

    # ------------------------------------------------------------------ search
    def search(
        self,
        query: str,
        top_k: int = 8,
        mode: str = "hybrid",
        graph_expansion: bool = True,
        expansion_decay: float = 0.5,
        max_expansion: Optional[int] = None,
        extra_phrases: Iterable[str] = (),
        document_ids: Optional[Iterable[Any]] = None,
    ) -> list[Hit]:
        if not self.chunks or not query.strip():
            return []
        if mode not in ("hybrid", "bm25", "lexical"):
            raise ValueError(f"Unknown retrieval mode: {mode}")
        allowed = set(document_ids) if document_ids is not None else None
        q_terms = tokenize(query)
        phrases = [" ".join(tokenize(p)) for p in [query, *extra_phrases]]
        phrases = [p for p in phrases if p]
        bm = self._bm25(q_terms)
        lx = self._lexical(q_terms, phrases)
        if allowed is not None:
            for i, c in enumerate(self.chunks):
                if c.document_id not in allowed:
                    bm[i] = 0.0
                    lx[i] = 0.0
        rank_bm = self._rank(bm)
        rank_lx = self._rank(lx)
        fused: dict[int, float] = defaultdict(float)
        if mode in ("hybrid", "bm25"):
            for r, i in enumerate(rank_bm):
                fused[i] += 1.0 / (self.RRF_K + r + 1)
        if mode in ("hybrid", "lexical"):
            for r, i in enumerate(rank_lx):
                fused[i] += 1.0 / (self.RRF_K + r + 1)
        ordered = sorted(fused, key=lambda i: (-fused[i], i))[:top_k]
        hits: list[Hit] = []
        for r, i in enumerate(ordered):
            hits.append(
                Hit(self.chunks[i], fused[i], r + 1, "direct",
                    {"bm25": bm[i], "lexical": lx[i], "rrf": fused[i]})
            )
        if graph_expansion and hits:
            hits.extend(self._expand(hits, expansion_decay, max_expansion if max_expansion is not None else top_k, allowed))
        for r, h in enumerate(hits):
            h.rank = r + 1
        return hits

    def _expand(self, seeds: list[Hit], decay: float, limit: int, allowed: Optional[set]) -> list[Hit]:
        seen = {h.chunk.id for h in seeds}
        cands: dict[Any, Hit] = {}
        for h in seeds:
            for tid, rel, w in self.adj.get(h.chunk.id, ()):
                if tid in seen:
                    continue
                tgt = self.by_id[tid]
                if allowed is not None and tgt.document_id not in allowed:
                    continue
                score = h.score * w * decay
                prev = cands.get(tid)
                if prev is None or score > prev.score:
                    cands[tid] = Hit(tgt, score, 0, "graph", {"rrf": score}, h.chunk.id, rel)
        ranked = sorted(cands.values(), key=lambda x: (-x.score, x.chunk.index))
        return ranked[:limit]
