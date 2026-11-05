'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
  permission: string;
}

/** Grouped by the job staff are doing, not by database table. */
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Live',
    items: [
      { href: '/', label: 'Overview', permission: 'reports.read' },
      { href: '/map', label: 'Live map', permission: 'drivers.read' },
      { href: '/emergencies', label: 'Emergencies', permission: 'emergencies.read' },
      { href: '/trips', label: 'Trips', permission: 'trips.read' },
    ],
  },
  {
    group: 'People',
    items: [
      { href: '/drivers', label: 'Drivers', permission: 'drivers.read' },
      { href: '/passengers', label: 'Passengers', permission: 'users.read' },
      { href: '/complaints', label: 'Complaints', permission: 'complaints.read' },
    ],
  },
  {
    group: 'Money',
    items: [
      { href: '/payments', label: 'Ride payments', permission: 'payments.read' },
      { href: '/subscriptions', label: 'Subscriptions', permission: 'subscriptions.read' },
      { href: '/pricing', label: 'Prices and zones', permission: 'pricing.read' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { href: '/notifications', label: 'Announcements', permission: 'notifications.send' },
      { href: '/admins', label: 'Staff accounts', permission: 'admins.read' },
      { href: '/audit', label: 'Audit log', permission: 'audit.read' },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const { admin, can, signOut } = useSession();
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="flex flex-col bg-navy text-white md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/" className="text-title-large font-extrabold tracking-tight">
            Horide
            <span className="ml-2 align-middle text-caption font-semibold text-white/60">
              Jijiga console
            </span>
          </Link>
        </div>
        <nav
          aria-label="Main"
          className="flex gap-6 overflow-x-auto px-3 pb-4 md:block md:flex-1 md:space-y-5 md:overflow-visible"
        >
          {NAV.map(({ group, items }) => {
            const visible = items.filter((i) => can(i.permission));
            if (!visible.length) return null;
            return (
              <div key={group} className="min-w-max">
                <p className="px-3 pb-1 text-caption font-semibold text-white/50">{group}</p>
                <ul>
                  {visible.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive(item.href) ? 'page' : undefined}
                        className={`relative block rounded-control px-3 py-2 text-body ${
                          isActive(item.href)
                            ? 'bg-white/10 font-semibold'
                            : 'text-white/80 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {isActive(item.href) && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1.5 left-0 w-1 rounded-pill bg-sign"
                          />
                        )}
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-small">
          <p className="font-semibold">{admin.fullName}</p>
          <p className="text-white/60">{admin.roles.join(', ')}</p>
          <div className="mt-2 flex gap-4">
            <Link href="/account" className="text-white/80 underline-offset-2 hover:underline">
              Password
            </Link>
            <button
              onClick={() => void signOut()}
              className="text-white/80 underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
