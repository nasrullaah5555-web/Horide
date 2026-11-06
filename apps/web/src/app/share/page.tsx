import type { Metadata } from 'next';
import { Footer, Header } from '@/components/site';
import { SharedTrip } from './shared-trip';

export const metadata: Metadata = {
  title: 'Follow a trip',
  // A shared trip is private to whoever has the link.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SharePage() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10">
        <SharedTrip />
      </main>
      <Footer />
    </>
  );
}
