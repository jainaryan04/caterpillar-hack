"""The real-time voice loop.

    mic -> [Silero VAD] -> [STT] -> user context -> [LLM + tools] -> [TTS] -> speaker -> assistant context
                                                         |
                                   ask_machine_expert -> Cat 320D manual (Pinecone)

Every arrow is a stream of Pipecat "frames" (audio chunks, text, control
signals). Because each stage streams, Cat starts speaking the first sentence
of an answer while the LLM is still writing the rest.

Interruptions (barge-in): Silero VAD runs locally on every 20ms mic chunk. The
moment it hears you start talking it emits VADUserStartedSpeakingFrame; the
user aggregator turns that into an interruption, which makes the LLM, TTS and
speaker drop whatever they were doing, and Cat goes quiet to listen.
"""

import asyncio

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.transports.base_transport import BaseTransport
from pipecat.turns.user_start import MinWordsUserTurnStartStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies, default_user_turn_start_strategies
from pipecat.turns.user_mute import (
    AlwaysUserMuteStrategy,
    FunctionCallUserMuteStrategy,
    MuteUntilFirstBotCompleteUserMuteStrategy,
)

from cat.config import Config
from cat.echo_guard import BotSpeechRecorder, EchoFilter, EchoGuard
from cat import part_recognition, photo_match
from cat.prompts import GREETING_INSTRUCTION
from cat.rag import sections
from cat.rag.store import get_store
from cat.screen import LOCAL_SESSION
from cat.server import report_playing, report_video_pause
from cat.services import make_llm, make_stt, make_tts
from cat.tools import TOOLS
from cat.voice_owner import LaptopMicGate, LaptopSpeakerGate
from cat.wake_word import WAKE_WORDS, CatWakeStrategy, strip_wake_phrase


