import type { Metadata } from 'next';
import { NotYetPublished, Page } from '@/components/site';

export const metadata: Metadata = { title: 'Contact' };

export default function Contact() {
  return (
    <Page title="Contact" lead="Questions, problems with a trip, or joining as a driver.">
      <dl className="space-y-5 rounded-card border border-line bg-white p-6">
        <div>
          <dt className="font-extrabold">Support phone</dt>
          <dd>
            <NotYetPublished what="The support number" />
          </dd>
        </div>
        <div>
          <dt className="font-extrabold">Email</dt>
          <dd>
            <NotYetPublished what="The support email address" />
          </dd>
        </div>
        <div>
          <dt className="font-extrabold">Office (driver subscriptions and documents)</dt>
          <dd>
            <NotYetPublished what="The office address and opening hours" />
          </dd>
        </div>
      </dl>
      <p className="mt-6 text-navy-soft">
        If you have the app, the fastest way to report a problem with a trip is “Report a problem”
        on the trip receipt.
      </p>
    </Page>
  );
}
