'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    let alive = true;
    api<Admin>('/auth/me')
      .then((a) => alive && setAdmin(a))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      router.replace('/login');
    }
  }, [router]);

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
