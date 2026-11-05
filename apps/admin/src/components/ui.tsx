'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ground text-muted ring-line',
  good: 'bg-sign-soft text-sign-deep ring-sign/30',
  warn: 'bg-amber-soft text-amber ring-amber/30',
  danger: 'bg-signal-soft text-signal ring-signal/30',
  info: 'bg-[#e8eef5] text-navy-soft ring-navy/15',
};

const STATUS_TONE: Record<string, Tone> = {
  approved: 'good',
  active: 'good',
  completed: 'good',
  confirmed: 'good',
  resolved: 'good',
  closed: 'neutral',
  pending: 'warn',
  in_review: 'warn',
  driver_recorded: 'info',
  searching: 'info',
  requested: 'info',
  accepted: 'info',
  driver_arriving: 'info',
  arrived: 'info',
  in_progress: 'info',
  open: 'warn',
  rejected: 'danger',
  suspended: 'danger',
  disputed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
  disabled: 'neutral',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ring-1 ${TONES[tone]}`}
    >
      {humanize(status)}
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const styles = {
    primary: 'bg-navy text-white hover:bg-navy-soft disabled:opacity-50',
    secondary: 'bg-white text-navy ring-1 ring-line hover:bg-ground disabled:opacity-50',
    danger: 'bg-signal text-white hover:brightness-110 disabled:opacity-50',
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-md px-4 py-2 text-[15px] font-semibold ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-white ring-1 ring-line">
      {title && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[17px] font-bold">{title}</h2>
          {actions}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}

export function ErrorNotice({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mb-4 rounded-md bg-signal-soft px-4 py-3 text-signal">
      {error.message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-muted">{children}</p>;
}

export function Loading() {
  return <p className="px-5 py-10 text-center text-muted">Loading…</p>;
}

/**
 * Confirmation for consequential actions. When `reasonLabel` is set, a written reason is required
 * (the API rejects these actions without one, and the reason goes into the audit log).
 */
export function ConfirmAction({
  label,
  title,
  body,
  confirmLabel,
  reasonLabel,
  variant = 'primary',
  onConfirm,
}: {
  label: string;
  title: string;
  body?: string;
  confirmLabel: string;
  reasonLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onConfirm: (reason: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      ref.current?.close();
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={variant === 'danger' ? 'secondary' : variant}
        onClick={() => ref.current?.showModal()}
      >
        {label}
      </Button>
      <dialog ref={ref} className="m-auto w-[min(480px,92vw)] rounded-lg p-0 text-navy shadow-xl">
        <form onSubmit={submit} className="space-y-4 p-6">
          <h2 className="text-xl font-bold">{title}</h2>
          {body && <p className="text-muted">{body}</p>}
          {reasonLabel && (
            <label className="block">
              <span className="mb-1 block font-semibold">{reasonLabel}</span>
              <textarea
                required
                minLength={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-line px-3 py-2"
              />
            </label>
          )}
          <ErrorNotice error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant={variant} disabled={busy}>
              {busy ? 'Saving…' : confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export const inputClass = 'rounded-md border border-line bg-white px-3 py-2';
