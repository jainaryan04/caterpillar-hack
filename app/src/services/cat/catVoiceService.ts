import Constants, { ExecutionEnvironment } from 'expo-constants';
import { config } from '@/config';
import type { VoiceConnection } from '@/types/agent';
import type { VoiceService } from '../types';
import { createVoiceEvents } from '../voiceEvents';

/**
 * Live voice with the Cat agent over WebRTC (Pipecat SmallWebRTC).
 *
 * The phone streams the mic to cat_agent's POST /api/offer and plays Cat's
 * voice back. The agent runs the same pipeline as on the laptop: "Hey Cat"
 * wake phrase, Deepgram speech in and out, the manual tools. RTVI events
 * (transcripts, speaking state, manual pictures/pages) arrive here and are
 * re-emitted as VoiceEvents.
 *
 * Needs native WebRTC, so it only works in a development build, not Expo Go.
 */

/** Native modules exist only in a development build. */
export const liveVoiceSupported = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

const events = createVoiceEvents();
let connection: VoiceConnection = liveVoiceSupported ? 'disconnected' : 'unavailable';
// PipecatClient instance; typed loosely because the module is loaded lazily.
let client: { connect: (p: unknown) => Promise<unknown>; disconnect: () => Promise<void> | void } | null = null;
// Sentences already reported, by segment id (each one arrives more than once).
const seenSegments = new Set<number | string>();

const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : `${config.catApiUrl}${url.startsWith('/') ? '' : '/'}${url}`);

function setConnection(state: VoiceConnection, detail?: string) {
  connection = state;
  events.emit({ type: 'connection', state, detail });
}

function onServerMessage(data: unknown) {
  const msg = data as Record<string, unknown> | null;
  if (!msg || typeof msg.url !== 'string') return;
  if (msg.type === 'manual-image') {
    events.emit({
      type: 'manual-image',
      url: absolute(msg.url),
      page: typeof msg.page === 'number' ? msg.page : undefined,
      caption: typeof msg.caption === 'string' ? msg.caption : undefined,
    });
  } else if (msg.type === 'manual-pages') {
    events.emit({
      type: 'manual-pages',
      url: absolute(msg.url),
      page: Number(msg.page),
      pageEnd: typeof msg.page_end === 'number' ? msg.page_end : undefined,
      topic: typeof msg.topic === 'string' ? msg.topic : null,
      width: Number(msg.width) || 935,
      height: Number(msg.height) || 1210,
    });
  }
}

async function createClient() {
  // Loaded here, not at the top: these need native code that Expo Go lacks.
  /* eslint-disable @typescript-eslint/no-require-imports */
  require('react-native-get-random-values');
  const { PipecatClient } = require('@pipecat-ai/client-js');
  const { RNSmallWebRTCTransport } = require('@pipecat-ai/react-native-small-webrtc-transport');
  const { DailyMediaManager } = require('@pipecat-ai/react-native-daily-media-manager');
  /* eslint-enable @typescript-eslint/no-require-imports */

  return new PipecatClient({
    transport: new RNSmallWebRTCTransport({ mediaManager: new DailyMediaManager() }),
    enableMic: true,
    enableCam: false,
    callbacks: {
      onConnected: () => setConnection('connected'),
      onDisconnected: () => {
        client = null;
        setConnection('disconnected');
      },
      onError: (message: { data?: { message?: string } }) =>
        setConnection('error', message?.data?.message ?? 'Voice connection error'),
      onUserStartedSpeaking: () => events.emit({ type: 'user-speaking', speaking: true }),
      onUserStoppedSpeaking: () => events.emit({ type: 'user-speaking', speaking: false }),
      onUserTranscript: (d: { text: string; final: boolean }) =>
        events.emit({ type: 'user-transcript', text: d.text, final: d.final }),
      onBotStartedSpeaking: () => events.emit({ type: 'bot-speaking', speaking: true }),
      onBotStoppedSpeaking: () => events.emit({ type: 'bot-speaking', speaking: false }),
      onBotOutput: (d: { text: string; segment_id?: number; aggregated_by?: string }) => {
        if (d.aggregated_by && d.aggregated_by !== 'sentence') return;
        const key = d.segment_id ?? d.text;
        if (seenSegments.has(key)) return;
        seenSegments.add(key);
        events.emit({ type: 'bot-text', text: d.text.trim() });
      },
      onServerMessage,
      onLocalAudioLevel: (level: number) => events.emit({ type: 'level', source: 'local', level }),
      onRemoteAudioLevel: (level: number) => events.emit({ type: 'level', source: 'remote', level }),
    },
  });
}

export const catVoiceService: VoiceService = {
  wakePhrase: 'Hey Cat',
  live: true,
  getConnection: () => connection,
  subscribe: events.subscribe,

  async connect() {
    if (!liveVoiceSupported) {
      setConnection('unavailable', 'Live voice needs the development build (not Expo Go).');
      return;
    }
    if (client || connection === 'connecting') return;
    setConnection('connecting');
    try {
      const c = await createClient();
      client = c;
      seenSegments.clear();
      await c.connect({ webrtcRequestParams: { endpoint: `${config.catApiUrl}/api/offer` } });
    } catch (e) {
      client = null;
      setConnection('error', e instanceof Error ? e.message : 'Could not start voice');
    }
  },

  async disconnect() {
    const c = client;
    client = null;
    await c?.disconnect();
    setConnection(liveVoiceSupported ? 'disconnected' : 'unavailable');
  },
};
