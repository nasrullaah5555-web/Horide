import type { Metadata } from 'next';
import { NotYetPublished, Page } from '@/components/site';

export const metadata: Metadata = { title: 'Drive with Horide' };

export default function Drive() {
  return (
    <Page
      title="Drive with Horide"
      lead="Use your own car or Bajaj. Keep every fare: passengers pay you directly."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-5">
          <h2 className="text-title font-extrabold">No commission on fares</h2>
          <p className="text-navy-soft">
            Horide charges drivers a monthly subscription instead of taking a share of each trip.
            Passengers pay you in cash or eBirr.
          </p>
        </div>
        <div className="rounded-card border border-line bg-white p-5">
          <h2 className="text-title font-extrabold">Fixed prices, no bargaining</h2>
          <p className="text-navy-soft">
            Every request shows the fare, the pickup distance and the payment method before you
            accept.
          </p>
        </div>
      </div>

      <h2 className="mt-10 text-headline font-extrabold">What you need</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-soft">
        <li>A smartphone with mobile data and GPS</li>
        <li>Your National ID</li>
        <li>A valid driving licence</li>
        <li>Your vehicle’s registration document</li>
        <li>A clear photo of yourself</li>
        <li>Any insurance or permit that applies to your vehicle</li>
      </ul>
      <p className="mt-3 text-navy-soft">
        Horide staff check every document before you can take rides. The full list of legal
        requirements for Jijiga is being confirmed and will be shown here.
      </p>

      <h2 className="mt-10 text-headline font-extrabold">Subscription</h2>
      <p className="mt-2 text-navy-soft">
        You pay the monthly subscription at the Horide office. When it ends, you stop receiving new
        requests, but a trip you are already on is never interrupted.{' '}
        <NotYetPublished what="The subscription price" />
      </p>

      <h2 className="mt-10 text-headline font-extrabold">How to join</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-6 text-navy-soft">
        <li>Install the Horide Driver app (available when Horide launches).</li>
        <li>Sign in with your phone number.</li>
        <li>Add your vehicle and photograph your documents.</li>
        <li>Wait for approval, pay your subscription, and go online.</li>
      </ol>
    </Page>
  );
}
