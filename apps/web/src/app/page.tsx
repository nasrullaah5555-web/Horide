import Link from 'next/link';
import { Footer, Header } from '@/components/site';

const points = [
  {
    title: 'Price before you book',
    text: 'The app shows the fare for a car and for a Bajaj before you request. The driver cannot change it, and there is no bargaining.',
  },
  {
    title: 'Pay the driver directly',
    text: 'Pay in cash or by eBirr, straight to the driver. Musride does not hold your money and there is no wallet to top up.',
  },
  {
    title: 'Know who is coming',
    text: 'See the driver’s name, rating, vehicle and plate number, and follow the car on the map as it arrives.',
  },
  {
    title: 'Help when you need it',
    text: 'An emergency button on every trip shows the police and ambulance numbers and alerts the Musride team with your location.',
  },
];

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto grid max-w-5xl gap-10 px-4 py-16 md:grid-cols-[1.3fr_1fr] md:items-center">
            <div>
              <p className="font-bold uppercase tracking-widest text-sign">Jijiga</p>
              <h1 className="mt-2 text-hero font-extrabold leading-tight tracking-tight">
                A car or Bajaj,
                <br />
                at a fixed price.
              </h1>
              <p className="mt-4 max-w-md text-title text-white/80">
                Musride connects passengers with local drivers. You see the price first and pay the
                driver directly.
              </p>
              <p className="mt-6 inline-block rounded-control border border-white/30 px-4 py-2 font-semibold text-white/90">
                The Musride apps are being tested and are not in the app stores yet.
              </p>
            </div>
            {/* A sign, not a screenshot: the apps haven't launched, so no store badges or fake screens. */}
            <div aria-hidden className="sign p-6">
              <p className="text-small font-bold uppercase tracking-widest text-white/80">
                Example trip
              </p>
              <p className="mt-2 text-display font-extrabold">Home → Market</p>
              <p className="mt-3 text-title font-semibold text-white/90">
                Price shown before booking. Paid to the driver.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14">
          <div className="grid gap-6 sm:grid-cols-2">
            {points.map((p) => (
              <div key={p.title} className="rounded-card border border-line bg-white p-6">
                <h2 className="text-title-large font-extrabold">{p.title}</h2>
                <p className="mt-2 text-navy-soft">{p.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/how-it-works/"
              className="rounded-control bg-sign px-5 py-3 font-bold text-white hover:bg-sign-deep"
            >
              How it works
            </Link>
            <Link
              href="/drive/"
              className="rounded-control border-2 border-navy px-5 py-3 font-bold hover:bg-white"
            >
              Drive with Musride
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
