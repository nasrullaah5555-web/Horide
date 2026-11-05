'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  ConfirmAction,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Complaint {
  id: string;
  trip_id: string | null;
  reporter_id: string;
  against_user_id: string | null;
  category: string;
  description: string;
  status: string;
  resolution: string | null;
  created_at: string;
}

export default function ComplaintsPage() {
  const { can } = useSession();
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading, reload } = useApi<{ complaints: Complaint[] }>(
    `/complaints?open=${showAll ? 'false' : 'true'}`,
  );
  const [actionError, setActionError] = useState<Error | null>(null);

  const update = async (id: string, body: object) => {
    setActionError(null);
    await api(`/complaints/${id}`, { method: 'POST', body });
    await reload();
  };

  return (
    <>
      <PageHeader
        title="Complaints"
        description="Reports from passengers and drivers. Safety complaints first."
        actions={
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="h-4 w-4 accent-[#14283e]"
            />
            Include resolved
          </label>
        }
      />
      <ErrorNotice error={error ?? actionError} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : !data?.complaints.length ? (
          <Empty>No open complaints.</Empty>
        ) : (
          <ul>
            {[...data.complaints]
              .sort((a, b) => Number(b.category === 'safety') - Number(a.category === 'safety'))
              .map((c) => (
                <li key={c.id} className="border-b border-line px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={c.status} />
                    <span className={`font-bold ${c.category === 'safety' ? 'text-signal' : ''}`}>
                      {humanize(c.category)}
                    </span>
                    <span className="text-sm text-muted">{dateTime(c.created_at)}</span>
                    {c.trip_id && can('trips.read') && (
                      <Link
                        className="text-sm font-semibold hover:underline"
                        href={`/trips/${c.trip_id}`}
                      >
                        Open the trip
                      </Link>
                    )}
                  </div>
                  <p className="mt-2 max-w-[75ch] whitespace-pre-wrap">{c.description}</p>
                  {c.resolution && (
                    <p className="mt-2 rounded-md bg-ground px-3 py-2">
                      Resolution: {c.resolution}
                    </p>
                  )}
                  {can('complaints.write') && (c.status === 'open' || c.status === 'in_review') && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.status === 'open' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            update(c.id, { status: 'in_review' }).catch((e) =>
                              setActionError(e instanceof ApiError ? e : new Error('Failed.')),
                            )
                          }
                        >
                          Start review
                        </Button>
                      )}
                      <ConfirmAction
                        label="Resolve"
                        title="Resolve this complaint?"
                        confirmLabel="Resolve"
                        reasonLabel="What was done (the reporter can see this)"
                        onConfirm={(resolution) => update(c.id, { status: 'resolved', resolution })}
                      />
                    </div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
