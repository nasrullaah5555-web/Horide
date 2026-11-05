'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  Empty,
  ErrorNotice,
  inputClass,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { qs } from '@/lib/api';
import { dateTime, etb, humanize } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface TripRow {
  id: string;
  status: string;
  category: string;
  pickup_text: string | null;
  destination_text: string | null;
  quoted_fare: string;
  final_fare: string | null;
  payment_method: string;
  requested_at: string;
  passenger_name: string | null;
  driver_name: string | null;
  cancelled_by: string | null;
}

const STATUSES = [
  'searching',
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
];

function TripsList() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = {
    status: params.get('status') ?? '',
    driverId: params.get('driverId') ?? '',
    passengerId: params.get('passengerId') ?? '',
  };
  const { data, error, loading } = useApi<{ trips: TripRow[] }>(
    `/trips${qs({ ...filters, limit: 100 })}`,
    20_000,
  );

  return (
    <>
      <PageHeader
        title="Trips"
        description={
          filters.driverId
            ? 'Trips by one driver.'
            : filters.passengerId
              ? 'Trips by one passenger.'
              : 'Most recent first. Refreshes every 20 seconds.'
        }
        actions={
          (filters.driverId || filters.passengerId) && (
            <Link className="font-semibold hover:underline" href="/trips">
              Show all trips
            </Link>
          )
        }
      />
      <div className="mb-4">
        <select
          aria-label="Trip status"
          className={inputClass}
          value={filters.status}
          onChange={(e) => router.replace(`/trips${qs({ ...filters, status: e.target.value })}`)}
        >
          <option value="">Every status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice error={error} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : !data?.trips.length ? (
          <Empty>No trips match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Passenger</th>
                  <th>Driver</th>
                  <th>Vehicle</th>
                  <th className="text-right">Fare</th>
                </tr>
              </thead>
              <tbody>
                {data.trips.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">
                      <Link className="font-semibold hover:underline" href={`/trips/${t.id}`}>
                        {dateTime(t.requested_at)}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="max-w-48 truncate">{t.pickup_text ?? 'Pin on map'}</td>
                    <td className="max-w-48 truncate">{t.destination_text ?? 'Pin on map'}</td>
                    <td>{t.passenger_name ?? 'No name'}</td>
                    <td>{t.driver_name ?? '—'}</td>
                    <td>{humanize(t.category)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {etb(t.final_fare ?? t.quoted_fare)}
                      <span className="block text-small text-muted">
                        {humanize(t.payment_method)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export default function TripsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TripsList />
    </Suspense>
  );
}
