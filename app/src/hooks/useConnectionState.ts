import { useEffect, useState } from 'react';
import { connectionService, type ConnectionState } from '@/services';

export function useConnectionState(): ConnectionState {
  const [state, setState] = useState(connectionService.getState());
  useEffect(() => connectionService.subscribe(setState), []);
  return state;
}
