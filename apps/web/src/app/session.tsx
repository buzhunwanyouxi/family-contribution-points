/**
 * Session + family context.
 *
 * The token is the only thing persisted; everything else is fetched on start through
 * `GET /api/auth/me` (CONTRACTS #5). A 401 anywhere clears the token and drops the user back
 * to the login screen -- that behaviour is wired once, in `api/client.ts`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, UnauthorizedError } from '../api/client';
import type { FamilySummary, UserSummary } from '../api/types';

type Status = 'loading' | 'anonymous' | 'ready';

interface SessionValue {
  status: Status;
  user: UserSummary | null;
  families: FamilySummary[];
  currentFamilyId: string | null;
  currentFamily: FamilySummary | null;
  selectFamily: (familyId: string) => void;
  login: (input: { account: string; password: string }) => Promise<void>;
  register: (input: { account: string; password: string; nickname: string }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const FAMILY_KEY = 'fcp.currentFamily';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<UserSummary | null>(null);
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [currentFamilyId, setCurrentFamilyId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(FAMILY_KEY);
    } catch {
      return null;
    }
  });

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
    setFamilies([]);
    setCurrentFamilyId(null);
    setStatus('anonymous');
    try {
      window.localStorage.removeItem(FAMILY_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const applyAuth = useCallback(
    (result: { user: UserSummary; families: FamilySummary[] }) => {
      setUser(result.user);
      setFamilies(result.families);
      setStatus('ready');
      setCurrentFamilyId((previous) => {
        const stillThere = previous && result.families.some((f) => f.id === previous);
        const next = stillThere ? previous : (result.families[0]?.id ?? null);
        try {
          if (next) window.localStorage.setItem(FAMILY_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setStatus('anonymous');
      return;
    }
    try {
      applyAuth(await api.me());
    } catch (error) {
      if (error instanceof UnauthorizedError) clear();
      else setStatus('anonymous');
    }
  }, [applyAuth, clear]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setFamilies([]);
      setStatus('anonymous');
    });
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const selectFamily = useCallback((familyId: string) => {
    setCurrentFamilyId(familyId);
    try {
      window.localStorage.setItem(FAMILY_KEY, familyId);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SessionValue>(() => {
    const currentFamily = families.find((f) => f.id === currentFamilyId) ?? families[0] ?? null;
    return {
      status,
      user,
      families,
      currentFamilyId: currentFamily?.id ?? null,
      currentFamily,
      selectFamily,
      async login(input) {
        applyAuth(await api.login(input));
      },
      async register(input) {
        applyAuth(await api.register(input));
      },
      logout: clear,
      refresh,
    };
  }, [applyAuth, clear, currentFamilyId, families, refresh, selectFamily, status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
