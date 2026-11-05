'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ConfirmAction,
  Empty,
  ErrorNotice,
  inputClass,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Passenger {
  id: string;
  phone: string;
  status: string;
  suspended_reason: string | null;
  full_name: string | null;
  created_at: string;
  completed_trips: number;
}

export default function PassengersPage() {
  const { can } = useSession();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<{ passengers: Passenger[] }>(
    `/passengers${qs({ search, status })}`,
  );

  return (
    <>
      <PageHeader
        title="Passengers"
        description="Find a passenger by name or phone number. Suspended passengers cannot request rides."
      />
      <form
        className="mb-4 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor="passenger-search">
          Search by name or phone
        </label>
        <input
          id="passenger-search"
          className={`${inputClass} w-64`}
          placeholder="Name or phone number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <select
          aria-label="Account status"
          className={inputClass}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All accounts</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </form>
      <ErrorNotice error={error} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : !data?.passengers.length ? (
          <Empty>No passengers match this search.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Account</th>
                  <th>Completed trips</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.passengers.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.full_name ?? 'No name'}</td>
                    <td className="tabular-nums">{p.phone}</td>
                    <td>
                      <StatusBadge status={p.status} />
                      {p.suspended_reason && (
                        <p className="mt-1 max-w-56 text-small text-muted">{p.suspended_reason}</p>
                      )}
                    </td>
                    <td>
                      {can('trips.read') ? (
                        <Link className="hover:underline" href={`/trips?passengerId=${p.id}`}>
                          {p.completed_trips}
                        </Link>
                      ) : (
                        p.completed_trips
                      )}
                    </td>
                    <td>{date(p.created_at)}</td>
                    <td className="text-right">
                      {can('users.suspend') &&
                        (p.status === 'active' ? (
                          <ConfirmAction
                            label="Suspend"
                            title={`Suspend ${p.full_name ?? 'this passenger'}?`}
                            body="They will not be able to request rides until reinstated."
                            confirmLabel="Suspend passenger"
                            reasonLabel="Reason (recorded in the audit log)"
                            variant="danger"
                            onConfirm={async (reason) => {
                              await api(`/passengers/${p.id}/suspend`, {
                                method: 'POST',
                                body: { reason },
                              });
                              await reload();
                            }}
                          />
                        ) : (
                          <ConfirmAction
                            label="Reinstate"
                            title={`Reinstate ${p.full_name ?? 'this passenger'}?`}
                            confirmLabel="Reinstate"
                            onConfirm={async () => {
                              await api(`/passengers/${p.id}/reinstate`, {
                                method: 'POST',
                                body: {},
                              });
                              await reload();
                            }}
                          />
                        ))}
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
