import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { storage } from '@/services/local/storage';
import { session } from '@/services/session';

const LAST_WORKER_KEY = 'session.lastWorkerId';

interface SessionState {
  /** Worker chosen for this launch. Undefined until the picker is confirmed. */
  workerId?: string;
  /** Worker used last time, to preselect in the picker. */
  lastWorkerId?: string;
  /** The last worker has been read from storage. */
  ready: boolean;
  signIn: (workerId: string) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Which worker is using the phone. The picker appears on every launch (shared
 * phones), with the previous worker preselected so continuing is one tap.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [workerId, setWorkerId] = useState<string>();
  const [lastWorkerId, setLastWorkerId] = useState<string>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    storage.get<string>(LAST_WORKER_KEY).then((id) => {
      setLastWorkerId(id);
      setReady(true);
    });
  }, []);

  const signIn = useCallback((id: string) => {
    session.set(id);
    setWorkerId(id);
    setLastWorkerId(id);
    storage.set(LAST_WORKER_KEY, id);
  }, []);

  const signOut = useCallback(() => {
    session.set(undefined);
    setWorkerId(undefined);
  }, []);

  const value = useMemo(
    () => ({ workerId, lastWorkerId, ready, signIn, signOut }),
    [workerId, lastWorkerId, ready, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** For screens behind the picker: the signed-in worker id. */
export function useWorkerId(): string {
  const { workerId } = useSession();
  // Protected routes only render with a worker selected (see app/_layout.tsx).
  return workerId ?? '';
}