def build_worker(transport: BaseTransport, cfg: Config, laptop: bool = False) -> PipelineWorker:
    """The voice pipeline. `laptop` is the laptop's own mic and speakers (main.py)."""
    # Local voice-activity detection: a small neural net (runs on CPU, no API
    # calls) that answers "is someone talking in this 20ms of audio?".
    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(
                confidence=cfg.vad_confidence,  # how sure it must be that it's speech
                start_secs=cfg.vad_start_secs,  # speech needed before "started talking" (and barge-in)
                stop_secs=cfg.vad_stop_secs,  # silence needed before "stopped talking"
                min_volume=cfg.vad_min_volume,  # ignore quiet sounds below this level
            )
        )
    )

    stt = make_stt(cfg)
    llm = make_llm(cfg)
    tts = make_tts(cfg)

    # Conversation memory. Tools listed here are auto-registered with the LLM.
    context = LLMContext(tools=TOOLS)

    # Muting ignores the mic at certain times. Always muted:
    #  - until the greeting has finished (room noise shouldn't cut it off), and
    #  - while a tool runs (~1-2s): otherwise the speaker echo of "Let me check
    #    the manual." counts as the operator talking and cancels the lookup.
    # CAT_ALLOW_INTERRUPTIONS=false also mutes whenever Cat talks, which
    # stops Cat interrupting itself on laptop speakers but disables barge-in.
    mute_strategies = [MuteUntilFirstBotCompleteUserMuteStrategy(), FunctionCallUserMuteStrategy()]
    if not cfg.allow_interruptions:
        mute_strategies.append(AlwaysUserMuteStrategy())

    # Echo guard (laptop speakers): drop transcripts of Cat's own voice, and
    # start the operator's turn from recognised words rather than raw sound, so
    # echo can't interrupt Cat. See cat/echo_guard.py.
    start_strategies = default_user_turn_start_strategies()
    echo_filter = speech_recorder = None
    if cfg.echo_guard:
        guard = EchoGuard(ignore_words=WAKE_WORDS if cfg.wake_word else frozenset())
        echo_filter, speech_recorder = EchoFilter(guard), BotSpeechRecorder(guard)
        start_strategies = [MinWordsUserTurnStartStrategy(min_words=2)]

    # Wake word: nothing reaches the LLM until "Hey Cat" (see cat/wake_word.py).
    # It must come first: while asleep it blocks the strategies after it.
    wake = None
    if cfg.wake_word:
        wake = CatWakeStrategy(timeout=cfg.wake_timeout_secs)
        start_strategies = [wake, *start_strategies]
    turn_strategies = UserTurnStrategies(start=start_strategies)

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            user_mute_strategies=mute_strategies,
            user_turn_strategies=turn_strategies,
        ),
    )

    # The laptop session goes quiet while a phone runs its own (cat/voice_owner.py).
    mic_gate, speaker_gate = (LaptopMicGate(), LaptopSpeakerGate()) if laptop else (None, None)

    stages = [
        transport.input(),
        mic_gate,
        vad,
        stt,
        echo_filter,
        user_aggregator,
        llm,
        speech_recorder,
        tts,
        speaker_gate,
        transport.output(),
        assistant_aggregator,
    ]
    pipeline = Pipeline([stage for stage in stages if stage is not None])

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        # The very first run downloads NLTK sentence-splitting data, which can
        # take longer than the default 20s on Windows.
        setup_timeout_secs=90,
    )

    manual = get_store()

    @user_aggregator.event_handler("on_user_turn_started")
    async def on_user_turn_started(aggregator, strategy):
        logger.info("(you started talking)")
        if wake:
            wake.user_turn_started()
        manual.warm_connections()  # so a manual search after this turn starts on warm connections

    @user_aggregator.event_handler("on_user_turn_stopped")
    async def on_user_turn_stopped(aggregator, strategy, message):
        logger.info(f"YOU:    {message.content}")
        # Start the manual search now, while the LLM is still deciding whether
        # it needs the manual. Reused if it does; ignored if it doesn't.
        manual.prefetch(strip_wake_phrase(message.content))
        if wake:
            wake.user_turn_finished(message.content)

    @llm.event_handler("on_function_calls_started")
    async def on_function_calls_started(service, function_calls):
        # Fill the ~1-2s manual lookup with speech instead of silence.
        if wake:
            wake.reply_started()  # back to sleep while Cat works on the request
        names = {fc.function_name for fc in function_calls}
        if "ask_machine_expert" in names:
            await llm.push_frame(TTSSpeakFrame("Let me check the manual.", append_to_context=False))
        elif "ask_about_screen" in names:
            await llm.push_frame(TTSSpeakFrame("Let me look.", append_to_context=False))

    @assistant_aggregator.event_handler("on_assistant_turn_started")
    async def on_assistant_turn_started(aggregator):
        if wake:
            wake.reply_started()  # back to sleep once Cat starts answering

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(aggregator, message):
        if not message.content:
            return  # a turn that only called a tool
        suffix = "  [interrupted]" if message.interrupted else ""
        logger.info(f"CAT:    {message.content}{suffix}")

    if wake:

        @wake.event_handler("on_wake_phrase_detected")
        async def on_wake_phrase_detected(strategy, phrase):
            logger.info(f"(awake: heard {phrase!r})")

        @wake.event_handler("on_wake_phrase_timeout")
        async def on_wake_phrase_timeout(strategy):
            logger.info('(asleep: say "Hey Cat" to talk)')

    # The app can also report the screen over the RTVI connection (Pipecat
    # client SDKs: sendClientMessage("video-paused", {video_id, t, tap?})).
    # Photos go over HTTP (POST /api/screen/photo): they're too big for messages.
    @worker.rtvi.event_handler("on_client_message")
    async def on_client_message(rtvi, message):
        data = message.data or {}
        try:
            if message.type == "video-paused":
                await report_video_pause(
                    data["video_id"], float(data["t"]), data.get("tap"), LOCAL_SESSION, data.get("circle")
                )
            elif message.type == "video-playing":
                report_playing(LOCAL_SESSION)
        except (KeyError, ValueError, TypeError) as e:
            logger.warning(f"Bad {message.type} message {data}: {e}")

    @worker.event_handler("on_pipeline_started")
    async def on_pipeline_started(worker, frame):
        # Open the OpenAI/Pinecone connections while Cat says hello.
        worker.create_task(manual.warm_up())
        # Load the manual sections and photo references now, not on the first question.
        worker.create_task(asyncio.to_thread(sections.warm))
        worker.create_task(asyncio.to_thread(photo_match.warm))
        worker.create_task(asyncio.to_thread(part_recognition.warm))
        # Cat speaks first.
        greeting = GREETING_INSTRUCTION
        if cfg.wake_word:
            greeting += ' Tell them to say "Hey Cat" whenever they need you.'
        context.add_message({"role": "developer", "content": greeting})
        await worker.queue_frames([LLMRunFrame()])

    return worker
