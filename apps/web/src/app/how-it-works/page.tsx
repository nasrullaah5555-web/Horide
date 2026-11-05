import type { Metadata } from 'next';
import { Page } from '@/components/site';

export const metadata: Metadata = { title: 'How it works' };

const steps = [
  [
    'Set your pickup',
    'Move the map pin to where you are, and add a landmark so the driver finds you.',
  ],
  ['Choose where to go', 'Pick your destination on the map.'],
  [
    'See the prices',
    'Musride shows the fare for a car and for a Bajaj, worked out from the road distance.',
  ],
  [
    'Choose cash or eBirr',
    'This tells the driver how you will pay. You pay the driver, not Musride.',
  ],
  [
    'Book',
    'Nearby drivers get your request. The first to accept is your driver, and the price is fixed.',
  ],
  [
    'Meet your driver',
    'Check the plate number matches before you get in. You can call the driver from the app.',
  ],
  [
    'Arrive and pay',
    'Pay the driver, then confirm in the app. If something is wrong with the payment, report it there.',
  ],
  ['Rate the trip', 'Ratings help keep Musride safe and friendly for everyone.'],
] as const;

export default function HowItWorks() {
  return (
    <Page title="How it works" lead="Booking a ride takes a few taps.">
      <ol className="space-y-4">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-4 rounded-card border border-line bg-white p-5">
            <span className="sign flex h-11 w-11 shrink-0 items-center justify-center text-title font-extrabold">
              {i + 1}
            </span>
            <div>
              <h2 className="text-title font-extrabold">{title}</h2>
              <p className="text-navy-soft">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <h2 className="mt-10 text-headline font-extrabold">If your destination changes</h2>
      <p className="mt-2 text-navy-soft">
        Change it in the app during the trip. Musride works out the new price and you approve it
        before anything changes. If you don’t approve, the original price stays.
      </p>
      <h2 className="mt-8 text-headline font-extrabold">Prices</h2>
      <p className="mt-2 text-navy-soft">
        Each fare is a starting amount plus a price per kilometre of road, different for cars and
        Bajaj. The prices for Jijiga will be published here before launch.
      </p>
    </Page>
  );
}
