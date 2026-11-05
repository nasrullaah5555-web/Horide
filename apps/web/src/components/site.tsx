import Link from 'next/link';

const nav = [
  { href: '/how-it-works/', label: 'How it works' },
  { href: '/drive/', label: 'Drive with Musride' },
  { href: '/safety/', label: 'Safety' },
  { href: '/contact/', label: 'Contact' },
];

export function Header() {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="sign rounded-control px-3 py-1 text-title-large font-extrabold tracking-tight"
        >
          Musride
        </Link>
        <nav aria-label="Main">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body font-semibold">
            {nav.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="hover:text-sign-deep">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 bg-navy text-white">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="text-title font-extrabold">Musride</p>
          <p className="text-white/75">Rides by car and Bajaj in Jijiga.</p>
        </div>
        <ul className="space-y-1 text-white/85">
          <li>
            <Link href="/privacy/">Privacy policy</Link>
          </li>
          <li>
            <Link href="/terms/">Terms of use</Link>
          </li>
          <li>
            <Link href="/delete-account/">Delete your account</Link>
          </li>
        </ul>
        <p className="text-white/75">
          In an emergency call Police <strong className="text-white">991</strong> or Ambulance{' '}
          <strong className="text-white">907</strong>.
        </p>
      </div>
    </footer>
  );
}

export function Page({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 pt-10">
        <h1 className="text-display font-extrabold leading-tight tracking-tight">{title}</h1>
        {lead && <p className="mt-3 text-title text-muted">{lead}</p>}
        <div className="mt-8">{children}</div>
      </main>
      <Footer />
    </>
  );
}

/** Shown on documents that are not final. Removed only after legal review (OWNER_ACTION_REGISTER OA-07). */
export function DraftNotice() {
  return (
    <p
      role="note"
      className="mb-6 rounded-control border border-amber bg-amber-soft px-4 py-3 font-semibold text-navy"
    >
      Draft. This document has not yet been reviewed by a lawyer and will be finalised before
      Musride launches.
    </p>
  );
}

/** For details the business has not published yet (OWNER_ACTION_REGISTER OA-22). */
export function NotYetPublished({ what }: { what: string }) {
  return <span className="text-muted">{what} will be published before launch.</span>;
}
