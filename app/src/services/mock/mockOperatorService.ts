import type { OperatorService } from '../types';
import { mockOperators } from './data/operations';
import { clone, MockNetworkError, simulateRequest } from './mockConfig';

export const mockOperatorService: OperatorService = {
  async listOperators() {
    await simulateRequest();
    return clone(mockOperators);
  },
  async getOperator(workerId) {
    await simulateRequest();
    const found = mockOperators.find((o) => o.id === workerId);
    if (!found) throw new MockNetworkError(`Worker ${workerId} not found`);
    return clone(found);
  },
};
