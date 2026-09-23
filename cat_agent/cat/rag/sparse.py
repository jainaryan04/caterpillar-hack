"""BM25 keyword vectors for the sparse half of hybrid search.

Embeddings match meaning ("the thing that stops the machine beeping when I
reverse"); BM25 matches exact words ("AEC", "quick coupler", "SMCS"). Pinecone
stores both per chunk and adds the two scores.

Runs locally (fit once at ingest, ~1ms per query), so it adds no network call.
Token ids are a stable hash of the word, so the same word always maps to the
same sparse dimension.
"""

import json
import math
import re
import zlib
from collections import Counter
from pathlib import Path

_WORD = re.compile(r"[a-z0-9]+")
_STOPWORDS = set(
    "a an and are as at be by can do does for from how i in is it its me my of on or should "
    "that the their then there these this to up what when where which while who why will with "
    "you your this into if not no so than too very".split()
)


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3 and not word.endswith("ss"):
            return word[: -len(suffix)]
    return word


def tokenize(text: str) -> list[str]:
    return [_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOPWORDS]


def _index(token: str) -> int:
    return zlib.crc32(token.encode())


class BM25:
    def __init__(self, k1: float = 1.2, b: float = 0.75):
        self.k1, self.b = k1, b
        self.doc_freq: dict[str, int] = {}
        self.n_docs = 0
        self.avg_len = 0.0

    def fit(self, texts: list[str]) -> "BM25":
        df = Counter()
        total = 0
        for text in texts:
            tokens = tokenize(text)
            total += len(tokens)
            df.update(set(tokens))
        self.doc_freq, self.n_docs = dict(df), len(texts)
        self.avg_len = total / max(len(texts), 1)
        return self

    def encode_document(self, text: str) -> dict:
        tokens = tokenize(text)
        tf = Counter(tokens)
        norm = self.k1 * (1 - self.b + self.b * len(tokens) / self.avg_len)
        weights = {_index(t): n * (self.k1 + 1) / (n + norm) for t, n in tf.items()}
        return {"indices": list(weights), "values": list(weights.values())}

    def encode_query(self, text: str) -> dict:
        weights: dict[int, float] = {}
        for t in set(tokenize(text)):
            df = self.doc_freq.get(t, 0)
            if df == 0:
                continue  # word never appears in the manual: can't match anything
            weights[_index(t)] = math.log((self.n_docs - df + 0.5) / (df + 0.5) + 1)
        total = sum(weights.values()) or 1.0
        return {"indices": list(weights), "values": [w / total for w in weights.values()]}

    def save(self, path: Path) -> None:
        state = {"k1": self.k1, "b": self.b, "n_docs": self.n_docs, "avg_len": self.avg_len, "doc_freq": self.doc_freq}
        path.write_text(json.dumps(state), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "BM25":
        state = json.loads(path.read_text(encoding="utf-8"))
        bm25 = cls(state["k1"], state["b"])
        bm25.n_docs, bm25.avg_len, bm25.doc_freq = state["n_docs"], state["avg_len"], state["doc_freq"]
        return bm25
