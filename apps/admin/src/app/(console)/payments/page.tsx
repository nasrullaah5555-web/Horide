'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
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
import { dateTime, etb, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { market, PAYMENT_LABEL } from '@/lib/market';

interface Payment {
  id: string;
  trip_id: string;
  method: string;
  amount: string;
  status: string;
  ebirr_reference: string | null;
  completed_at: string | null;
  confirmations: { party: string; outcome: string; note: string | null; created_at: string }[];
}

function Payments() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get('status') ?? '';
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<{ payments: Payment[] }>(
    `/payments${qs({ status, limit: 100 })}`,
  );

  return (
    <>
      <PageHeader
        title="Ride payments"
        description={`Passengers pay drivers directly (${market.paymentMethods.map((m) => PAYMENT_LABEL[m]).join(', ')}). Musride only records what each side reports. References are typed by the driver and not checked against the payment service.`}
      />
      <div className="mb-4">
        <select
          aria-label="Payment status"
          className={inputClass}
          value={status}
          onChange={(e) => router.replace(`/payments${qs({ status: e.target.value })}`)}
        >
          <option value="">Every status</option>
          <option value="disputed">Disputed</option>
          <option value="pending">Not recorded yet</option>
          <option value="driver_recorded">Driver recorded, passenger not yet</option>
          <option value="confirmed">Confirmed by both</option>
          <option value="resolved">Resolved by Musride</option>
        </select>
      </div>
      <ErrorNotice error={error} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : !data?.payments.length ? (
          <Empty>
            {status === 'disputed' ? 'No disputed payments.' : 'No payments match this filter.'}
          </Empty>
        ) : (
          <ul>
            {data.payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0"
              >
                <div>
                  <p className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={p.status} />
                    <span className="text-title font-bold tabular-nums">{etb(p.amount)}</span>
                    <span className="text-muted">{humanize(p.method)}</span>
                    {p.ebirr_reference && (
                      <span className="text-small">Ref. {p.ebirr_reference}</span>
                    )}
                  </p>
                  <p className="mt-1 text-small text-muted">
                    Trip completed {dateTime(p.completed_at)}.{' '}
                    {can('trips.read') && (
                      <Link
                        className="font-semibold text-navy hover:underline"
                        href={`/trips/${p.trip_id}`}
                      >
                        Open the trip
                      </Link>
                    )}
                  </p>
                  <ul className="mt-2 space-y-1 text-small">
                    {p.confirmations.map((c) => (
                      <li key={c.party}>
                        <span className="font-semibold">{humanize(c.party)}</span>{' '}
                        {c.outcome === 'confirmed' ? 'confirmed' : 'disputed'}{' '}
                        {dateTime(c.created_at)}
                        {c.note ? `: “${c.note}”` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                {p.status === 'disputed' && can('payments.resolve') && (
                  <ConfirmAction
                    label="Resolve dispute"
                    title="Resolve this payment dispute?"
                    body="Speak to both the passenger and the driver first. Once resolved, neither side can change this payment."
                    confirmLabel="Resolve dispute"
                    reasonLabel="Outcome (recorded in the audit log)"
                    onConfirm={async (note) => {
                      await api(`/payments/${p.id}/resolve`, { method: 'POST', body: { note } });
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

export default function PaymentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Payments />
    </Suspense>
  );
}
