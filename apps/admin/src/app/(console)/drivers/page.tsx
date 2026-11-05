'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
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
import { date } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface DriverRow {
  id: string;
  phone: string | null;
  status: string;
  full_name: string | null;
  approval_status: string;
  rating_avg: string;
  created_at: string;
  pending_documents: number;
}

function DriversList() {
  const router = useRouter();
  const params = useSearchParams();
  const approval = params.get('approval') ?? '';
  const [search, setSearch] = useState(params.get('search') ?? '');
  const { data, error, loading } = useApi<{ drivers: DriverRow[] }>(
    `/drivers${qs({ approval, search: params.get('search') })}`,
  );

  const setFilter = (next: Record<string, string>) => {
    const merged = { approval, search: params.get('search') ?? '', ...next };
    router.replace(`/drivers${qs(merged)}`);
  };

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Review new drivers, their documents and vehicles. Drivers can only receive rides once approved and subscribed."
      />
      <form
        className="mb-4 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ search });
        }}
      >
        <label className="sr-only" htmlFor="driver-search">
          Search by name or phone
        </label>
        <input
          id="driver-search"
          className={`${inputClass} w-64`}
          placeholder="Name or phone number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Approval status"
          className={inputClass}
          value={approval}
          onChange={(e) => setFilter({ approval: e.target.value })}
        >
          <option value="">All drivers</option>
          <option value="pending">Waiting for approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </form>
      <ErrorNotice error={error} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : !data?.drivers.length ? (
          <Empty>
            {approval === 'pending'
              ? 'No drivers are waiting for approval.'
              : 'No drivers match this search.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Approval</th>
                  <th>Account</th>
                  <th>Documents to review</th>
                  <th>Rating</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.drivers.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link className="font-semibold hover:underline" href={`/drivers/${d.id}`}>
                        {d.full_name ?? 'Name not entered yet'}
                      </Link>
                    </td>
                    <td className="tabular-nums">{d.phone ?? 'Deleted'}</td>
                    <td>
                      <StatusBadge status={d.approval_status} />
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td>
                      {d.pending_documents > 0 ? (
                        <span className="font-bold text-amber">{d.pending_documents}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td>
                      {Number(d.rating_avg) > 0 ? Number(d.rating_avg).toFixed(2) : 'No ratings'}
                    </td>
                    <td>{date(d.created_at)}</td>
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

export default function DriversPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DriversList />
    </Suspense>
  );
}
