import type { Metadata } from 'next';
import { Page } from '@/components/site';

export const metadata: Metadata = { title: 'Delete your account' };

export default function DeleteAccount() {
  return (
    <Page
      title="Delete your account"
      lead="You can delete your Horide account at any time, from the app."
    >
      <div className="prose-legal">
        <h2>In the passenger app</h2>
        <p>Menu → Your profile → Delete my account. Type DELETE to confirm.</p>
        <h2>In the driver app</h2>
        <p>Account and documents (badge icon) → Delete my account. Type DELETE to confirm.</p>
        <p>Finish or cancel any open trip first.</p>

        <h2>What is deleted</h2>
        <ul>
          <li>Your phone number and name</li>
          <li>Passengers: emergency contact and saved places</li>
          <li>
            Drivers: identity and vehicle documents (the files themselves) and your live location;
            your vehicle can no longer be used
          </li>
          <li>Your sign-in sessions, notifications and notification tokens</li>
        </ul>

        <h2>What is kept</h2>
        <p>
          Trip, payment, subscription, rating and complaint records are kept as business records, no
          longer linked to your name or phone number. Trip GPS history is deleted after 180 days.
        </p>

        <h2>No longer have the app?</h2>
        <p>Contact Horide support (see the Contact page) from the phone number of the account.</p>
      </div>
    </Page>
  );
}
