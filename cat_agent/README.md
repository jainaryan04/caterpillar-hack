# Cat: voice assistant for CAT operators

A real-time voice loop built on [Pipecat](https://github.com/pipecat-ai/pipecat) 1.11. It runs locally on
your laptop's mic and speakers and uses Deepgram for speech and Cerebras for fast LLM inference.

```
mic ─► Silero VAD (local) ─► Deepgram nova-3 ─► Cerebras gpt-oss-120b (+ tools) ─► Deepgram Aura-2 ─► speaker
                                                            │
                                                            └─► ask_machine_expert (OpenAI Agents SDK agent)
                                                                  └─► Cat 320D manual in Pinecone (hybrid search)
```

## Run it

```powershell
cd cat_agent
uv sync                      # first time only
copy .env.example .env       # then fill in the API keys
uv run ingest_manual.py      # first time only: index the machine manual in Pinecone
uv run main.py               # talk to it; Ctrl+C to stop
uv run check_tools.py        # test tools/agents without a mic
```

The first run downloads a small NLTK sentence-splitting dataset, so startup can take about 30 seconds.
Later runs start in 1–2 seconds.

## Layout

| Path | What it's for |
|---|---|
| `main.py` | Entry point. Picks the transport (local mic/speaker for now). |
| `cat/pipeline.py` | The voice loop: STT → LLM → TTS, turn-taking and muting. |
| `cat/services.py` | Which STT, LLM and TTS providers to use. Change a provider here. |
| `cat/prompts.py` | Cat's personality and rules. |
| `cat/tools/` | Fast in-process tools. Add a function and list it in `TOOLS`. |
| `cat/specialists/` | Slower multi-step agents (OpenAI Agents SDK) that the voice LLM calls as tools. |
| `cat/rag/` | Manual search: PDF parsing, BM25 keywords, OpenAI embeddings + Pinecone. |
| `ingest_manual.py` / `eval_manual.py` | Build the manual index / check retrieval quality and speed. |

## The machine manual (RAG)

Cat answers control, safety and maintenance questions from Caterpillar's official
**Cat 320D Excavator Operation and Maintenance Manual (SEBU8053-20, August 2018)**.
Put the PDF at `data/manuals/cat-320d-omm-SEBU8053-20.pdf` (it is git-ignored); it can be downloaded from
https://www.gawest.com/assets/uploads/CAT-320D.pdf.

- **Chunks:** one per manual topic, and one per control (e.g. "Travel Alarm Cancel Switch (15)"),
  found from the manual's heading font sizes. Each keeps its page and illustration ids.
- **Hybrid search:** every chunk is stored in one Pinecone index as an OpenAI `text-embedding-3-small`
  vector (meaning) plus a BM25 vector (exact words like "AEC"). `CAT_RAG_ALPHA` weights them.
- **Specialist:** `ask_machine_expert` searches first, then one Cerebras call writes a short spoken answer
  with the page number. Cat says "Let me check the manual." while it works.
- **Speed:** the search starts as soon as you stop talking, before the LLM has decided to call the tool.
- **Pictures:** ingest cuts all 409 illustrations out of the PDF into `data/manuals/images/<id>.png`
  (git-ignored). Chunks mark where each picture sits (`[image g00867598]`), and control sections point at
  their numbered overview drawing ("Shown as callout (15) in [image g03666599]"). The agent picks the
  picture that fits, Cat says "I've put the picture from the manual on your screen", and
  `cat/display.py` sends it to the app.

### Pictures in the app

The app receives an RTVI server message (the Pipecat client SDKs' `onServerMessage`):

```json
{"type": "manual-image", "image_id": "g00867598", "page": 94,
 "url": "/manual-images/g00867598.png", "width": 497, "height": 310,
 "caption": "How do I wear the seat belt?"}
```

`url` is relative to the Cat server, which should serve `data/manuals/images/` at `/manual-images/`.
With the local mic/speaker transport there is no app yet, so the picture also opens on this computer
(`CAT_SHOW_IMAGES_LOCALLY`).

```powershell
uv run ingest_manual.py          # re-run after changing the parser; replaces the old vectors
uv run eval_manual.py            # 18 operator questions: hit rate + search latency
uv run eval_manual.py --sweep    # compare alpha values
uv run eval_manual.py --answers  # also print the spoken answers
```

## Add a tool

```python
# cat/tools/tasks.py
async def get_todays_tasks(params: FunctionCallParams):
    """Get the operator's scheduled tasks for today."""
    await params.result_callback([{"task": "Trench dig, site B", "start": "09:00"}])
```

Then add `get_todays_tasks` to `TOOLS` in `cat/tools/__init__.py`. The docstring and type hints
become the tool description the LLM sees.

## Settings (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `CAT_LLM_PROVIDER` | `cerebras` | `openai` switches to `gpt-4o-mini` (needs `OPENAI_API_KEY`). |
| `CAT_LLM_MODEL` | `gpt-oss-120b` | Runs with low reasoning effort so replies start fast. |
| `CAT_STT_MODEL` | `nova-3-general` | Deepgram streaming speech-to-text. |
| `CAT_TTS_PROVIDER` | `deepgram` | `cartesia` is faster but costs more (needs `CARTESIA_API_KEY`). |
| `CAT_TTS_VOICE` | `aura-2-helena-en` | Deepgram voice name, or a Cartesia voice ID. |
| `CAT_ALLOW_INTERRUPTIONS` | `true` | Talk over Cat to stop it. On laptop speakers without headphones Cat may hear itself; raise the VAD values or set `false`. |
| `CAT_VAD_CONFIDENCE` | `0.7` | Silero VAD: how sure it must be that a sound is speech. |
| `CAT_VAD_START_SECS` | `0.2` | Speech needed before it counts as you talking (and interrupts Cat). |
| `CAT_VAD_STOP_SECS` | `0.2` | Silence needed before it decides you paused. |
| `CAT_VAD_MIN_VOLUME` | `0.6` | Ignore sounds quieter than this. |
| `CAT_PINECONE_INDEX` | `cat-320d-omm` | Created by `ingest_manual.py` (needs `PINECONE_API_KEY`). |
| `CAT_EMBED_MODEL` | `text-embedding-3-small` | OpenAI embeddings (needs `OPENAI_API_KEY`). |
| `CAT_RAG_TOP_K` | `5` | Manual passages given to the machine expert. |
| `CAT_RAG_ALPHA` | `0.8` | 1 = meaning only, 0 = keywords only. |
| `CAT_ECHO_GUARD` | `true` | Ignore Cat's own voice echoing through laptop speakers (see `cat/echo_guard.py`). With headphones set `false` for faster barge-in. |
| `CAT_SHOW_IMAGES_LOCALLY` | `true` | Also open manual pictures on this computer (until the app exists). |
