"""Hybrid search over the manual in Pinecone.

One Pinecone index (metric=dotproduct) holds, for every chunk:
  - a dense vector:  OpenAI text-embedding-3-small (meaning)
  - a sparse vector: BM25 from sparse.py (exact keywords)

At query time both halves are weighted by alpha and sent in a single request,
so hybrid search costs one round trip:
    score = alpha * dense_similarity + (1 - alpha) * keyword_score
"""

import asyncio
import time
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from loguru import logger
from openai import AsyncOpenAI
from pinecone import AsyncPinecone, Pinecone

from cat.config import Config, load_config
from cat.rag.sparse import BM25, tokenize

MANUALS_DIR = Path(__file__).resolve().parents[2] / "data" / "manuals"
BM25_PATH = MANUALS_DIR / "bm25.json"
EMBED_DIMENSION = 1536  # text-embedding-3-small
PREFETCH_MIN_OVERLAP = 0.6  # share of the question's words that must be in the transcript
PREFETCH_MAX_AGE_SECS = 20
# Normal calls take ~0.3-0.45s, but now and then a connection stalls for seconds.
# After HEDGE_AFTER_SECS a backup request is sent and whichever answers first wins.
HEDGE_AFTER_SECS = 1.0
REQUEST_TIMEOUT_SECS = 4.0


async def hedged(make_call, what: str, after: float = HEDGE_AFTER_SECS):
    """Run make_call(); if it takes longer than `after` seconds, race a second copy against it."""
    tasks = [asyncio.ensure_future(make_call())]
    try:
        done, _ = await asyncio.wait(tasks, timeout=after)
        if not done:
            logger.debug(f"{what} slow (>{after}s), sending a backup request")
            tasks.append(asyncio.ensure_future(make_call()))
        pending, error = set(tasks), None
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task.exception() is None:
                    return task.result()
                error = task.exception()
        raise error
    finally:
        # Runs on success, failure, and when the caller is cancelled (e.g. the
        # operator interrupts): stop leftover requests and swallow their errors,
        # so nothing logs "Task exception was never retrieved" later.
        for task in tasks:
            task.cancel()
            task.add_done_callback(lambda t: t.cancelled() or t.exception())


@dataclass(frozen=True)
class Manual:
    key: str  # also the Pinecone namespace
    title: str
    pdf: Path


MANUAL = Manual(
    key="cat320d",
    title="Cat 320D Excavator Operation and Maintenance Manual (SEBU8053-20)",
    pdf=MANUALS_DIR / "cat-320d-omm-SEBU8053-20.pdf",
)


@dataclass
class Passage:
    title: str
    page: int
    page_end: int
    text: str
    score: float
    illustrations: list[str]

    def pages(self) -> str:
        return f"page {self.page}" if self.page == self.page_end else f"pages {self.page}-{self.page_end}"


