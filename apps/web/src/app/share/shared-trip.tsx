'use client';

import { useEffect, useState } from 'react';

/** Where the API is; set when the site is built (render.staging.yaml / render.yaml). */
const API = process.env.NEXT_PUBLIC_MUSRIDE_API_URL ?? '';
const REFRESH_MS = 10_000;

interface Shared {
  status: string;
  category?: 'car' | 'bajaj';
  pickup?: string | null;
  destination?: string | null;
  driver?: {
    firstName: string | null;
    vehicle: string;
    plate: string;
    location: { lat: number; lng: number; ageSeconds: number; isLive: boolean } | null;
  } | null;
}

const STATUS: Record<string, { title: string; text: string }> = {
  requested: { title: 'Finding a driver', text: 'The ride has been booked.' },
  searching: { title: 'Finding a driver', text: 'Musride is asking nearby drivers.' },
  accepted: { title: 'Driver on the way', text: 'A driver accepted the ride.' },
  driver_arriving: { title: 'Driver on the way', text: 'The driver is heading to the pickup.' },
  arrived: { title: 'Driver has arrived', text: 'The driver is waiting at the pickup.' },
  in_progress: { title: 'On the way', text: 'The trip has started.' },
};

/**
 * Reads the link's secret from the address after "#" (never sent to any web server), asks the
 * Musride API for the trip's progress every 10 seconds, and shows it. No account needed.
 */
export function SharedTrip() {
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
      setError('This link is not complete. Ask for it to be sent again.');
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch(`${API}/share/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Shared;
        if (stop) return;
        setData(body);
        setError(null);
        if (body.status !== 'ended') timer = setTimeout(load, REFRESH_MS);
      } catch {
        if (stop) return;
        setError('Could not reach Musride. Trying again…');
        timer = setTimeout(load, REFRESH_MS);
      }
    };
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!data) {
    return (
      <div aria-live="polite">
        <h1 className="text-display font-extrabold leading-tight tracking-tight">Follow a trip</h1>
        <p className="mt-3 text-title text-muted">{error ?? 'Loading…'}</p>
      </div>
    );
  }

  if (data.status === 'ended') {
    return (
      <div>
        <h1 className="text-display font-extrabold leading-tight tracking-tight">Trip ended</h1>
        <p className="mt-3 text-title text-muted">
          This trip has finished or was cancelled, so it can no longer be followed.
        </p>
      </div>
    );
  }

  const s = STATUS[data.status] ?? { title: 'Trip in progress', text: '' };
  const d = data.driver;
  const loc = d?.location ?? null;
  const pad = 0.006;
  const map =
    loc &&
    `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - pad},${loc.lat - pad},${
      loc.lng + pad
    },${loc.lat + pad}&layer=mapnik&marker=${loc.lat},${loc.lng}`;

  return (
    <div className="space-y-6" aria-live="polite">
      <div className="sign px-6 py-5 text-white">
        <p className="text-small font-semibold uppercase tracking-wide text-white/80">
          {data.category === 'bajaj' ? 'Musride Bajaj' : 'Musride car'}
        </p>
        <p className="text-display font-extrabold leading-tight">{s.title}</p>
        <p className="mt-1 text-title">{s.text}</p>
      </div>

      {error && <p className="text-muted">{error}</p>}

      <dl className="space-y-4 rounded-card border border-line bg-white p-6">
        {d && (
          <div>
            <dt className="text-small text-muted">Driver and car</dt>
            <dd className="text-title font-bold">{`${d.firstName ?? 'Driver'} · ${d.vehicle}`}</dd>
            <dd className="mt-1 inline-block rounded-control border-2 border-navy px-3 py-1 font-extrabold tracking-wide">
              {d.plate}
            </dd>
          </div>
        )}
        {data.pickup && (
          <div>
            <dt className="text-small text-muted">From</dt>
            <dd>{data.pickup}</dd>
          </div>
        )}
        {data.destination && (
          <div>
            <dt className="text-small text-muted">To</dt>
            <dd>{data.destination}</dd>
          </div>
        )}
      </dl>

      {loc && map && (
        <div className="space-y-2">
          <iframe
            title="Where the car is"
            src={map}
            className="h-80 w-full rounded-card border border-line"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <p className={loc.isLive ? 'font-semibold text-sign-deep' : 'font-semibold text-signal'}>
            {loc.isLive
              ? 'Live position'
              : `Position not updated for ${Math.round(loc.ageSeconds / 60)} min (weak signal?)`}
          </p>
        </div>
      )}

      <p className="text-small text-muted">
        Shared by the passenger. This page updates every 10 seconds and stops working when the trip
        ends. In an emergency call Police 991 or Ambulance 907.
      </p>
    </div>
  );
}
