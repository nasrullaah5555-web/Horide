'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  Button,
  ConfirmAction,
  Empty,
  ErrorNotice,
  inputClass,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { date, dateTime, etb, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { market, PAYMENT_LABEL } from '@/lib/market';

interface Sub {
  id: string;
  driver_id: string;
  full_name: string | null;
  phone: string;
  plan_name: string;
  status: string;
  starts_at: string;
  ends_at: string;
}
interface Plan {
  id: string;
  name: string;
  category: string | null;
  price: string;
  duration_days: number;
  active: boolean;
}
interface DriverOption {
  id: string;
  full_name: string | null;
  phone: string;
}

function RecordPayment({
  plans,
  onDone,
  driverId,
}: {
  plans: Plan[];
  onDone: () => void;
  driverId?: string;
}) {
  const drivers = useApi<{ drivers: DriverOption[] }>('/drivers?approval=approved&limit=100');
  const active = plans.filter((p) => p.active);
  const [form, setForm] = useState({
    driverId: driverId ?? '',
    planId: active[0]?.id ?? '',
    method: 'cash',
    reference: '',
    receivedAt: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = active.find((p) => p.id === form.planId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await api<{ subscription: { ends_at: string } }>('/subscriptions', {
        method: 'POST',
        body: {
          driverId: form.driverId,
          planId: plan.id,
          amount: Number(plan.price) / 100, // the API takes whole currency units and checks it equals the plan price
          method: form.method,
          reference: form.reference || undefined,
          receivedAt: new Date(`${form.receivedAt}T12:00:00+03:00`).toISOString(),
        },
      });
      setDone(
        `Payment recorded. Subscription now runs until ${dateTime(res.subscription.ends_at)}.`,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error('Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  };

  if (!active.length) return <Empty>Create a subscription plan first.</Empty>;
  return (
    <form onSubmit={submit} className="grid gap-4 px-5 py-4 md:grid-cols-2">
      <label className="block md:col-span-2">
        <span className="mb-1 block font-semibold">Driver</span>
        <select
          required
          className={`${inputClass} w-full`}
          value={form.driverId}
          onChange={(e) => setForm({ ...form, driverId: e.target.value })}
        >
          <option value="">Choose an approved driver</option>
          {drivers.data?.drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name ?? 'No name'}, {d.phone}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block font-semibold">Plan</span>
        <select
          className={`${inputClass} w-full`}
          value={form.planId}
          onChange={(e) => setForm({ ...form, planId: e.target.value })}
        >
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}: {etb(p.price)} for {p.duration_days} days
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block font-semibold">Date received</span>
        <input
          type="date"
          required
          max={new Date().toISOString().slice(0, 10)}
          className={`${inputClass} w-full`}
          value={form.receivedAt}
          onChange={(e) => setForm({ ...form, receivedAt: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-semibold">Paid by</span>
        <select
          className={`${inputClass} w-full`}
          value={form.method}
          onChange={(e) => setForm({ ...form, method: e.target.value })}
        >
          {market.paymentMethods.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block font-semibold">
          {form.method === 'cash'
            ? 'Receipt number (optional)'
            : `${PAYMENT_LABEL[form.method]} transaction reference`}
        </span>
        <input
          required={form.method !== 'cash'}
          maxLength={60}
          className={`${inputClass} w-full`}
          value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })}
        />
      </label>
      <div className="md:col-span-2">
        <ErrorNotice error={error} />
        {done && (
          <p className="mb-3 rounded-control bg-sign-soft px-4 py-3 text-sign-deep">{done}</p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Recording…' : `Record ${plan ? etb(plan.price) : ''} payment`}
        </Button>
        <p className="mt-2 text-small text-muted">
          Only record money you have actually received. If the driver already has time left, the new
          period starts when it ends.
        </p>
      </div>
    </form>
  );
}

function NewPlan({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', price: '', durationDays: '30' });
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3 px-5 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api('/subscription-plans', {
            method: 'POST',
            body: {
              name: form.name,
              price: Number(form.price),
              durationDays: Number(form.durationDays),
            },
          });
          setForm({ name: '', price: '', durationDays: '30' });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed.'));
        }
      }}
    >
      <label>
        <span className="mb-1 block font-semibold">Plan name</span>
        <input
          required
          maxLength={60}
          className={inputClass}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        <span className="mb-1 block font-semibold">Price ({market.currency})</span>
        <input
          required
          type="number"
          min="0"
          step="0.01"
          className={`${inputClass} w-32`}
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
      </label>
      <label>
        <span className="mb-1 block font-semibold">Days</span>
        <input
          required
          type="number"
          min="1"
          max="366"
          className={`${inputClass} w-24`}
          value={form.durationDays}
          onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
        />
      </label>
      <Button type="submit" variant="secondary">
        Add plan
      </Button>
      <div className="w-full">
        <ErrorNotice error={error} />
      </div>
    </form>
  );
}

function Subscriptions() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();
  const status = params.get('status') ?? 'active';
  const driverId = params.get('driverId') ?? undefined;
  const list = useApi<{ subscriptions: Sub[] }>(`/subscriptions${qs({ status, limit: 200 })}`);
  const plans = useApi<{ plans: Plan[] }>('/subscription-plans');
  const history = useApi<{
    payments: {
      id: string;
      amount: string;
      method: string;
      reference: string | null;
      received_at: string;
      starts_at: string;
      ends_at: string;
      status: string;
    }[];
  }>(driverId ? `/drivers/${driverId}/subscription-payments` : null);
  const shown = driverId
    ? list.data?.subscriptions.filter((s) => s.driver_id === driverId)
    : list.data?.subscriptions;
  const reloadAll = () => {
    void list.reload();
    void history.reload();
  };

  return (
    <>
      <PageHeader
        title="Driver subscriptions"
        description="Drivers pay Musride a monthly subscription to receive rides. Record each payment here after you have received it."
      />
      <ErrorNotice error={list.error ?? plans.error} />

      {can('subscriptions.write') && plans.data && (
        <div className="mb-6">
          <Panel title="Record a subscription payment">
            <RecordPayment plans={plans.data.plans} driverId={driverId} onDone={reloadAll} />
          </Panel>
        </div>
      )}

      {driverId && history.data && (
        <div className="mb-6">
          <Panel
            title="This driver’s payments"
            actions={
              <Link className="text-small font-semibold hover:underline" href="/subscriptions">
                Show all drivers
              </Link>
            }
          >
            {!history.data.payments.length ? (
              <Empty>No subscription payments recorded for this driver.</Empty>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Period</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{date(p.received_at)}</td>
                      <td className="tabular-nums">{etb(p.amount)}</td>
                      <td>
                        {humanize(p.method)}
                        {p.reference ? `, ${p.reference}` : ''}
                      </td>
                      <td>
                        {date(p.starts_at)} to {date(p.ends_at)}
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}

      <div className="mb-4">
        <select
          aria-label="Subscription status"
          className={inputClass}
          value={status}
          onChange={(e) =>
            router.replace(`/subscriptions${qs({ status: e.target.value, driverId })}`)
          }
        >
          <option value="active">Active now</option>
          <option value="expiring">Ending within 7 days</option>
          <option value="expired">Ended</option>
        </select>
      </div>
      <Panel>
        {list.loading && !list.data ? (
          <Loading />
        ) : !shown?.length ? (
          <Empty>No subscriptions in this list.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Plan</th>
                  <th>From</th>
                  <th>Until</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link
                        className="font-semibold hover:underline"
                        href={`/drivers/${s.driver_id}`}
                      >
                        {s.full_name ?? 'No name'}
                      </Link>
                      <span className="block text-small text-muted">{s.phone}</span>
                    </td>
                    <td>{s.plan_name}</td>
                    <td>{date(s.starts_at)}</td>
                    <td>{date(s.ends_at)}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="text-right">
                      {can('subscriptions.write') && s.status === 'active' && (
                        <ConfirmAction
                          label="Cancel"
                          title="Cancel this subscription period?"
                          body="Use this only to correct a mistake, such as a payment recorded for the wrong driver. A ride in progress is not interrupted."
                          confirmLabel="Cancel period"
                          reasonLabel="Reason (recorded in the audit log)"
                          variant="danger"
                          onConfirm={async (reason) => {
                            await api(`/subscriptions/${s.id}/cancel`, {
                              method: 'POST',
                              body: { reason },
                            });
                            reloadAll();
                          }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {can('subscriptions.write') && (
        <div className="mt-6">
          <Panel title="Plans">
            <ul>
              {plans.data?.plans.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between border-b border-line px-5 py-3"
                >
                  <span>
                    <span className="font-semibold">{p.name}</span>: {etb(p.price)} for{' '}
                    {p.duration_days} days
                    {p.category ? `, ${humanize(p.category)} only` : ''}
                  </span>
                  {!p.active && <StatusBadge status="disabled" />}
                </li>
              ))}
            </ul>
            <NewPlan onDone={() => void plans.reload()} />
          </Panel>
        </div>
      )}
    </>
  );
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Subscriptions />
    </Suspense>
  );
}
