import type { Metadata } from 'next';
import './globals.css';
import { market } from '@/lib/market';

export const metadata: Metadata = {
  title: { default: `Musride — rides in ${market.city}`, template: '%s — Musride' },
  description: `Book a car or ${market.bajaj} in ${market.city}. See the price before you book and pay the driver directly in ${market.payBy}.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
