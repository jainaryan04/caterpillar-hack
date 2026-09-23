import type { AgentContext, AgentResponse, SosStatus } from '@/types/agent';
import { formatClock, makeId, nowIso } from '@/utils/format';
import type { AgentService } from '../types';
import { cannedAnswers, fallbackAnswer, mockHistory, videoContextAnswer, type CannedAnswer } from './data/agent';
import { mockOperator } from './data/operations';
import { clone, delay, mockConfig, simulateRequest } from './mockConfig';

const sosListeners = new Set<(status: SosStatus | null) => void>();

function emitSos(status: SosStatus | null) {
  sosListeners.forEach((l) => l(status));
}

function pickAnswer(message: string, context?: AgentContext): CannedAnswer {
  const q = message.toLowerCase();
  const keywordMatch = cannedAnswers.find((a) => a.keywords.some((k) => q.includes(k)));
  // Safety-critical intents win over context.
  if (keywordMatch?.actions.some((a) => a.type === 'TRIGGER_SOS' || a.type === 'CONTACT_SUPERVISOR')) {
    return keywordMatch;
  }
  if (context?.videoId && context.videoTitle && context.timestamp !== undefined) {
    return videoContextAnswer(context.videoTitle, context.chapterTitle ?? 'current', formatClock(context.timestamp));
  }
  return keywordMatch ?? fallbackAnswer;
}

/** Pretend the backend raised an incident and the supervisor picked it up. */
function simulateSosLifecycle() {
  const sentAt = nowIso();
  const base: SosStatus = {
    incidentId: `INC-${Math.floor(4000 + Math.random() * 900)}`,
    state: 'sent',
    sentAt,
    supervisorName: mockOperator.supervisorName,
  };
  emitSos(base);
  setTimeout(() => emitSos({ ...base, state: 'acknowledged', note: 'On the way · ETA 4 min' }), 7000);
}

export const mockAgentService: AgentService = {
  async getHistory() {
    await simulateRequest();
    return clone(mockHistory);
  },

  async sendMessage(message, context) {
    await delay(mockConfig.agentLatencyMs);
    if (mockConfig.failRequests) throw new Error('Jarvis is unavailable right now.');
    const answer = pickAnswer(message, context);
    const response: AgentResponse = {
      id: makeId('RSP'),
      text: answer.text,
      caution: answer.caution,
      citations: answer.citations,
      actions: answer.actions,
      createdAt: nowIso(),
    };
    if (answer.actions.some((a) => a.type === 'TRIGGER_SOS')) simulateSosLifecycle();
    return response;
  },

  onSosStatus(listener) {
    sosListeners.add(listener);
    return () => sosListeners.delete(listener);
  },
};
