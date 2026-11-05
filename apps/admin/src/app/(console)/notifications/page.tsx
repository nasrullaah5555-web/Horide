'use client';

import { useRef, useState } from 'react';
import { Button, ErrorNotice, inputClass, PageHeader, Panel } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const AUDIENCES = {
  approved_drivers: 'Approved drivers',
  all_drivers: 'All drivers, including those not yet approved',
  all_passengers: 'All passengers',
} as const;

export default function AnnouncementsPage() {
  const [audience, setAudience] = useState<keyof typeof AUDIENCES>('approved_drivers');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ recipients: number }>('/notifications', {
        method: 'POST',
        body: { audience, title, body },
      });
      setSent(`Sent to ${res.recipients} ${res.recipients === 1 ? 'person' : 'people'}.`);
      setTitle('');
      setBody('');
      confirmRef.current?.close();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error('Could not send.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Send a message to a group. It appears in their app inbox and as a phone notification. It cannot be unsent."
      />
      <div className="max-w-2xl">
        <Panel>
          <form
            className="space-y-4 px-5 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              setSent(null);
              confirmRef.current?.showModal();
            }}
          >
            <label className="block">
              <span className="mb-1 block font-semibold">Send to</span>
              <select
                className={`${inputClass} w-full`}
                value={audience}
                onChange={(e) => setAudience(e.target.value as keyof typeof AUDIENCES)}
              >
                {Object.entries(AUDIENCES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">Title</span>
              <input
                required
                maxLength={120}
                className={`${inputClass} w-full`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">Message</span>
              <textarea
                required
                maxLength={500}
                rows={4}
                className={`${inputClass} w-full`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <span className="text-sm text-muted">
                {500 - body.length} characters left. Write in plain, short English.
              </span>
            </label>
            <ErrorNotice error={error} />
            {sent && <p className="rounded-md bg-sign-soft px-4 py-3 text-sign-deep">{sent}</p>}
            <Button type="submit">Review and send</Button>
          </form>
        </Panel>
      </div>
      <dialog
        ref={confirmRef}
        className="m-auto w-[min(520px,92vw)] rounded-lg p-0 text-navy shadow-xl"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-xl font-bold">Send to {AUDIENCES[audience].toLowerCase()}?</h2>
          <div className="rounded-md bg-ground px-4 py-3">
            <p className="font-bold">{title}</p>
            <p className="whitespace-pre-wrap">{body}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => confirmRef.current?.close()}>
              Edit
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending…' : 'Send announcement'}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
