import type { OperatorService } from '../types';
import { mockOperator, mockShift } from './data/operations';
import { clone, simulateRequest } from './mockConfig';

export const mockOperatorService: OperatorService = {
  async getCurrentOperator() {
    await simulateRequest();
    return clone(mockOperator);
  },
  async getCurrentShift() {
    await simulateRequest();
    return clone(mockShift);
  },
};
