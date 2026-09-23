"""Runtime configuration, read from environment variables / .env."""

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value else default


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set. Add it to cat_agent/.env (see .env.example).")
    return value


# OpenAI-compatible endpoints for each LLM provider. The Agents SDK specialists
# reuse these, so the voice loop and specialists always run on the same provider.
LLM_BASE_URLS = {
    "cerebras": "https://api.cerebras.ai/v1",
    "openai": "https://api.openai.com/v1",
}

LLM_DEFAULT_MODELS = {
    "cerebras": "gpt-oss-120b",
    "openai": "gpt-4o-mini",
}

LLM_KEY_VARS = {
    "cerebras": "CEREBRAS_API_KEY",
    "openai": "OPENAI_API_KEY",
}


@dataclass(frozen=True)
class Config:
    # Speech-to-text: Deepgram
    deepgram_api_key: str
    stt_model: str

    # LLM: "cerebras" (fast) or "openai" (fallback)
    llm_provider: str
    llm_api_key: str
    llm_base_url: str
    llm_model: str

    # Text-to-speech: "deepgram" or "cartesia"
    tts_provider: str
    tts_api_key: str
    tts_voice: str

    # Silero VAD (local) and barge-in
    allow_interruptions: bool
    vad_confidence: float
    vad_start_secs: float
    vad_stop_secs: float
    vad_min_volume: float

    # Manual RAG: OpenAI embeddings + Pinecone hybrid (dense + BM25) search
    openai_api_key: str
    pinecone_api_key: str
    pinecone_index: str
    embed_model: str
    rag_top_k: int
    rag_alpha: float  # 1.0 = meaning only, 0.0 = keywords only
    show_images_locally: bool  # open manual pictures on this computer too
    echo_guard: bool  # ignore Cat's own voice coming back through laptop speakers


def load_config() -> Config:
    llm_provider = os.getenv("CAT_LLM_PROVIDER", "cerebras").lower()
    if llm_provider not in LLM_BASE_URLS:
        raise RuntimeError(f"CAT_LLM_PROVIDER must be one of {list(LLM_BASE_URLS)}")

    tts_provider = os.getenv("CAT_TTS_PROVIDER", "deepgram").lower()
    if tts_provider == "deepgram":
        tts_api_key = _require("DEEPGRAM_API_KEY")
        default_voice = "aura-2-helena-en"
    elif tts_provider == "cartesia":
        tts_api_key = _require("CARTESIA_API_KEY")
        default_voice = "86e30c1d-714b-4074-a1f2-1cb6b552fb49"
    else:
        raise RuntimeError("CAT_TTS_PROVIDER must be 'deepgram' or 'cartesia'")

    return Config(
        deepgram_api_key=_require("DEEPGRAM_API_KEY"),
        stt_model=os.getenv("CAT_STT_MODEL", "nova-3-general"),
        llm_provider=llm_provider,
        llm_api_key=_require(LLM_KEY_VARS[llm_provider]),
        llm_base_url=LLM_BASE_URLS[llm_provider],
        llm_model=os.getenv("CAT_LLM_MODEL", LLM_DEFAULT_MODELS[llm_provider]),
        tts_provider=tts_provider,
        tts_api_key=tts_api_key,
        tts_voice=os.getenv("CAT_TTS_VOICE", default_voice),
        allow_interruptions=_env_bool("CAT_ALLOW_INTERRUPTIONS", True),
        vad_confidence=_env_float("CAT_VAD_CONFIDENCE", 0.7),
        vad_start_secs=_env_float("CAT_VAD_START_SECS", 0.2),
        vad_stop_secs=_env_float("CAT_VAD_STOP_SECS", 0.2),
        vad_min_volume=_env_float("CAT_VAD_MIN_VOLUME", 0.6),
        openai_api_key=_require("OPENAI_API_KEY"),
        pinecone_api_key=_require("PINECONE_API_KEY"),
        pinecone_index=os.getenv("CAT_PINECONE_INDEX", "cat-320d-omm"),
        embed_model=os.getenv("CAT_EMBED_MODEL", "text-embedding-3-small"),
        rag_top_k=int(_env_float("CAT_RAG_TOP_K", 5)),
        rag_alpha=_env_float("CAT_RAG_ALPHA", 0.8),
        show_images_locally=_env_bool("CAT_SHOW_IMAGES_LOCALLY", True),
        echo_guard=_env_bool("CAT_ECHO_GUARD", True),
    )
