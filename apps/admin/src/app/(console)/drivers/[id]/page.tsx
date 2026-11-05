'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import {
  Button,
  ConfirmAction,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, dateTime, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Detail {
  driver: {
    id: string;
    phone: string;
    status: string;
    suspended_reason: string | null;
    full_name: string | null;
    approval_status: string;
    approved_at: string | null;
    rating_avg: string;
    rating_count: number;
    created_at: string;
  };
  vehicles: {
    id: string;
    category: string;
    make: string;
    model: string;
    colour: string;
    year: number | null;
    plate_number: string;
    approval_status: string;
    rejection_reason: string | null;
    is_active: boolean;
  }[];
  documents: {
    id: string;
    type: string;
    vehicle_id: string | null;
    mime_type: string;
    size_bytes: number;
    status: string;
    rejection_reason: string | null;
    reviewed_at: string | null;
    expires_on: string | null;
    created_at: string;
  }[];
  eligibility: {
    eligible: boolean;
    reasons: string[];
    subscriptionEndsAt: string | null;
    missingDocuments: string[];
  };
  requiredDocuments: string[];
}

const REASON_TEXT: Record<string, string> = {
  ACCOUNT_SUSPENDED: 'Account is suspended',
  ACCOUNT_DELETED: 'Account is deleted',
  DRIVER_NOT_APPROVED: 'Driver is not approved yet',
  NO_APPROVED_VEHICLE: 'No approved vehicle',
  SUBSCRIPTION_INACTIVE: 'No active subscription',
};

