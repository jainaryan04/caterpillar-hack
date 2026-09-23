/**
 * The one place that decides which implementation backs each service.
 *
 * Everything outside `services/` imports from here. To connect the real
 * backend, replace a mock below with an implementation of the same interface
 * from `./types`.
 */
import type {
  AgentService,
  ConnectionService,
  MediaService,
  OperatorService,
  TaskService,
  VideoService,
  VoiceService,
} from './types';
import { mockAgentService } from './mock/mockAgentService';
import { mockConnectionService } from './mock/mockConnectionService';
import { mockMediaService } from './mock/mockMediaService';
import { mockOperatorService } from './mock/mockOperatorService';
import { mockTaskService } from './mock/mockTaskService';
import { mockVideoService } from './mock/mockVideoService';
import { mockVoiceService } from './mock/mockVoiceService';

export const operatorService: OperatorService = mockOperatorService;
export const taskService: TaskService = mockTaskService;
export const videoService: VideoService = mockVideoService;
export const agentService: AgentService = mockAgentService;
export const voiceService: VoiceService = mockVoiceService;
export const mediaService: MediaService = mockMediaService;
export const connectionService: ConnectionService = mockConnectionService;

export type * from './types';
