import type { MediaService } from '../types';
import { makeId, nowIso } from '@/utils/format';
import { mockImageAnalyses } from './data/agent';
import { delay, mockConfig } from './mockConfig';

let next = 0;

export const mockMediaService: MediaService = {
  async analyzeMachineryPhoto() {
    await delay(mockConfig.imageAnalysisMs);
    if (mockConfig.failRequests) throw new Error('Image analysis is unavailable right now.');
    const result = mockImageAnalyses[next % mockImageAnalyses.length];
    next += 1;
    return { ...result, id: makeId('IMG'), createdAt: nowIso() };
  },
};
