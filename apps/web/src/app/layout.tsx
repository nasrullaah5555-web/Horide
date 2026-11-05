import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Horide — rides in Jijiga', template: '%s — Horide' },
  description:
    'Book a car or Bajaj in Jijiga. See the price before you book and pay the driver directly in cash or eBirr.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