class ManualStore:
    def __init__(self, cfg: Config):
        self._cfg = cfg
        self._openai = AsyncOpenAI(api_key=cfg.openai_api_key, timeout=REQUEST_TIMEOUT_SECS, max_retries=1)
        self._pinecone = Pinecone(api_key=cfg.pinecone_api_key)
        self._index = None  # sync client: ingest only
        self._query_index = None  # async client: used in the voice loop
        self._bm25: BM25 | None = None
        self._prefetched: tuple[str, float, asyncio.Task] | None = None
        self._last_warmed = 0.0

    @property
    def index(self):
        if self._index is None:
            self._index = self._pinecone.Index(name=self._cfg.pinecone_index)
        return self._index

    async def _async_index(self):
        # Native async client: a thread-pool call competes with Pipecat's audio
        # threads and was ~1s slower inside the voice loop.
        if self._query_index is None:
            client = AsyncPinecone(api_key=self._cfg.pinecone_api_key, timeout=REQUEST_TIMEOUT_SECS)
            self._query_index = await client.index(name=self._cfg.pinecone_index)
        return self._query_index

    @property
    def bm25(self) -> BM25:
        if self._bm25 is None:
            if not BM25_PATH.exists():
                raise RuntimeError("Manual index not built yet. Run: uv run ingest_manual.py")
            self._bm25 = BM25.load(BM25_PATH)
        return self._bm25

    async def embed(self, texts: list[str]) -> list[list[float]]:
        response = await self._openai.embeddings.create(model=self._cfg.embed_model, input=texts)
        return [item.embedding for item in response.data]

    async def search(self, query: str, top_k: int | None = None, alpha: float | None = None) -> list[Passage]:
        top_k = top_k or self._cfg.rag_top_k
        alpha = self._cfg.rag_alpha if alpha is None else alpha
        t0 = time.perf_counter()

        dense = (await hedged(lambda: self.embed([query]), "embedding"))[0]
        t_embed = time.perf_counter()
        sparse = self.bm25.encode_query(query)

        dense = [v * alpha for v in dense]
        sparse_vector = None
        if sparse["indices"] and alpha < 1:
            sparse_vector = {"indices": sparse["indices"], "values": [v * (1 - alpha) for v in sparse["values"]]}

        index = await self._async_index()
        response = await hedged(
            lambda: index.query(
                vector=dense,
                sparse_vector=sparse_vector,
                top_k=top_k,
                namespace=MANUAL.key,
                include_metadata=True,
            ),
            "pinecone query",
        )
        t_query = time.perf_counter()
        logger.debug(
            f"manual search: embed {1000 * (t_embed - t0):.0f}ms, pinecone {1000 * (t_query - t_embed):.0f}ms"
        )

        return [
            Passage(
                title=m.metadata["title"],
                page=int(m.metadata["page"]),
                page_end=int(m.metadata["page_end"]),
                text=m.metadata["text"],
                score=m.score,
                illustrations=list(m.metadata.get("illustrations", [])),
            )
            for m in response.matches
        ]

    def warm_connections(self) -> None:
        """Re-open the OpenAI and Pinecone connections while the operator is still talking.

        HTTP clients drop idle connections after ~5s, and a fresh TCP + TLS
        handshake to the US costs ~0.8s. Two free requests (model info, index
        stats) at the start of each utterance make the search reuse a warm one.
        """
        if time.monotonic() - self._last_warmed < 3:
            return
        self._last_warmed = time.monotonic()

        async def ping():
            index = await self._async_index()
            await asyncio.gather(
                self._openai.models.retrieve(self._cfg.embed_model),
                index.describe_index_stats(),
                return_exceptions=True,  # best effort
            )

        asyncio.get_running_loop().create_task(ping())

    def prefetch(self, transcript: str) -> None:
        """Start searching with what the operator just said, before the LLM decides to call the tool.

        The voice LLM takes ~0.4s to decide it needs the manual; the search
        (~0.7s, mostly network) runs during that time instead of after it.
        """
        if len(tokenize(transcript)) < 2:
            return  # "hi", "thanks": not worth a lookup
        if self._prefetched:
            self._prefetched[2].cancel()  # the previous turn's search is no longer needed
        task = asyncio.get_running_loop().create_task(self.search(transcript))
        task.add_done_callback(lambda t: t.cancelled() or t.exception())  # silence "never retrieved" warnings
        self._prefetched = (transcript, time.monotonic(), task)

    async def search_for_question(self, question: str) -> list[Passage]:
        """Search, reusing the prefetched results when the question matches what was just said."""
        prefetched, self._prefetched = self._prefetched, None
        if prefetched:
            transcript, started, task = prefetched
            said = set(tokenize(transcript))
            overlap = len(said & set(tokenize(question))) / max(len(said), 1)
            # The LLM usually keeps the operator's words and adds some ("... on the
            # Cat 320D excavator"), so check the operator's words are all still there.
            # A follow-up like "and the other one?" gets rewritten with different
            # words, so low overlap -> search again with the rewritten question.
            if overlap >= PREFETCH_MIN_OVERLAP and time.monotonic() - started < PREFETCH_MAX_AGE_SECS:
                try:
                    passages = await task
                    logger.debug(f"manual search: reused prefetch (overlap {overlap:.0%})")
                    return passages
                except Exception as e:
                    logger.warning(f"Prefetched manual search failed, retrying: {e}")
            else:
                task.cancel()
        return await self.search(question)

    async def warm_up(self) -> None:
        """Open the OpenAI and Pinecone connections early so the first question isn't slow."""
        try:
            await self.search("hydraulic lockout", top_k=1)
            logger.info("Manual search ready")
        except Exception as e:  # never block the voice loop on this
            logger.warning(f"Manual search warm-up failed: {e}")


@cache
def get_store() -> ManualStore:
    return ManualStore(load_config())


def format_passages(passages: list[Passage]) -> str:
    """Passages as the plain-text block the specialist agent reads."""
    return "\n\n".join(f"[{p.title}, {p.pages()}]\n{p.text}" for p in passages)
