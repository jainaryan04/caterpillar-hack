import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioRecorder,
} from 'expo-audio';
import { config } from '@/config';
import type { AgentContext, VoiceConnection } from '@/types/agent';
import { request } from '../http';
import { shiftTasks } from '../local/shiftTasks';
import type { VoiceService } from '../types';
import { createVoiceEvents } from '../voiceEvents';
import type { CatVoiceReply } from './catTypes';

/**
 * Push-to-talk with the Cat agent, for Expo Go (no WebRTC there).
 *
 * Tap a mic: the phone records one question. Recording stops by itself about a
 * second after the operator stops talking (or on "Send"). The clip goes to
 * cat_agent's POST /api/app/voice, which transcribes it, answers from the
 * manual (or what's on screen) and returns the text at once plus a URL that
 * streams Cat's spoken answer. Emits the same VoiceEvents as the live
 * session, so the voice overlay works unchanged. No "Hey Cat" needed.
 *
 * The recorder comes from a hook, so <TalkRecorderHost /> (mounted at the
 * root) creates it and hands it over with attachRecorder().
 */

const POLL_MS = 100;
/** Metering in dB (0 = loudest). Above SPEECH_DB counts as talking. */
const SPEECH_DB = -38;
const SILENCE_DB = -45;
/** Stop this long after the operator stops talking. */
const END_OF_SPEECH_MS = 1300;
const NOTHING_SAID_MS = 7000;
const MAX_RECORDING_MS = 20000;
/** Cat's speaking rate (Deepgram Aura, ~160 wpm), for showing the answer while its length is unknown. */
const WORDS_PER_SEC = 2.7;

const events = createVoiceEvents();
let connection: VoiceConnection = 'disconnected';
let recorder: AudioRecorder | null = null;
let player: AudioPlayer | null = null;
let run = 0;
let poll: ReturnType<typeof setInterval> | null = null;
let finishCurrent: (() => void) | null = null;

export function attachRecorder(r: AudioRecorder | null) {
  recorder = r;
}

function stopPolling() {
  if (poll) clearInterval(poll);
  poll = null;
}

function stopPlayback() {
  player?.remove();
  player = null;
}

function fail(detail: string) {
  events.emit({ type: 'user-speaking', speaking: false });
  events.emit({ type: 'connection', state: 'error', detail });
  // Stay usable: the next tap tries again.
  connection = 'connected';
}

/** Records until the operator stops talking; resolves with the file's uri. */
async function record(current: number): Promise<string | null> {
  const r = recorder;
  if (!r) return null;
  await r.prepareToRecordAsync();
  r.record();
  events.emit({ type: 'user-speaking', speaking: true });

  return new Promise((resolve) => {
    const started = Date.now();
    let heardAt = 0;
    let quietSince = 0;
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      stopPolling();
      finishCurrent = null;
      events.emit({ type: 'level', source: 'local', level: 0 });
      try {
        await r.stop();
      } catch {
        // already stopped
      }
      resolve(current === run ? r.uri : null);
    };
    finishCurrent = stop;

    poll = setInterval(() => {
      if (current !== run) return void stop();
      const now = Date.now();
      const db = r.getStatus().metering ?? -160;
      events.emit({ type: 'level', source: 'local', level: Math.max(0, Math.min(1, (db + 60) / 60)) });
      if (db > SPEECH_DB) {
        heardAt = heardAt || now;
        quietSince = 0;
      } else if (db < SILENCE_DB) {
        quietSince = quietSince || now;
      }
      const doneTalking = heardAt && quietSince && now - quietSince > END_OF_SPEECH_MS;
      const saidNothing = !heardAt && now - started > NOTHING_SAID_MS;
      if (doneTalking || saidNothing || now - started > MAX_RECORDING_MS) stop();
    }, POLL_MS);
  });
}

/**
 * Plays Cat's answer and shows its words as they are spoken, not all at once
 * before the voice starts; resolves when it ends (or fails, or runs too long).
 */
