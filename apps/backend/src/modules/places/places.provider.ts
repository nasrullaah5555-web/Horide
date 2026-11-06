import type { LatLng } from '../../common/geo';

/** One search suggestion. `point` is filled when the provider already knows it (Photon, dev). */
export interface PlaceSuggestion {
  id: string;
  name: string;
  detail: string | null;
  point: LatLng | null;
}

export interface PlaceDetails {
  point: LatLng;
  name: string;
  detail: string | null;
}

/**
 * Place search for the apps: suggestions while typing, the exact position of the chosen one,
 * and a readable name for a point on the map. Runs on the server so that a paid API key (Google)
 * never ships inside an app.
 */
export interface PlacesProvider {
  search(query: string, near: LatLng | null, session: string | null): Promise<PlaceSuggestion[]>;
  details(id: string, session: string | null): Promise<PlaceDetails>;
  reverse(point: LatLng): Promise<string | null>;
}

export const PLACES_PROVIDER = Symbol('PLACES_PROVIDER');

/** The place service could not answer (down, slow, quota). Shown as "try again". */
export class PlacesUnavailableError extends Error {}

type FetchFn = typeof fetch;
const TIMEOUT_MS = 5000;
const MAX_RESULTS = 8;

async function getJson(fetchImpl: FetchFn, url: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new PlacesUnavailableError(`places request failed: ${String(err)}`);
  }
  if (res.status !== 200) throw new PlacesUnavailableError(`places HTTP ${res.status}`);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new PlacesUnavailableError('places response was not JSON');
  }
}

