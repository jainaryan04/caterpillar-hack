"""Test tools and specialist agents without a mic: prints what the LLM would receive.

    uv run check_tools.py
"""

import asyncio

from pipecat.adapters.schemas.direct_function import DirectFunctionWrapper

import cat  # noqa: F401  (loads .env)
from cat.specialists.machine_expert import ask_machine_expert
from cat.tools import TOOLS
from cat.tools.manual import open_manual


class FakeLLM:
    async def push_frame(self, frame, *args):
        pass  # in the real pipeline this is where speech frames go


class FakeParams:
    llm = FakeLLM()

    async def result_callback(self, result, **kwargs):
        print(f"   -> {result}")


async def main():
    print("Tools advertised to the voice LLM:")
    for tool in TOOLS:
        schema = DirectFunctionWrapper(tool).to_function_schema()
        print(f" - {schema.name}({', '.join(schema.properties)}): {schema.description}")

    print("\nget_current_time():")
    await TOOLS[0](FakeParams())

    print("\nask_machine_expert() -> Pinecone manual search + Agents SDK:")
    await ask_machine_expert(FakeParams(), "What does the travel alarm cancel switch do?")

    print('\nopen_manual() -> "open it": the pages behind that answer:')
    await open_manual(FakeParams())


if __name__ == "__main__":
    asyncio.run(main())
