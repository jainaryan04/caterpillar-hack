/**
 * The one place that decides which implementation backs each service.
 *
 * - Fleet Scheduler API (Prediction/): operators, tasks, connection status
 * - Cat agent (cat_agent/): questions, photos, training videos
 * - Cat agent live voice (WebRTC, dev build only): wake phrase, speech in/out
 *   In Expo Go or mock mode a demo voice stands in (no microphone).
 *
 * Set EXPO_PUBLIC_USE_MOCKS=1 to run everything on mock data.
 */
import { config } from '@/config';
import { catAgentService, catMediaService, catVideoService } from './cat/catServices';
import { fleetConnectionService, fleetOperatorService, fleetTaskService } from './fleet/fleetServices';
import { mockAgentService } from './mock/mockAgentService';
import { mockConnectionService } from './mock/mockConnectionService';
import { mockMediaService } from './mock/mockMediaService';
import { mockOperatorService } from './mock/mockOperatorService';
import { mockTaskService } from './mock/mockTaskService';
import { mockVideoService } from './mock/mockVideoService';
import { createMockVoiceService } from './mock/mockVoiceService';
import { catVoiceService, liveVoiceSupported } from './cat/catVoiceService';
import type {
  AgentService,
  ConnectionService,
  MediaService,
  OperatorService,
  TaskService,
  VideoService,
  VoiceService,
} from './types';

const mocks = config.useMocks;
const fleetMocks = config.mockFleet;

export const operatorService: OperatorService = fleetMocks ? mockOperatorService : fleetOperatorService;
export const taskService: TaskService = fleetMocks ? mockTaskService : fleetTaskService;
export const connectionService: ConnectionService = fleetMocks ? mockConnectionService : fleetConnectionService;
export const agentService: AgentService = mocks ? mockAgentService : catAgentService;
export const mediaService: MediaService = mocks ? mockMediaService : catMediaService;
export const videoService: VideoService = mocks ? mockVideoService : catVideoService;
export const voiceService: VoiceService =
  !mocks && liveVoiceSupported
    ? catVoiceService
    : createMockVoiceService(
        (q, ctx) => agentService.sendMessage(q, ctx),
        mocks ? 'Demo voice (mock mode)' : 'Demo voice: live voice needs the development build',
      );

export * from './types';
export { ApiError } from './http';
