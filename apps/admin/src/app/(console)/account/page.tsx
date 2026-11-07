'use client';

import { useState } from 'react';
import { Button, ErrorNotice, inputClass, PageHeader, Panel } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

/** The same rules the server applies (admin-accounts.service.ts), checked here first. */
function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Z]/.test(p)) return 'Add at least one capital letter.';
  if (!/[0-9]/.test(p)) return 'Add at least one number.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Add at least one symbol, such as ! # or @.';
  const lower = p.toLowerCase();
  if (
    ['password', 'passw0rd', 'musride', 'horide', 'qwerty', 'abc123', '12345'].some((w) =>
      lower.includes(w),
    )
  ) {
    return 'That password is too easy to guess. Avoid words like "password" or "musride".';
  }
  return null;
}

export default function AccountPage() {
  const { admin } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState(false);

  return (
    <>
      <PageHeader title="Your account" description={`${admin.fullName}, ${admin.email}`} />
      <div className="max-w-lg">
        <Panel title="Change password">
          <form
            className="space-y-4 px-5 py-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setDone(false);
              const problem = passwordProblem(next);
              if (problem) {
                setError(new Error(problem));
                return;
              }
              if (next !== repeat) {
                setError(new Error('The two new passwords are different.'));
                return;
              }
              try {
                await api('/auth/password', {
                  method: 'POST',
                  body: { currentPassword: current, newPassword: next },
                });
                setDone(true);
                setCurrent('');
                setNext('');
                setRepeat('');
              } catch (err) {
                setError(
                  err instanceof ApiError ? err : new Error('Could not change the password.'),
                );
              }
            }}
          >
            <label className="block">
              <span className="mb-1 block font-semibold">Current password</span>
              <input
                required
                type="password"
                autoComplete="current-password"
                className={`${inputClass} w-full`}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">New password</span>
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                className={`${inputClass} w-full`}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <span className="text-small text-muted">
                At least 8 characters, with a capital letter, a number and a symbol.
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">New password again</span>
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                className={`${inputClass} w-full`}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
            <ErrorNotice error={error} />
            {done && (
              <p className="rounded-control bg-sign-soft px-4 py-3 text-sign-deep">
                Password changed. Your other signed-in devices have been signed out.
              </p>
            )}
            <Button type="submit">Change password</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