/** Ids that carry their own position: "pt:<lat>,<lng>". Used by providers that return points. */
function pointId(p: LatLng): string {
  return `pt:${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}
function pointFromId(id: string): LatLng | null {
  const m = /^pt:(-?\d{1,2}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/.exec(id);
  if (!m) return null;
  const p = { lat: Number(m[1]), lng: Number(m[2]) };
  return Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? p : null;
}

/**
 * DEVELOPMENT/TEST ONLY: a handful of well-known places in Jijiga and Nairobi. Production
 * configuration refuses it.
 */
export class DevPlaces implements PlacesProvider {
  static readonly PLACES: { name: string; detail: string; point: LatLng }[] = [
    { name: 'Taiwan Market', detail: 'Jijiga', point: { lat: 9.3505, lng: 42.7979 } },
    { name: 'Jijiga University', detail: 'Jijiga', point: { lat: 9.3655, lng: 42.8079 } },
    { name: 'Sheik Hassan Yabare Stadium', detail: 'Jijiga', point: { lat: 9.3536, lng: 42.7925 } },
    { name: 'BBS Mall', detail: 'Eastleigh, Nairobi', point: { lat: -1.2741, lng: 36.8513 } },
    { name: 'Donholm', detail: 'Nairobi', point: { lat: -1.2967, lng: 36.8908 } },
    { name: 'Westlands', detail: 'Nairobi', point: { lat: -1.2676, lng: 36.8108 } },
    { name: 'Kilimani', detail: 'Nairobi', point: { lat: -1.2921, lng: 36.7836 } },
  ];

  async search(query: string): Promise<PlaceSuggestion[]> {
    const q = query.toLowerCase();
    return DevPlaces.PLACES.filter((p) => `${p.name} ${p.detail}`.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
      .map((p) => ({ id: pointId(p.point), name: p.name, detail: p.detail, point: p.point }));
  }

  async details(id: string): Promise<PlaceDetails> {
    const point = pointFromId(id);
    const known = DevPlaces.PLACES.find((p) => point && pointId(p.point) === id);
    if (!point || !known) throw new PlacesUnavailableError('unknown place');
    return { point, name: known.name, detail: known.detail };
  }

  async reverse(): Promise<string | null> {
    return null;
  }
}

/** Who the server says it is when asking Photon: the app name, its website and a contact. */
export function photonUserAgent(website: string | undefined): string {
  return `Musride/1.0 (+${website ?? 'https://musride.com'}; Info@musride.com)`;
}
const PHOTON_DEFAULT_AGENT = photonUserAgent(undefined);

/**
 * Photon (photon.komoot.io): free search over OpenStreetMap data. Fine for testing; for a launch
 * use Google or a self-hosted Photon (the public server asks for fair use). Tested with a fake
 * HTTP server; NOT verified against the real service from the development environment.
 */
export class PhotonPlaces implements PlacesProvider {
  constructor(
    private readonly baseUrl = 'https://photon.komoot.io',
    private readonly fetchImpl: FetchFn = fetch,
    /**
     * The public Photon server answers 403 to clients that don't say who they are (Node's
     * default agent is just "node"); its operators ask for an agent naming the app and a way to
     * reach its makers. Found 2026-11-06: every search on staging failed with "not available".
     */
    private readonly userAgent = PHOTON_DEFAULT_AGENT,
  ) {}

  private get(url: URL) {
    return getJson(this.fetchImpl, url.toString(), {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
  }

  async search(
    query: string,
    near: LatLng | null,
    _session: string | null = null,
  ): Promise<PlaceSuggestion[]> {
    const u = new URL('/api/', this.baseUrl);
    u.searchParams.set('q', query);
    u.searchParams.set('limit', String(MAX_RESULTS));
    u.searchParams.set('lang', 'en');
    if (near) {
      u.searchParams.set('lat', String(near.lat));
      u.searchParams.set('lon', String(near.lng));
    }
    const body = (await this.get(u)) as PhotonResponse;
    return (body?.features ?? []).flatMap((f) => {
      const c = f.geometry?.coordinates;
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return [];
      const point = { lat: c[1], lng: c[0] };
      const p = f.properties ?? {};
      const name = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ');
      if (!name) return [];
      const detail = [p.district ?? p.locality, p.city, p.country].filter(Boolean).join(', ');
      return [{ id: pointId(point), name, detail: detail || null, point }];
    });
  }

  async details(id: string): Promise<PlaceDetails> {
    const point = pointFromId(id);
    if (!point) throw new PlacesUnavailableError('unknown place');
    return { point, name: (await this.reverse(point)) ?? 'Chosen place', detail: null };
  }

  async reverse(point: LatLng): Promise<string | null> {
    const u = new URL('/reverse', this.baseUrl);
    u.searchParams.set('lat', String(point.lat));
    u.searchParams.set('lon', String(point.lng));
    u.searchParams.set('lang', 'en');
    const body = (await this.get(u)) as PhotonResponse;
    const p = body?.features?.[0]?.properties;
    if (!p) return null;
    return p.name ?? ([p.street, p.housenumber].filter(Boolean).join(' ') || null);
  }
}

interface PhotonResponse {
  features?: {
    geometry?: { coordinates?: unknown[] };
    properties?: {
      name?: string;
      street?: string;
      housenumber?: string;
      district?: string;
      locality?: string;
      city?: string;
      country?: string;
    };
  }[];
}

/**
 * Google Places API (New): Autocomplete for suggestions, Place Details for the position, and the
 * Geocoding API for naming a map point. One session token per search keeps Google's billing per
 * search session, not per keystroke. The key stays on the server. Tested with a fake HTTP server;
 * NOT verified against Google from the development environment (owner action: API key).
 */
export class GooglePlaces implements PlacesProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly placesUrl = 'https://places.googleapis.com/v1',
    private readonly geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json',
  ) {}

  async search(
    query: string,
    near: LatLng | null,
    session: string | null,
  ): Promise<PlaceSuggestion[]> {
    const body = (await getJson(this.fetchImpl, `${this.placesUrl}/places:autocomplete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey },
      body: JSON.stringify({
        input: query,
        ...(session ? { sessionToken: session } : {}),
        ...(near
          ? {
              locationBias: {
                circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 },
              },
            }
          : {}),
      }),
    })) as {
      suggestions?: {
        placePrediction?: {
          placeId?: string;
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
          text?: { text?: string };
        };
      }[];
    };
    return (body?.suggestions ?? [])
      .flatMap((s) => {
        const p = s.placePrediction;
        const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
        if (!p?.placeId || !name) return [];
        return [
          {
            id: `g:${p.placeId}`,
            name,
            detail: p.structuredFormat?.secondaryText?.text ?? null,
            point: null,
          },
        ];
      })
      .slice(0, MAX_RESULTS);
  }

  async details(id: string, session: string | null): Promise<PlaceDetails> {
    const m = /^g:([A-Za-z0-9_-]{1,300})$/.exec(id);
    if (!m) throw new PlacesUnavailableError('unknown place');
    const u = new URL(`${this.placesUrl}/places/${m[1]}`);
    if (session) u.searchParams.set('sessionToken', session);
    const body = (await getJson(this.fetchImpl, u.toString(), {
      headers: {
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'location,displayName,formattedAddress',
      },
    })) as {
      location?: { latitude?: number; longitude?: number };
      displayName?: { text?: string };
      formattedAddress?: string;
    };
    const lat = body?.location?.latitude;
    const lng = body?.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new PlacesUnavailableError('Google Place Details response not understood');
    }
    return {
      point: { lat, lng },
      name: body.displayName?.text ?? body.formattedAddress ?? 'Chosen place',
      detail: body.formattedAddress ?? null,
    };
  }

  async reverse(point: LatLng): Promise<string | null> {
    const u = new URL(this.geocodeUrl);
    u.searchParams.set('latlng', `${point.lat},${point.lng}`);
    u.searchParams.set('key', this.apiKey);
    const body = (await getJson(this.fetchImpl, u.toString())) as {
      status?: string;
      results?: { formatted_address?: string }[];
    };
    if (body?.status === 'ZERO_RESULTS') return null;
    if (body?.status !== 'OK') throw new PlacesUnavailableError(`Geocoding ${body?.status}`);
    return body.results?.[0]?.formatted_address ?? null;
  }
}
