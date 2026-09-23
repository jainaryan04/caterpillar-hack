"""Check manual retrieval quality and speed without a mic.

    uv run eval_manual.py              # hit@k + latency at the configured alpha
    uv run eval_manual.py --sweep      # compare alphas (dense vs keyword weighting)
    uv run eval_manual.py --answers    # also run the specialist agent on each question

A question is a hit when a chunk whose title contains the expected text is in the
top k results. Questions are phrased the way an operator would say them.
"""

import asyncio
import sys
import time

import cat  # noqa: F401  (loads .env)
from cat.rag.store import get_store

QUESTIONS = [
    ("What does the AEC switch do?", "Automatic Engine Speed Control"),
    ("How do I lock the hydraulics before I get out?", "Hydraulic Lockout Control"),
    ("How do I undo my seat belt?", "Seat Belt"),
    ("Where is the battery disconnect switch?", "Battery Disconnect Switch"),
    ("How do I stop the beeping when I travel?", "Travel Alarm Cancel Switch"),
    ("What does heavy lift mode do?", "Heavy Lift Control"),
    ("How do I lock the quick coupler onto the bucket?", "Quick Coupler"),
    ("What is the fine swing button for?", "Fine Swing Control"),
    ("How often do I change the hydraulic oil?", "Hydraulic System Oil"),
    ("What should I check before starting the engine?", "Engine Starting"),  # also "Before Starting Engine"
    ("Is it safe to work across a slope?", "Slope Operation"),
    ("What do I do if there is lightning nearby?", "Electrical Storm"),
    ("How do I set the engine speed dial?", "Engine Speed Control"),
    ("A buzzer went off while I was lifting a load, what does it mean?", "Overload Warning"),
    ("How do I get out if the cab door is blocked?", "Alternate Exit"),
    ("How do I lower the boom if the engine has died?", "Equipment Lowering with Engine Stopped"),
    ("How do I switch between high and low travel speed?", "Travel Speed Control"),
    ("Can I change the joystick pattern?", "Joystick Controls Alternate Patterns"),
]


async def run(alpha: float, show: bool) -> tuple[float, float]:
    store = get_store()
    hits, latencies = 0, []
    for question, expected in QUESTIONS:
        t0 = time.perf_counter()
        passages = await store.search(question, alpha=alpha)
        latencies.append(time.perf_counter() - t0)
        rank = next((i + 1 for i, p in enumerate(passages) if expected.lower() in p.title.lower()), None)
        hits += rank is not None
        if show:
            mark = f"#{rank}" if rank else "MISS"
            top = passages[0]
            print(f"{mark:>5}  {question}\n       top: {top.title} ({top.pages()})")
    return hits / len(QUESTIONS), sorted(latencies)[len(latencies) // 2]


async def answers():
    from cat.specialists.machine_expert import answer_from_manual

    for question, _ in QUESTIONS:
        t0 = time.perf_counter()
        answer = await answer_from_manual(question)
        picture = f"  [picture {answer.image.id}, page {answer.image.page}]" if answer.image else ""
        print(f"Q: {question}\nA: {answer.text}{picture}  ({time.perf_counter() - t0:.2f}s)\n")


async def main():
    store = get_store()
    await store.warm_up()
    if "--sweep" in sys.argv:
        for alpha in (1.0, 0.8, 0.6, 0.4, 0.2, 0.0):
            hit, p50 = await run(alpha, show=False)
            print(f"alpha={alpha:.1f}  hit@{store._cfg.rag_top_k}={hit:.0%}  median search {1000 * p50:.0f}ms")
        return
    hit, p50 = await run(store._cfg.rag_alpha, show=True)
    print(f"\nalpha={store._cfg.rag_alpha}  hit@{store._cfg.rag_top_k}={hit:.0%}  median search {1000 * p50:.0f}ms")
    if "--answers" in sys.argv:
        print()
        await answers()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
