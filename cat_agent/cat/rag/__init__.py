"""Manual RAG: parse the Cat operation manual, index it in Pinecone, search it.

    parse.py   PDF -> chunks (one per topic / per control), with page metadata
    sparse.py  local BM25 keyword vectors (the "sparse" half of hybrid search)
    store.py   OpenAI embeddings + Pinecone hybrid query

Build the index once with `uv run ingest_manual.py`.
"""
