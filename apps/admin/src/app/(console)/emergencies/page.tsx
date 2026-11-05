'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ConfirmAction, Empty, ErrorNotice, Loading, PageHeader, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { ago, dateTime, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Emergency {
  id: string;
  trip_id: string | null;
  phone: string;
  role: string;
  created_at: string;
  handled_at: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
}

export default function EmergenciesPage() {
  const { can } = useSession();
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading, reload } = useApi<{ emergencies: Emergency[] }>(
    `/emergencies?open=${showAll ? 'false' : 'true'}`,
    10_000,
  );

  return (
    <>
      <PageHeader
        title="Emergency alerts"
        description="Raised from the emergency button in the apps. Call the person first. If life is at risk, they have been shown Police 991 and Ambulance 907. Refreshes every 10 seconds."
        actions={
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="h-4 w-4 accent-navy"
            />
            Include handled alerts
          </label>
        }
      />
      <ErrorNotice error={error} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : !data?.emergencies.length ? (
          <Empty>No open emergency alerts.</Empty>
        ) : (
          <ul>
            {data.emergencies.map((e) => (
              <li
                key={e.id}
                className={`flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0 ${
                  e.handled_at ? '' : 'border-l-4 border-l-signal'
                }`}
              >
                <div>
                  <p className="text-title font-bold">
                    {humanize(e.role)}{' '}
                    <a
                      className="tabular-nums underline-offset-2 hover:underline"
                      href={`tel:${e.phone}`}
                    >
                      {e.phone}
                    </a>
                  </p>
                  <p className="text-muted">
                    Raised {dateTime(e.created_at)} ({ago(e.created_at)})
                  </p>
                  <p className="mt-1 text-small">
                    {e.lat !== null && e.lng !== null ? (
                      <a
                        className="font-semibold underline-offset-2 hover:underline"
                        href={`https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=17/${e.lat}/${e.lng}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Position {e.lat.toFixed(5)}, {e.lng.toFixed(5)} (open map)
                      </a>
                    ) : (
                      'No position was sent'
                    )}
                    {e.trip_id && can('trips.read') && (
                      <>
                        {', '}
                        <Link
                          className="font-semibold hover:underline"
                          href={`/trips/${e.trip_id}`}
                        >
                          open the trip
                        </Link>
                      </>
                    )}
                  </p>
                  {e.notes && (
                    <p className="mt-2 rounded-control bg-ground px-3 py-2">Handled: {e.notes}</p>
                  )}
                </div>
                {!e.handled_at && can('emergencies.write') && (
                  <ConfirmAction
                    label="Mark handled"
                    title="Mark this alert as handled?"
                    confirmLabel="Mark handled"
                    reasonLabel="What was done"
                    onConfirm={async (notes) => {
                      await api(`/emergencies/${e.id}/handle`, { method: 'POST', body: { notes } });
                      await reload();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
