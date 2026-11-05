'use client';

import Link from 'next/link';
import { use } from 'react';
import {
  ConfirmAction,
  ErrorNotice,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, etb, humanize, km } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface TripDetail {
  trip: {
    id: string;
    status: string;
    category: string;
    passenger_id: string;
    driver_id: string | null;
    pickup_text: string | null;
    destination_text: string | null;
    pickup_lat: number;
    pickup_lng: number;
    destination_lat: number;
    destination_lng: number;
    route_distance_m: number;
    route_is_estimate: boolean;
    quoted_fare: string;
    locked_fare: string | null;
    final_fare: string | null;
    payment_method: string;
    cancellation_fee: string | null;
    cancel_reason: string | null;
    cancelled_by: string | null;
  };
  events: {
    id: string;
    from_status: string | null;
    to_status: string;
    actor_type: string;
    created_at: string;
    data: Record<string, unknown> | null;
  }[];
  payment: {
    status: string;
    method: string;
    amount: string;
    ebirr_reference: string | null;
    resolution_note: string | null;
  } | null;
  offers: {
    driver_id: string;
    wave: number;
    distance_m: number;
    status: string;
    created_at: string;
  }[];
  route: unknown[];
}

const FINAL = new Set(['completed', 'cancelled', 'expired']);

function eventLabel(e: TripDetail['events'][number]): string {
  if (e.data && (e.data as { type?: string }).type === 'destination_changed') {
    const d = e.data as { newDestination?: string; newFare?: string; oldFare?: string };
    return `Destination changed to ${d.newDestination ?? 'a new pin'}, fare ${etb(d.oldFare)} to ${etb(d.newFare)}`;
  }
  const reason = e.data && (e.data as { reason?: string }).reason;
  return `${humanize(e.to_status)}${reason ? `: ${reason}` : ''}`;
}

export default function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<TripDetail>(`/trips/${id}`, 10_000);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  const { trip, events, payment, offers } = data;

  return (
    <>
      <p className="mb-2">
        <Link href="/trips" className="text-muted hover:underline">
          Trips
        </Link>
      </p>
      <PageHeader
        title={`${trip.pickup_text ?? 'Pickup pin'} to ${trip.destination_text ?? 'destination pin'}`}
        description={`${humanize(trip.category)}, ${km(trip.route_distance_m)}${trip.route_is_estimate ? ' (estimated distance, not a road route)' : ''}`}
        actions={
          can('trips.cancel') &&
          !FINAL.has(trip.status) && (
            <ConfirmAction
              label="Cancel trip"
              title="Cancel this trip?"
              body={
                trip.status === 'in_progress'
                  ? 'The ride is under way. Only cancel after speaking to the passenger and driver.'
                  : undefined
              }
              confirmLabel="Cancel trip"
              reasonLabel="Reason (recorded in the audit log)"
              variant="danger"
              onConfirm={async (reason) => {
                await api(`/trips/${id}/cancel`, { method: 'POST', body: { reason } });
                await reload();
              }}
            />
          )
        }
      />
      <ErrorNotice error={error} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Summary">
          <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-3 px-5 py-4">
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusBadge status={trip.status} />
            </dd>
            <dt className="text-muted">Quoted fare</dt>
            <dd className="tabular-nums">{etb(trip.quoted_fare)}</dd>
            <dt className="text-muted">Locked fare</dt>
            <dd className="tabular-nums">{etb(trip.locked_fare)}</dd>
            <dt className="text-muted">Final fare</dt>
            <dd className="font-bold tabular-nums">{etb(trip.final_fare)}</dd>
            <dt className="text-muted">Payment method</dt>
            <dd>{humanize(trip.payment_method)}</dd>
            {trip.cancelled_by && (
              <>
                <dt className="text-muted">Cancelled by</dt>
                <dd>
                  {humanize(trip.cancelled_by)}
                  {trip.cancel_reason ? `: ${trip.cancel_reason}` : ''}
                </dd>
              </>
            )}
            <dt className="text-muted">Passenger</dt>
            <dd>
              {can('users.read') ? (
                <Link className="hover:underline" href={`/trips?passengerId=${trip.passenger_id}`}>
                  Other trips by this passenger
                </Link>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-muted">Driver</dt>
            <dd>
              {trip.driver_id ? (
                <Link className="hover:underline" href={`/drivers/${trip.driver_id}`}>
                  Open driver
                </Link>
              ) : (
                'Not assigned'
              )}
            </dd>
          </dl>
          {payment && (
            <div className="border-t border-line px-5 py-4">
              <p className="font-bold">Payment record</p>
              <p className="mt-1">
                <StatusBadge status={payment.status} />{' '}
                <span className="ml-2 tabular-nums">{etb(payment.amount)}</span>{' '}
                <span className="text-muted">by {humanize(payment.method)}</span>
              </p>
              {payment.ebirr_reference && (
                <p className="mt-1 text-sm">
                  eBirr reference: {payment.ebirr_reference} (as typed by the driver, not verified)
                </p>
              )}
              {payment.resolution_note && (
                <p className="mt-1 text-sm">Resolution: {payment.resolution_note}</p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="What happened">
          <ol className="relative px-5 py-4">
            {events.map((e) => (
              <li key={e.id} className="relative border-l-2 border-line pb-4 pl-5 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-sign ring-2 ring-white"
                />
                <p className="font-semibold">{eventLabel(e)}</p>
                <p className="text-sm text-muted">
                  {dateTime(e.created_at)}, by {humanize(e.actor_type)}
                </p>
              </li>
            ))}
          </ol>
          {offers.length > 0 && (
            <div className="border-t border-line px-5 py-4 text-sm text-muted">
              Offered to {offers.length} driver{offers.length === 1 ? '' : 's'} in{' '}
              {Math.max(...offers.map((o) => o.wave))} round
              {Math.max(...offers.map((o) => o.wave)) === 1 ? '' : 's'}.
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
