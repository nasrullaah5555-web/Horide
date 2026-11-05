import type { Metadata } from 'next';
import { DraftNotice, NotYetPublished, Page } from '@/components/site';

export const metadata: Metadata = { title: 'Terms of use' };

export default function Terms() {
  return (
    <Page title="Terms of use">
      <div className="prose-legal">
        <DraftNotice />

        <h2>The service</h2>
        <p>
          Horide is an app that connects passengers with independent drivers in Jijiga. Drivers use
          their own vehicles. Horide is not a transport operator and does not carry passengers.
        </p>

        <h2>Fares and payment</h2>
        <ul>
          <li>
            The app shows the fare before you book. It is worked out by Horide from the road
            distance and the published prices for cars and Bajaj.
          </li>
          <li>
            The fare is fixed when a driver accepts. It changes only if you change the destination
            and approve the new price in the app.
          </li>
          <li>
            Passengers pay the driver directly in cash or by eBirr. Horide does not collect or hold
            ride payments.
          </li>
          <li>
            Both the passenger and the driver confirm the payment in the app. Disagreements are
            reviewed by Horide staff.
          </li>
          <li>
            Cancellation and waiting charges, if any, are shown in the app before they apply.{' '}
            <NotYetPublished what="The cancellation and waiting rules" />
          </li>
        </ul>

        <h2>Drivers</h2>
        <ul>
          <li>
            Drivers must hold a valid licence and the documents Horide asks for, and keep them up to
            date.
          </li>
          <li>
            Drivers pay a monthly subscription to receive ride requests. When it ends, new requests
            stop; a trip already under way is not interrupted.
          </li>
          <li>Drivers must charge only the fare shown in the app.</li>
        </ul>

        <h2>Everyone</h2>
        <ul>
          <li>
            Treat each other with respect. Harassment, violence and discrimination lead to
            suspension.
          </li>
          <li>
            Don’t misuse the app: no false bookings, false payment confirmations or false locations.
          </li>
          <li>
            Horide may suspend accounts that break these terms. Suspension never stops a trip
            already under way.
          </li>
        </ul>

        <h2>Liability</h2>
        <p>
          <NotYetPublished what="Liability, insurance and dispute-resolution terms reviewed under Ethiopian law" />
        </p>

        <h2>Contact</h2>
        <p>See the Contact page.</p>
      </div>
    </Page>
  );
}
