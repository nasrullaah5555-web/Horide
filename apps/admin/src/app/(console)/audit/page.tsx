'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  Button,
  Empty,
  ErrorNotice,
  inputClass,
  Loading,
  PageHeader,
  Panel,
} from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { dateTime, humanize } from '@/lib/format';

interface Entry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
}

const ENTITY_TYPES = [
  'admin_user',
  'driver',
  'passenger',
  'driver_document',
  'vehicle',
  'fare_version',
  'service_zone',
  'subscription',
  'subscription_plan',
  'payment',
  'complaint',
  'emergency_event',
  'trip',
  'notification',
];

export default function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  const load = async (before?: string) => {
    setLoading(true);
    try {
      const res = await api<{ entries: Entry[]; nextBefore: string | null }>(
        `/audit-logs${qs({ entityType, before, limit: 50 })}`,
      );
      setEntries((prev) => (before ? [...prev, ...res.entries] : res.entries));
      setNext(res.nextBefore);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error('Could not load the audit log.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  useEffect(() => {
    api<{ admins: { id: string; full_name: string }[] }>('/admins')
      .then((r) => setNames(Object.fromEntries(r.admins.map((a) => [a.id, a.full_name]))))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every important staff action, newest first. Entries can't be edited or deleted, by anyone."
      />
      <div className="mb-4">
        <select
          aria-label="What was changed"
          className={inputClass}
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
        >
          <option value="">Everything</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice error={error} />
      <Panel>
        {loading && !entries.length ? (
          <Loading />
        ) : !entries.length ? (
          <Empty>No entries.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Item</th>
                  <th>From</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td className="whitespace-nowrap">{dateTime(e.created_at)}</td>
                      <td>
                        {e.actor_type === 'admin'
                          ? (names[e.actor_id ?? ''] ?? 'Staff member')
                          : humanize(e.actor_type)}
                      </td>
                      <td className="font-semibold">{humanize(e.action)}</td>
                      <td>
                        {humanize(e.entity_type)}
                        {e.entity_id && (
                          <span className="block max-w-40 truncate text-sm text-muted">
                            {e.entity_id}
                          </span>
                        )}
                      </td>
                      <td className="text-sm text-muted">{e.ip ?? '—'}</td>
                      <td>
                        {(e.before !== null || e.after !== null) && (
                          <button
                            className="text-sm font-semibold underline-offset-2 hover:underline"
                            onClick={() => setOpen(open === e.id ? null : e.id)}
                          >
                            {open === e.id ? 'Hide details' : 'Details'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={6} className="bg-ground">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="text-sm font-semibold">Before</p>
                              <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                                {JSON.stringify(e.before, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <p className="text-sm font-semibold">After</p>
                              <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                                {JSON.stringify(e.after, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {next && (
          <div className="border-t border-line px-5 py-3">
            <Button variant="secondary" onClick={() => void load(next)} disabled={loading}>
              Show older entries
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
