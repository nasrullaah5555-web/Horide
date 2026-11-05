'use client';

import Link from 'next/link';
import { ErrorNotice, Loading, PageHeader, Panel } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  generatedAt: string;
  counts: Record<string, number>;
}
interface Report {
  days: { day: string; requested: number; completed: number; cancelled: number; expired: number }[];
}

/** A road-sign panel: the one loud element of the console. */
function Sign({
  value,
  label,
  tone,
  href,
}: {
  value: number;
  label: string;
  tone: 'go' | 'alert' | 'calm';
  href?: string;
}) {
  const colours = {
    go: 'bg-sign',
    alert: 'bg-signal',
    calm: 'bg-navy-soft',
  }[tone];
  const body = (
    <div
      className={`${colours} rounded-card border-3 border-white px-5 py-4 text-white shadow-sign`}
    >
      <p className="text-hero font-extrabold leading-none tabular-nums">{value}</p>
      <p className="mt-2 font-semibold text-white/90">{label}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-card">
      {body}
    </Link>
  ) : (
    body
  );
}

function AttentionRow({
  count,
  label,
  href,
  show,
}: {
  count: number;
  label: string;
  href: string;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <li className="flex items-center justify-between border-b border-line px-5 py-3 last:border-b-0">
      <Link href={href} className="font-semibold hover:underline">
        {label}
      </Link>
      <span
        className={`min-w-10 rounded-control px-2 py-0.5 text-center font-bold ${count > 0 ? 'bg-amber-soft text-amber' : 'text-muted'}`}
      >
        {count}
      </span>
    </li>
  );
}

export default function OverviewPage() {
  const { admin, can } = useSession();
  const allowed = can('reports.read');
  const dash = useApi<Dashboard>(allowed ? '/dashboard' : null, 15_000);
  const report = useApi<Report>(allowed ? '/reports/trips?days=14' : null);

  if (!allowed) {
    return (
      <>
        <PageHeader
          title={`Welcome, ${admin.fullName}`}
          description="Choose a section from the menu. The overview is available to operations, finance and super admins."
        />
      </>
    );
  }

  const c = dash.data?.counts;
  const maxDay = Math.max(1, ...(report.data?.days.map((d) => d.requested) ?? [1]));

  return (
    <>
      <PageHeader
        title="Right now in Jijiga"
        description={
          dash.data
            ? `Updated ${dateTime(dash.data.generatedAt)}. Refreshes every 15 seconds.`
            : undefined
        }
      />
      <ErrorNotice error={dash.error} />
      {!c ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Sign
              value={c.drivers_online ?? 0}
              label="Drivers online"
              tone="go"
              href={can('drivers.read') ? '/map' : undefined}
            />
            <Sign
              value={c.active_trips ?? 0}
              label="Rides in progress"
              tone="go"
              href={can('trips.read') ? '/trips?status=in_progress' : undefined}
            />
            <Sign
              value={c.searching_trips ?? 0}
              label="Passengers waiting for a driver"
              tone="calm"
            />
            <Sign
              value={c.open_emergencies ?? 0}
              label={c.open_emergencies === 1 ? 'Emergency alert open' : 'Emergency alerts open'}
              tone={(c.open_emergencies ?? 0) > 0 ? 'alert' : 'calm'}
              href={can('emergencies.read') ? '/emergencies' : undefined}
            />
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Panel title="Needs attention">
              <ul>
                <AttentionRow
                  count={c.documents_to_review ?? 0}
                  label="Driver documents to review"
                  href="/drivers?approval=pending"
                  show={can('drivers.verify')}
                />
                <AttentionRow
                  count={c.drivers_pending ?? 0}
                  label="Drivers waiting for approval"
                  href="/drivers?approval=pending"
                  show={can('drivers.read')}
                />
                <AttentionRow
                  count={c.open_payment_disputes ?? 0}
                  label="Ride payment disputes"
                  href="/payments?status=disputed"
                  show={can('payments.read')}
                />
                <AttentionRow
                  count={c.open_complaints ?? 0}
                  label="Open complaints"
                  href="/complaints"
                  show={can('complaints.read')}
                />
                <AttentionRow
                  count={c.subscriptions_expiring_7d ?? 0}
                  label="Subscriptions ending within 7 days"
                  href="/subscriptions?status=expiring"
                  show={can('subscriptions.read')}
                />
              </ul>
            </Panel>

            <Panel title="Last 14 days">
              <div className="grid grid-cols-3 gap-4 border-b border-line px-5 py-4">
                <div>
                  <p className="text-headline font-extrabold">{c.trips_7d ?? 0}</p>
                  <p className="text-small text-muted">Requests, 7 days</p>
                </div>
                <div>
                  <p className="text-headline font-extrabold">{c.completed_7d ?? 0}</p>
                  <p className="text-small text-muted">Completed, 7 days</p>
                </div>
                <div>
                  <p className="text-headline font-extrabold">{c.unfulfilled_7d ?? 0}</p>
                  <p className="text-small text-muted">No driver found, 7 days</p>
                </div>
              </div>
              {report.data && (
                <figure className="px-5 py-4">
                  <figcaption className="mb-3 flex gap-5 text-small text-muted">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-sign" /> Completed
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-line" /> Cancelled or no
                      driver
                    </span>
                  </figcaption>
                  <ol className="space-y-1.5">
                    {report.data.days.map((d) => (
                      <li
                        key={d.day}
                        className="grid grid-cols-[64px_1fr_40px] items-center gap-3 text-small"
                      >
                        <span className="text-muted">{d.day.slice(5)}</span>
                        <span
                          className="flex h-3 overflow-hidden rounded-sm bg-ground"
                          title={`${d.requested} requests, ${d.completed} completed`}
                        >
                          <span
                            className="bg-sign"
                            style={{ width: `${(d.completed / maxDay) * 100}%` }}
                          />
                          <span
                            className="bg-line"
                            style={{ width: `${((d.cancelled + d.expired) / maxDay) * 100}%` }}
                          />
                        </span>
                        <span className="text-right font-semibold">{d.requested}</span>
                      </li>
                    ))}
                  </ol>
                </figure>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
