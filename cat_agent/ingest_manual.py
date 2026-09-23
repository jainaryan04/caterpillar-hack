"""Build the Pinecone index for the machine manual. Run once (re-running replaces it).

    uv run ingest_manual.py

Steps: cut out the illustrations -> parse the PDF into chunks -> fit BM25 on
them -> embed with OpenAI -> create the Pinecone index if needed -> replace
the manual's vectors.
"""

import asyncio
import time

from pinecone import ServerlessSpec

import cat  # noqa: F401  (loads .env)
from cat.rag.images import IMAGES_DIR, extract_illustrations
from cat.rag.parse import parse_manual
from cat.rag.sparse import BM25
from cat.rag.store import BM25_PATH, EMBED_DIMENSION, MANUAL, get_store

EMBED_BATCH = 100
PRICE_PER_M_TOKENS = 0.02  # text-embedding-3-small


async def main():
    store = get_store()
    cfg = store._cfg

    if not MANUAL.pdf.exists():
        raise SystemExit(f"Manual PDF not found: {MANUAL.pdf}")
    images = extract_illustrations(MANUAL.pdf, IMAGES_DIR)
    print(f"Extracted {len(images)} illustrations -> {IMAGES_DIR.relative_to(IMAGES_DIR.parents[2])}")

    chunks = parse_manual(MANUAL.pdf, MANUAL.key)
    texts = [c.embedding_text(MANUAL.title) for c in chunks]
    print(f"Parsed {len(chunks)} chunks from {MANUAL.pdf.name}")

    bm25 = BM25().fit(texts)
    bm25.save(BM25_PATH)
    print(f"BM25 fitted: {len(bm25.doc_freq)} terms -> {BM25_PATH.name}")

    embeddings, tokens = [], 0
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        response = await store._openai.embeddings.create(model=cfg.embed_model, input=batch)
        embeddings += [item.embedding for item in response.data]
        tokens += response.usage.total_tokens
    print(f"Embedded {tokens:,} tokens with {cfg.embed_model} (~${tokens * PRICE_PER_M_TOKENS / 1e6:.4f})")

    pc = store._pinecone
    if not pc.has_index(cfg.pinecone_index):
        print(f"Creating Pinecone index '{cfg.pinecone_index}' (dotproduct, needed for hybrid search)...")
        pc.create_index(
            name=cfg.pinecone_index,
            dimension=EMBED_DIMENSION,
            metric="dotproduct",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
    index = store.index

    stats = index.describe_index_stats()
    if MANUAL.key in (stats.namespaces or {}):
        index.delete(delete_all=True, namespace=MANUAL.key)  # drop chunks from a previous parse

    vectors = [
        {
            "id": chunk.id,
            "values": embedding,
            "sparse_values": bm25.encode_document(text),
            "metadata": {
                "title": chunk.title,
                "section": chunk.section,
                "topic": chunk.topic,
                "subheading": chunk.subheading,
                "page": chunk.page,
                "page_end": chunk.page_end,
                "illustrations": chunk.illustrations,
                "text": chunk.text,
                "source": MANUAL.title,
            },
        }
        for chunk, text, embedding in zip(chunks, texts, embeddings)
    ]
    index.upsert(vectors=vectors, namespace=MANUAL.key, batch_size=100, show_progress=False)

    # Serverless indexes are eventually consistent: wait until the count shows up.
    for _ in range(30):
        count = (index.describe_index_stats().namespaces or {}).get(MANUAL.key)
        if count and count.vector_count == len(vectors):
            break
        time.sleep(1)
    print(f"Upserted {len(vectors)} vectors into '{cfg.pinecone_index}' namespace '{MANUAL.key}'")


if __name__ == "__main__":
    asyncio.run(main())
