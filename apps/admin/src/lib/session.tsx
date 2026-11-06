'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { api, ApiError, setCsrfToken } from './api';

export interface Admin {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

interface SessionValue {
  admin: Admin;
  can: (permission: string) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Loads the signed-in admin once. The dashboard hides actions the admin's roles don't allow;
 * the API enforces the same permissions on every request, so hiding is only for clarity.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);
  // Anything other than "not signed in" (server asleep, wrong API address, network down) is shown,
  // never left as an endless "Loading…".
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api<Admin>('/auth/me')
      .then((a) => alive && setAdmin(a))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [router, attempt]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      router.replace('/login');
    }
  }, [router]);

  if (!admin && failed) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div role="alert" className="max-w-md text-center">
          <p className="text-body font-semibold text-navy">
            The Musride server could not be reached.
          </p>
          <p className="mt-2 text-muted">
            It may be starting up (this can take up to a minute) or your connection dropped.
          </p>
          <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!admin) {
    return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>;
  }
  const perms = new Set(admin.permissions);
  return (
    <SessionContext.Provider value={{ admin, can: (p) => perms.has(p), signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
