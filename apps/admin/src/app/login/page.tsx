'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, setCsrfToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ csrfToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password, totpCode },
      });
      setCsrfToken(res.csrfToken);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Try again.');
      setTotpCode('');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'mt-1 w-full rounded-control border border-line bg-white px-3 py-2.5 text-body-large';

  return (
    <main className="grid min-h-screen md:grid-cols-[1fr_minmax(380px,480px)]">
      <section className="hidden flex-col justify-between bg-navy p-12 text-white md:flex">
        <Image
          src="/brand/musride-logo-on-dark.svg"
          alt="Musride"
          width={238}
          height={48}
          priority
          className="h-(--size-logo-large) w-auto"
        />
        <div className="max-w-md">
          <div className="inline-block rounded-card border-4 border-white bg-sign px-6 py-4">
            <p className="text-small font-semibold text-white/85">Jijiga</p>
            <p className="text-display font-extrabold leading-none">Operations console</p>
          </div>
          <p className="mt-6 text-white/75">
            For Musride staff only. Every sign-in and every change is recorded.
          </p>
        </div>
        <p className="text-small text-white/50">
          Lost your authenticator? Ask a super admin to reset your account.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate={false}>
          <div>
            <h1 className="text-display font-extrabold tracking-tight">Sign in</h1>
            <p className="text-muted">
              Use your staff email, password and the 6-digit code from your authenticator app.
            </p>
          </div>
          <label className="block">
            <span className="font-semibold">Email</span>
            <input
              className={field}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="font-semibold">Password</span>
            <input
              className={field}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="font-semibold">Authenticator code</span>
            <input
              className={`${field} tracking-widest`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-control bg-signal-soft px-4 py-3 text-signal">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-control bg-navy py-3 text-body-large font-bold text-white hover:bg-navy-soft disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