export default function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<Detail>(`/drivers/${id}`);
  const [actionError, setActionError] = useState<Error | null>(null);

  const act = async (path: string, body: object = {}) => {
    setActionError(null);
    try {
      await api(path, { method: 'POST', body });
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e : new Error('Action failed.'));
      throw e;
    }
  };
  /** For one-click actions where the error is shown on the page instead of in a dialog. */
  const quick = (path: string) => () => act(path).catch(() => undefined);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  const { driver, vehicles, documents, eligibility } = data;
  const verify = can('drivers.verify');

  return (
    <>
      <p className="mb-2">
        <Link href="/drivers" className="text-muted hover:underline">
          Drivers
        </Link>
      </p>
      <PageHeader
        title={driver.full_name ?? 'Name not entered yet'}
        description={`${driver.phone}, joined ${date(driver.created_at)}`}
        actions={
          <>
            {verify &&
              driver.approval_status !== 'approved' &&
              (eligibility.missingDocuments.length > 0 ||
                !vehicles.some((v) => v.approval_status === 'approved')) && (
                <Button disabled title="Approve the required documents and the vehicle first">
                  Approve driver
                </Button>
              )}
            {verify &&
              driver.approval_status !== 'approved' &&
              eligibility.missingDocuments.length === 0 &&
              vehicles.some((v) => v.approval_status === 'approved') && (
                <ConfirmAction
                  label="Approve driver"
                  title="Approve this driver?"
                  body="Only approve when the name matches the ID and licence, and the vehicle documents are valid. The driver still needs an active subscription before receiving rides."
                  confirmLabel="Approve driver"
                  onConfirm={() => act(`/drivers/${id}/approve`)}
                />
              )}
            {verify && driver.approval_status === 'pending' && (
              <ConfirmAction
                label="Reject"
                title="Reject this driver?"
                confirmLabel="Reject driver"
                reasonLabel="Reason the driver will be told"
                variant="danger"
                onConfirm={(reason) => act(`/drivers/${id}/reject`, { reason })}
              />
            )}
            {can('drivers.suspend') && driver.status === 'active' && (
              <ConfirmAction
                label="Suspend"
                title="Suspend this driver?"
                body="They go offline immediately and stop receiving rides. A ride already in progress is not interrupted."
                confirmLabel="Suspend driver"
                reasonLabel="Reason (recorded in the audit log)"
                variant="danger"
                onConfirm={(reason) => act(`/drivers/${id}/suspend`, { reason })}
              />
            )}
            {can('drivers.suspend') && driver.status === 'suspended' && (
              <ConfirmAction
                label="Reinstate"
                title="Reinstate this driver?"
                confirmLabel="Reinstate driver"
                onConfirm={() => act(`/drivers/${id}/reinstate`)}
              />
            )}
          </>
        }
      />
      <ErrorNotice error={actionError} />

      <div
        className={`mb-6 rounded-lg px-5 py-4 ring-1 ${eligibility.eligible ? 'bg-sign-soft text-sign-deep ring-sign/30' : 'bg-amber-soft text-amber ring-amber/30'}`}
      >
        {eligibility.eligible ? (
          <p className="font-semibold">
            Can receive rides. Subscription active until {dateTime(eligibility.subscriptionEndsAt)}.
          </p>
        ) : (
          <>
            <p className="font-semibold">Cannot receive rides yet:</p>
            <ul className="mt-1 list-disc pl-5">
              {eligibility.reasons.map((r) => (
                <li key={r}>{REASON_TEXT[r] ?? humanize(r)}</li>
              ))}
              {eligibility.missingDocuments.length > 0 && (
                <li>
                  Documents still needed: {eligibility.missingDocuments.map(humanize).join(', ')}
                </li>
              )}
            </ul>
          </>
        )}
        {driver.suspended_reason && (
          <p className="mt-2">Suspension reason: {driver.suspended_reason}</p>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Vehicle">
          {!vehicles.length ? (
            <Empty>The driver has not added a vehicle yet.</Empty>
          ) : (
            <ul>
              {vehicles.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 last:border-b-0"
                >
                  <div>
                    <p className="text-lg font-bold">{v.plate_number}</p>
                    <p className="text-muted">
                      {humanize(v.category)}: {v.colour} {v.make} {v.model}
                      {v.year ? `, ${v.year}` : ''}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={v.approval_status} />
                    </div>
                    {v.rejection_reason && (
                      <p className="mt-1 text-sm text-signal">Rejected: {v.rejection_reason}</p>
                    )}
                  </div>
                  {verify && v.approval_status === 'pending' && (
                    <div className="flex gap-2">
                      <Button onClick={quick(`/vehicles/${v.id}/approve`)}>Approve vehicle</Button>
                      <ConfirmAction
                        label="Reject"
                        title="Reject this vehicle?"
                        confirmLabel="Reject vehicle"
                        reasonLabel="Reason the driver will be told"
                        variant="danger"
                        onConfirm={(reason) => act(`/vehicles/${v.id}/reject`, { reason })}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Documents">
          {!documents.length ? (
            <Empty>No documents uploaded yet.</Empty>
          ) : (
            <ul>
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 last:border-b-0"
                >
                  <div>
                    <p className="font-bold">{humanize(d.type)}</p>
                    <p className="text-sm text-muted">
                      Uploaded {dateTime(d.created_at)}, {Math.round(d.size_bytes / 1024)} KB
                      {d.expires_on ? `, expires ${date(d.expires_on)}` : ''}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={d.status} />
                    </div>
                    {d.rejection_reason && (
                      <p className="mt-1 text-sm text-signal">Rejected: {d.rejection_reason}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {can('documents.read') && (
                      <a
                        className="rounded-md bg-white px-4 py-2 font-semibold ring-1 ring-line hover:bg-ground"
                        href={`/admin/documents/${d.id}/file`}
                      >
                        Download
                      </a>
                    )}
                    {verify && d.status === 'pending' && (
                      <>
                        <Button onClick={quick(`/documents/${d.id}/approve`)}>Approve</Button>
                        <ConfirmAction
                          label="Reject"
                          title={`Reject ${humanize(d.type).toLowerCase()}?`}
                          confirmLabel="Reject document"
                          reasonLabel="Reason the driver will be told"
                          variant="danger"
                          onConfirm={(reason) => act(`/documents/${d.id}/reject`, { reason })}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {can('documents.read') && (
            <p className="border-t border-line px-5 py-3 text-sm text-muted">
              Every download is recorded in the audit log with your name.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-6 flex flex-wrap gap-4">
        {can('trips.read') && (
          <Link className="font-semibold hover:underline" href={`/trips?driverId=${id}`}>
            Trips by this driver
          </Link>
        )}
        {can('subscriptions.read') && (
          <Link className="font-semibold hover:underline" href={`/subscriptions?driverId=${id}`}>
            Subscription and payments
          </Link>
        )}
      </div>
    </>
  );
}
