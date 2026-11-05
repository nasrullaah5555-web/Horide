import type { Metadata } from 'next';
import { DraftNotice, NotYetPublished, Page } from '@/components/site';

export const metadata: Metadata = { title: 'Privacy policy' };

/*
 * Written to match what the software actually does (docs/SECURITY_PLAN.md §6, DATABASE_DESIGN
 * "Data retention"). If the software changes, this page must change with it.
 */
export default function Privacy() {
  return (
    <Page
      title="Privacy policy"
      lead="What Musride collects, why, how long it is kept, and your choices."
    >
      <div className="prose-legal">
        <DraftNotice />

        <h2>Who we are</h2>
        <p>
          Musride operates a ride-hailing service in Jijiga, Ethiopia.{' '}
          <NotYetPublished what="The registered company name and address" />
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Everyone:</strong> your phone number (to sign in with a one-time code), and the
            name you choose to give.
          </li>
          <li>
            <strong>Passengers:</strong> pickup and destination points, saved places you add, and an
            optional emergency contact number.
          </li>
          <li>
            <strong>Drivers:</strong> your National ID, driving licence, vehicle registration, photo
            and any permits or insurance you upload; vehicle details; and your location while you
            are online or on a trip.
          </li>
          <li>
            <strong>Trips:</strong> times, route distance, price, payment method (cash or eBirr),
            the eBirr transaction reference a driver types in, ratings, comments and complaints.
          </li>
          <li>
            <strong>Emergencies:</strong> if you press the emergency button, your trip and your
            location at that moment.
          </li>
          <li>
            <strong>Technical:</strong> your IP address when you request a sign-in code or when
            staff take actions, a short description of your device for your sign-in sessions, and a
            notification token if you allow notifications.
          </li>
        </ul>
        <p>
          We do not collect passengers’ email addresses, and we do not take or store any payment
          card or eBirr account details.
        </p>

        <h2>Why we use it</h2>
        <ul>
          <li>To sign you in and keep your account secure.</li>
          <li>
            To match passengers with nearby drivers, show the driver’s position, and work out fares.
          </li>
          <li>To check that drivers and vehicles are allowed to carry passengers.</li>
          <li>To keep records of trips and payments, and to handle disputes and complaints.</li>
          <li>To respond to emergencies and safety reports.</li>
        </ul>

        <h2>Who can see it</h2>
        <ul>
          <li>
            Your driver or passenger sees your name and, only while the trip is open, your phone
            number. Drivers’ vehicle and plate are shown to their passengers.
          </li>
          <li>
            Musride staff see only what their role needs. Driver documents can be opened only by
            verification staff, and every opening is recorded.
          </li>
          <li>
            Service providers that run parts of Musride for us: hosting, sign-in text messages, maps
            and directions.{' '}
            <NotYetPublished what="The list of providers and the countries where data is stored" />
          </li>
          <li>Authorities, when Ethiopian law requires it.</li>
        </ul>
        <p>We do not sell personal data.</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Trip GPS history: 180 days.</li>
          <li>Sign-in codes: 30 days. Ended sign-in sessions: 30 days after they end.</li>
          <li>
            Your phone number, name, emergency contact, saved places, notifications and a driver’s
            documents: until you delete your account.
          </li>
          <li>
            Trip, payment and subscription records: kept after deletion without your name or phone
            number, as business records. <NotYetPublished what="The exact retention period" />
          </li>
        </ul>

        <h2>Your choices</h2>
        <ul>
          <li>Change your name and emergency contact in the app.</li>
          <li>
            Location: the passenger app uses your location only to set the pickup pin and for the
            emergency alert. The driver app shares your location only while you are online or on a
            trip, and shows a notification while it does.
          </li>
          <li>
            Delete your account at any time from the app. See{' '}
            <a href="/delete-account/" className="underline">
              Delete your account
            </a>
            .
          </li>
          <li>
            Ask for a copy of your data or a correction by contacting us (see the Contact page).
          </li>
        </ul>

        <h2>Security</h2>
        <p>
          Connections are encrypted. Sign-in codes and session keys are stored only in scrambled
          (hashed) form. Driver documents are kept in private storage that is never publicly
          accessible. Staff accounts require a password and an authenticator code.
        </p>

        <h2>Changes</h2>
        <p>
          We will update this page and tell you in the app before important changes take effect.
        </p>
      </div>
    </Page>
  );
}
