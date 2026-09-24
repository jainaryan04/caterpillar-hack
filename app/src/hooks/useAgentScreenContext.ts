import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useAgent } from '@/state/AgentProvider';
import type { AgentContext } from '@/types/agent';

/**
 * Tells Cat what this screen is showing while it is focused, so a
 * wake-word question ("Hey Cat, what's this step?") carries that context.
 */
export function useAgentScreenContext(context: AgentContext | undefined) {
  const { setScreenContext } = useAgent();
  const key = JSON.stringify(context ?? null);
  useFocusEffect(
    useCallback(() => {
      setScreenContext(context);
      return () => setScreenContext(undefined);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, setScreenContext]),
  );
}
