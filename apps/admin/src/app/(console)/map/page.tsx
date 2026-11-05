'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ErrorNotice, Loading, PageHeader, Panel } from '@/components/ui';
import type { MapDriver } from '@/components/live-map';
import { humanize } from '@/lib/format';
import { useApi } from '@/lib/use-api';

// Leaflet touches `window`, so the map only renders in the browser.
const LiveMap = dynamic(() => import('@/components/live-map'), {
  ssr: false,
  loading: () => <Loading />,
});

export default function MapPage() {
  const { data, error } = useApi<{ drivers: MapDriver[]; liveThresholdSeconds: number }>(
    '/live-drivers',
    10_000,
  );
  const drivers = data?.drivers ?? [];
  const live = drivers.filter((d) => d.isLive);
  const onTrip = live.filter((d) => d.on_trip).length;

  return (
    <>
      <PageHeader
        title="Live map"
        description={
          data
            ? `${live.length} driver${live.length === 1 ? '' : 's'} with a live position, ${onTrip} on a ride. Positions older than ${data.liveThresholdSeconds} seconds are grey. Refreshes every 10 seconds.`
            : undefined
        }
      />
      <ErrorNotice error={error} />
      <div className="mb-3 flex flex-wrap gap-5 text-small">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-pill bg-sign" /> Available
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-pill bg-navy" /> On a ride
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-pill bg-stale" /> Position is stale
        </span>
      </div>
      <LiveMap drivers={drivers} />
      <div className="mt-6">
        <Panel title="Drivers online">
          {!drivers.length ? (
            <p className="px-5 py-8 text-center text-muted">No drivers are online.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Vehicle</th>
                    <th>Status</th>
                    <th>Last position</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.driver_id}>
                      <td>
                        <Link
                          className="font-semibold hover:underline"
                          href={`/drivers/${d.driver_id}`}
                        >
                          {d.full_name ?? 'Driver'}
                        </Link>
                      </td>
                      <td>
                        {d.plate_number ?? '—'} {d.category ? `(${humanize(d.category)})` : ''}
                      </td>
                      <td>{d.on_trip ? 'On a ride' : 'Available'}</td>
                      <td className={d.isLive ? '' : 'text-amber'}>
                        {d.isLive ? 'Live' : `${d.age_seconds}s ago`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
