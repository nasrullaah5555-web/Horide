import type { Metadata } from 'next';
import { Page } from '@/components/site';

export const metadata: Metadata = { title: 'Safety' };

const numbers = [
  ['Police', '991'],
  ['Ambulance', '907'],
  ['Fire', '939'],
  ['Traffic police', '945'],
] as const;

export default function Safety() {
  return (
    <Page title="Safety" lead="What Horide does before, during and after every trip.">
      <section aria-labelledby="emergency" className="sign sign-navy p-6">
        <h2 id="emergency" className="text-2xl font-extrabold">
          In an emergency, call first
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {numbers.map(([service, n]) => (
            <li key={n} className="text-lg">
              {service}{' '}
              <a href={`tel:${n}`} className="font-extrabold underline">
                {n}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-white/85">
          Horide staff are not an emergency service. The emergency button in the app shows these
          numbers and also alerts the Horide team with your trip and location.
        </p>
      </section>

      <h2 className="mt-10 text-2xl font-extrabold">Before the trip</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-soft">
        <li>Every driver’s identity, licence and vehicle documents are checked by Horide staff.</li>
        <li>
          You see the driver’s name, rating, vehicle and plate. Check the plate before you get in.
        </li>
        <li>The price is shown before you book and fixed when the driver accepts.</li>
      </ul>
      <h2 className="mt-8 text-2xl font-extrabold">During the trip</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-soft">
        <li>The driver’s position is shown on your map. If it stops updating, the app says so.</li>
        <li>The emergency button is on the trip screen for both passengers and drivers.</li>
        <li>Your phone number is shared with your driver only while the trip is open.</li>
      </ul>
      <h2 className="mt-8 text-2xl font-extrabold">After the trip</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-soft">
        <li>Rate the driver and report problems from the app. Horide staff review every report.</li>
        <li>Drivers who break the rules can be suspended.</li>
      </ul>
    </Page>
  );
}