function play(url: string, text: string, current: number): Promise<void> {
  return new Promise((resolve) => {
    stopPlayback();
    const p = createAudioPlayer({ uri: url }, { updateInterval: 100 });
    player = p;
    const words = text.split(/\s+/).filter(Boolean);
    let shown = 0;
    const reveal = (upTo: number) => {
      const n = Math.min(words.length, Math.ceil(upTo));
      if (n <= shown) return;
      // The overlay stays on "thinking" until the first word, then appends each bot-text.
      if (!shown) events.emit({ type: 'bot-speaking', speaking: true });
      events.emit({ type: 'bot-text', text: words.slice(shown, n).join(' ') });
      shown = n;
    };
    const safety = setTimeout(done, words.length * 600 + 15000);
    let level: ReturnType<typeof setInterval> | null = setInterval(() => {
      events.emit({ type: 'level', source: 'remote', level: p.playing ? 0.3 + Math.random() * 0.6 : 0 });
      if (p.currentTime > 0) {
        // The reply is streamed, so its length is often unknown until the end: fall back to the speaking rate.
        const d = p.duration;
        reveal(d > 0 && Number.isFinite(d) ? (p.currentTime / d) * words.length : p.currentTime * WORDS_PER_SEC);
      }
    }, 90);
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) done();
    });
    function done() {
      clearTimeout(safety);
      if (level) clearInterval(level);
      level = null;
      sub.remove();
      // Whatever wasn't spoken yet (audio failed, or the estimate ran slow).
      if (current === run) reveal(words.length);
      events.emit({ type: 'level', source: 'remote', level: 0 });
      if (player === p) stopPlayback();
      resolve();
    }
    if (current === run) p.play();
    else done();
  });
}

async function ask(context?: AgentContext) {
  const current = ++run;
  stopPlayback();
  if (!recorder) return fail('Recorder not ready yet. Try again in a moment.');
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) return fail('Cat needs the microphone. Allow it in Settings, then try again.');

  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    const uri = await record(current);
    // Back to playback mode, so the answer comes out of the loudspeaker.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!uri || current !== run) return;

    // The overlay moves to "thinking" once the question has the wake phrase in it.
    events.emit({ type: 'user-transcript', text: 'Hey Cat…', final: false });
    events.emit({ type: 'user-speaking', speaking: false });

    const form = new FormData();
    // React Native's FormData takes a { uri, name, type } descriptor for files.
    form.append('file', { uri, name: 'question.m4a', type: 'audio/mp4' } as unknown as Blob);
    if (context) form.append('context', JSON.stringify(context));
    form.append('sessionId', 'local');
    // So "what should I do next?" reflects tasks marked done on this phone.
    form.append('tasks', JSON.stringify(shiftTasks()));
    const reply = await request<CatVoiceReply>(config.catApiUrl, '/api/app/voice', {
      method: 'POST',
      body: form,
      timeoutMs: 45000,
    });
    if (current !== run) return;

    events.emit({ type: 'user-transcript', text: `Hey Cat, ${reply.transcript || '…'}`, final: true });
    if (reply.pages) events.emit({ type: 'manual-pages', ...reply.pages });
    if (reply.imageUrl) events.emit({ type: 'manual-image', url: reply.imageUrl, page: reply.manual?.page });
    if (reply.audioUrl) {
      await play(reply.audioUrl, reply.text, current);
    } else {
      events.emit({ type: 'bot-speaking', speaking: true });
      events.emit({ type: 'bot-text', text: reply.text });
    }
    if (current === run) events.emit({ type: 'bot-speaking', speaking: false });
  } catch (e) {
    if (current === run) fail(e instanceof Error ? e.message : 'Cat did not answer.');
  }
}

export const catTalkVoiceService: VoiceService = {
  wakePhrase: 'Hey Cat',
  live: false,
  pushToTalk: true,
  getConnection: () => connection,
  subscribe: events.subscribe,

  async connect() {
    connection = 'connected';
    events.emit({ type: 'connection', state: 'connected', detail: 'Push-to-talk: tap, ask, Cat answers' });
  },

  async disconnect() {
    run += 1;
    finishCurrent?.();
    stopPolling();
    stopPlayback();
    connection = 'disconnected';
    events.emit({ type: 'connection', state: 'disconnected' });
  },

  talk(context) {
    void ask(context);
  },

  finishTalking() {
    finishCurrent?.();
  },
};
