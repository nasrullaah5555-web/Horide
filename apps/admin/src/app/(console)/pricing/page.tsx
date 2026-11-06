'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Button, ErrorNotice, inputClass, Loading, PageHeader, Panel } from '@/components/ui';
import type { MapZone } from '@/components/live-map';
import { api, ApiError } from '@/lib/api';
import { dateTime, etb, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { market } from '@/lib/market';

const LiveMap = dynamic(() => import('@/components/live-map'), {
  ssr: false,
  loading: () => <Loading />,
});

interface FareVersion {
  id: string;
  category: string;
  base_fare: string;
  per_km: string;
  minimum_fare: string;
  rounding_unit: string;
  waiting_per_min: string;
  free_waiting_minutes: number;
  cancellation_fee: string;
  note: string | null;
  created_at: string;
}

/** Same arithmetic as the server's fare engine, for previewing a new price before saving it. */
function previewFare(
  km: number,
  v: { base: number; perKm: number; min: number; round: number },
): number {
  const raw = v.base + Math.round(km * 1000 * v.perKm) / 1000;
  const fare = Math.max(raw, v.min);
  return v.round > 0 ? Math.ceil(fare / v.round - 1e-9) * v.round : fare;
}

function NewPrice({
  category,
  current,
  onDone,
}: {
  category: string;
  current?: FareVersion;
  onDone: () => void;
}) {
  const toEtb = (s?: string) => (s ? String(Number(s) / 100) : '');
  const [f, setF] = useState({
    baseFare: toEtb(current?.base_fare),
    perKm: toEtb(current?.per_km),
    minimumFare: toEtb(current?.minimum_fare),
    roundingUnit: toEtb(current?.rounding_unit) || '5',
    cancellationFee: toEtb(current?.cancellation_fee) || '0',
    note: '',
  });
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const v = {
    base: Number(f.baseFare),
    perKm: Number(f.perKm),
    min: Number(f.minimumFare),
    round: Number(f.roundingUnit),
  };
  const valid =
    [v.base, v.perKm, v.min, v.round].every((n) => Number.isFinite(n) && n >= 0) && v.round > 0;
  const field = (key: keyof typeof f, label: string) => (
    <label className="block">
      <span className="mb-1 block text-small font-semibold">{label}</span>
      <input
        required
        type="number"
        min="0"
        step="0.01"
        className={`${inputClass} w-full`}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <form
      className="space-y-4 px-5 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/pricing/${category}`, {
            method: 'POST',
            body: {
              baseFare: Number(f.baseFare),
              perKm: Number(f.perKm),
              minimumFare: Number(f.minimumFare),
              roundingUnit: Number(f.roundingUnit),
              cancellationFee: Number(f.cancellationFee),
              note: f.note,
            },
          });
          setF({ ...f, note: '' });
          onDone();
        } catch (err) {
          setError(err instanceof ApiError ? err : new Error('Could not save the price.'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-5">
        {field('baseFare', `Base fare (${market.currency})`)}
        {field('perKm', `Per km (${market.currency})`)}
        {field('minimumFare', `Minimum fare (${market.currency})`)}
        {field('roundingUnit', `Round up to (${market.currency})`)}
        {field('cancellationFee', `Cancellation fee (${market.currency})`)}
      </div>
      {valid && (
        <p className="text-small text-muted">
          With these prices: 2 km costs {previewFare(2, v).toFixed(2)} {market.currency}, 5 km costs{' '}
          {previewFare(5, v).toFixed(2)} {market.currency}, 10 km costs{' '}
          {previewFare(10, v).toFixed(2)} {market.currency}.
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-small font-semibold">
          Why are prices changing? (recorded in the audit log)
        </span>
        <input
          required
          minLength={3}
          maxLength={200}
          className={`${inputClass} w-full`}
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
      </label>
      <ErrorNotice error={error} />
      <Button type="submit" disabled={busy || !valid}>
        {busy ? 'Saving…' : `Save new ${humanize(category).toLowerCase()} prices`}
      </Button>
      <p className="text-small text-muted">
        New prices apply to new price quotes only. Trips already quoted or under way keep the price
        they were given.
      </p>
    </form>
  );
}

export default function PricingPage() {
  const { can } = useSession();
  const pricing = useApi<{ current: FareVersion[]; history: FareVersion[] }>('/pricing');
  const zones = useApi<{ zones: (MapZone & { id: string; updated_at: string })[] }>('/zones');
  const zoneList = useMemo(() => zones.data?.zones ?? [], [zones.data]);

  return (
    <>
      <PageHeader
        title="Prices and service area"
        description="Fare = base fare + distance × price per km, never below the minimum, rounded up. Prices are calculated by the server for every quote."
      />
      <ErrorNotice error={pricing.error ?? zones.error} />
      {pricing.data && (
        <div className="grid gap-6 xl:grid-cols-2">
          {['car', 'bajaj'].map((category) => {
            const current = pricing.data!.current.find((v) => v.category === category);
            return (
              <Panel key={category} title={humanize(category)}>
                {current ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 sm:grid-cols-[auto_1fr]">
                    <dt className="text-muted">Base fare</dt>
                    <dd className="font-semibold tabular-nums">{etb(current.base_fare)}</dd>
                    <dt className="text-muted">Per km</dt>
                    <dd className="font-semibold tabular-nums">{etb(current.per_km)}</dd>
                    <dt className="text-muted">Minimum fare</dt>
                    <dd className="font-semibold tabular-nums">{etb(current.minimum_fare)}</dd>
                    <dt className="text-muted">Rounded up to</dt>
                    <dd className="font-semibold tabular-nums">{etb(current.rounding_unit)}</dd>
                    <dt className="text-muted">Cancellation fee</dt>
                    <dd className="font-semibold tabular-nums">{etb(current.cancellation_fee)}</dd>
                    <dt className="text-muted">Since</dt>
                    <dd>
                      {dateTime(current.created_at)}
                      {current.note ? `: ${current.note}` : ''}
                    </dd>
                  </dl>
                ) : (
                  <p className="border-b border-line px-5 py-4 text-amber">
                    No prices set. Passengers cannot book this vehicle type.
                  </p>
                )}
                {can('pricing.write') && (
                  <NewPrice
                    category={category}
                    current={current}
                    onDone={() => void pricing.reload()}
                  />
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {pricing.data && pricing.data.history.length > 2 && (
        <div className="mt-6">
          <Panel title="Price history">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Vehicle</th>
                    <th>Base</th>
                    <th>Per km</th>
                    <th>Minimum</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.data.history.map((v) => (
                    <tr key={v.id}>
                      <td>{dateTime(v.created_at)}</td>
                      <td>{humanize(v.category)}</td>
                      <td className="tabular-nums">{etb(v.base_fare)}</td>
                      <td className="tabular-nums">{etb(v.per_km)}</td>
                      <td className="tabular-nums">{etb(v.minimum_fare)}</td>
                      <td>{v.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      <div className="mt-6">
        <Panel title="Service area">
          <div className="p-4">
            <LiveMap zones={zoneList} height={420} />
          </div>
          <ul className="border-t border-line px-5 py-3 text-small">
            {zoneList.map((z) => (
              <li key={z.id}>
                <span className="font-semibold">{z.name}</span>
                {z.active ? '' : ' (inactive)'}, last changed {dateTime(z.updated_at)}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3 text-small text-muted">
            Pickups and destinations outside the green area are refused. Changing the boundary needs
            surveyed coordinates and is done by the technical team.
          </p>
        </Panel>
      </div>
    </>
  );
}
