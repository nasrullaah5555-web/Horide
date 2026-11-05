'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import {
  Button,
  ConfirmAction,
  ErrorNotice,
  inputClass,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, humanize } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { colors } from '@/lib/tokens.g';

const ROLES = {
  support: 'Complaints, emergencies, trips. No money, prices or staff accounts.',
  verification: 'Reviews driver documents and vehicles. Only role that can open ID documents.',
  finance: 'Subscription payments and ride payment disputes.',
  operations: 'Prices, service area, suspensions, announcements.',
  super: 'Staff accounts and the audit log.',
} as const;
type Role = keyof typeof ROLES;

interface StaffRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: string | null;
  roles: Role[];
}
interface Created {
  id: string;
  email: string;
  temporaryPassword: string;
  totpSecret: string;
  otpauthUrl: string;
}

function RolePicker({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 font-semibold">Roles</legend>
      {(Object.keys(ROLES) as Role[]).map((r) => (
        <label key={r} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-navy"
            checked={value.includes(r)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))
            }
          />
          <span>
            <span className="font-semibold">{humanize(r)}</span>
            <span className="block text-small text-muted">{ROLES[r]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Shown once after creating an account: the only time the password and authenticator secret are visible. */
function OneTimeCredentials({ created, onClose }: { created: Created; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(created.otpauthUrl, {
      margin: 1,
      width: 220,
      color: { dark: colors.navy, light: colors.white },
    }).then(setQr, () => setQr(null));
  }, [created.otpauthUrl]);
  return (
    <div className="space-y-4 rounded-control bg-white p-5 ring-2 ring-amber">
      <p className="font-bold">
        Give these details to {created.email} in person. They will not be shown again.
      </p>
      <div className="flex flex-wrap gap-6">
        {/* A generated data: URL, so Next's image optimiser does not apply. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt="Authenticator setup QR code" width={220} height={220} />}
        <dl className="space-y-3">
          <div>
            <dt className="text-small text-muted">Temporary password</dt>
            <dd className="text-title font-bold tracking-wide">{created.temporaryPassword}</dd>
          </div>
          <div>
            <dt className="text-small text-muted">
              Authenticator key (if the QR code can’t be scanned)
            </dt>
            <dd className="break-all font-semibold tracking-wide">
              {created.totpSecret.match(/.{1,4}/g)?.join(' ')}
            </dd>
          </div>
        </dl>
      </div>
      <p className="text-small text-muted">
        They scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator
        or Aegis), sign in, then change the password.
      </p>
      <Button onClick={onClose}>I have handed these over</Button>
    </div>
  );
}

export default function StaffPage() {
  const { admin, can } = useSession();
  const { data, error, loading, reload } = useApi<{ admins: StaffRow[] }>('/admins');
  const [form, setForm] = useState<{ email: string; fullName: string; roles: Role[] }>({
    email: '',
    fullName: '',
    roles: ['support'],
  });
  const [created, setCreated] = useState<Created | null>(null);
  const [formError, setFormError] = useState<Error | null>(null);
  const [editing, setEditing] = useState<{ id: string; roles: Role[] } | null>(null);

  const write = can('admins.write');

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Give each person only the roles their job needs. Every sign-in and change is recorded in the audit log."
      />
      <ErrorNotice error={error} />
      {created && (
        <div className="mb-6">
          <OneTimeCredentials created={created} onClose={() => setCreated(null)} />
        </div>
      )}
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : (
          <ul>
            {data?.admins.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0"
              >
                <div>
                  <p className="font-bold">
                    {a.full_name}{' '}
                    {a.id === admin.id && <span className="font-normal text-muted">(you)</span>}
                  </p>
                  <p className="text-small text-muted">
                    {a.email}, last sign-in {a.last_login_at ? dateTime(a.last_login_at) : 'never'}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.status} />
                    <span>{a.roles.map(humanize).join(', ') || 'No roles'}</span>
                  </p>
                  {editing?.id === a.id && (
                    <form
                      className="mt-4 space-y-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          await api(`/admins/${a.id}/roles`, {
                            method: 'PUT',
                            body: { roles: editing.roles },
                          });
                          setEditing(null);
                          await reload();
                        } catch (err) {
                          setFormError(err instanceof ApiError ? err : new Error('Failed.'));
                        }
                      }}
                    >
                      <RolePicker
                        value={editing.roles}
                        onChange={(roles) => setEditing({ id: a.id, roles })}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" disabled={!editing.roles.length}>
                          Save roles
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                      <p className="text-small text-muted">
                        The person is signed out and gets the new roles when they sign in again.
                      </p>
                    </form>
                  )}
                </div>
                {write && a.id !== admin.id && !editing && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setEditing({ id: a.id, roles: a.roles })}
                    >
                      Change roles
                    </Button>
                    {a.status === 'active' ? (
                      <ConfirmAction
                        label="Disable"
                        title={`Disable ${a.full_name}?`}
                        body="They are signed out immediately and can no longer sign in."
                        confirmLabel="Disable account"
                        variant="danger"
                        onConfirm={async () => {
                          await api(`/admins/${a.id}/disable`, { method: 'POST', body: {} });
                          await reload();
                        }}
                      />
                    ) : (
                      <ConfirmAction
                        label="Enable"
                        title={`Enable ${a.full_name}?`}
                        confirmLabel="Enable account"
                        onConfirm={async () => {
                          await api(`/admins/${a.id}/enable`, { method: 'POST', body: {} });
                          await reload();
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {write && (
        <div className="mt-6 max-w-2xl">
          <Panel title="Add a staff member">
            <form
              className="space-y-4 px-5 py-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setFormError(null);
                try {
                  const c = await api<Created>('/admins', { method: 'POST', body: form });
                  setCreated(c);
                  setForm({ email: '', fullName: '', roles: ['support'] });
                  await reload();
                } catch (err) {
                  setFormError(
                    err instanceof ApiError ? err : new Error('Could not create the account.'),
                  );
                }
              }}
            >
              <label className="block">
                <span className="mb-1 block font-semibold">Full name</span>
                <input
                  required
                  maxLength={120}
                  className={`${inputClass} w-full`}
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold">Work email</span>
                <input
                  required
                  type="email"
                  className={`${inputClass} w-full`}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
              <ErrorNotice error={formError} />
              <Button type="submit" disabled={!form.roles.length}>
                Create account
              </Button>
            </form>
          </Panel>
        </div>
      )}
    </>
  );
}
