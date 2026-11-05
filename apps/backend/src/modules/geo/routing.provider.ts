import { haversineMetres, type LatLng } from '../../common/geo';

export interface Route {
  distanceMetres: number;
  durationSeconds: number;
  /** true when this is NOT a real road route (development estimate). Shown to users and stored on trips. */
  isEstimate: boolean;
}

/** Road-route distance and time between two points (requirement FR-02). */
export interface RoutingProvider {
  route(from: LatLng, to: LatLng): Promise<Route>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

/** Typical ratio of road distance to straight-line distance in a small city. A rough assumption. */
const ROAD_FACTOR = 1.3;
const AVERAGE_SPEED_KMH = 25;

/**
 * DEVELOPMENT/TEST ONLY: straight-line distance × 1.3. Always marked isEstimate.
 * Production configuration refuses this provider, because fares must use real road distance.
 */
export class StraightLineEstimateRouting implements RoutingProvider {
  async route(from: LatLng, to: LatLng): Promise<Route> {
    const distanceMetres = Math.round(haversineMetres(from, to) * ROAD_FACTOR);
    return {
      distanceMetres,
      durationSeconds: Math.round((distanceMetres / 1000 / AVERAGE_SPEED_KMH) * 3600),
      isEstimate: true,
    };
  }
}

/** The routing service could not answer (down, slow, quota). Shown as "try again". */
export class RoutingUnavailableError extends Error {}
/** The routing service answered that no road route exists between the points. */
export class NoRouteError extends Error {}

type FetchFn = typeof fetch;
const TIMEOUT_MS = 6000;

async function getJson(
  fetchImpl: FetchFn,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new RoutingUnavailableError(`routing request failed: ${String(err)}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error page
  }
  return { status: res.status, body };
}

/**
 * Google Maps Platform Routes API (computeRoutes), driving, without live traffic so the same trip
 * gets the same price at any time of day. Needs an API key restricted to the Routes API and to the
 * server's IP (owner action OA-09). Tested with a fake HTTP server; NOT verified against Google.
 */
export class GoogleRoutesRouting implements RoutingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly url = 'https://routes.googleapis.com/directions/v2:computeRoutes',
  ) {}

  async route(from: LatLng, to: LatLng): Promise<Route> {
    const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    const { status, body } = await getJson(this.fetchImpl, this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: point(from),
        destination: point(to),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });
    if (status !== 200) throw new RoutingUnavailableError(`Google Routes HTTP ${status}`);
    const routes = (body as { routes?: { distanceMeters?: number; duration?: string }[] } | null)
      ?.routes;
    const r = routes?.[0];
    if (!r) throw new NoRouteError('Google Routes returned no route');
    const seconds = /^(\d+(?:\.\d+)?)s$/.exec(r.duration ?? '');
    if (typeof r.distanceMeters !== 'number' || !seconds) {
      throw new RoutingUnavailableError('Google Routes response not understood');
    }
    return {
      distanceMetres: Math.round(r.distanceMeters),
      durationSeconds: Math.round(Number(seconds[1])),
      isEstimate: false,
    };
  }
}

/**
 * OSRM (Open Source Routing Machine) HTTP API, driving profile: either a self-hosted server with
 * Ethiopia's OpenStreetMap data, or a hosted OSRM service (owner action OA-09). The public demo
 * server must not be used in production. Tested with a fake HTTP server; NOT verified against a
 * real OSRM server.
 */
export class OsrmRouting implements RoutingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<Route> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=false&alternatives=false&steps=false`;
    const { status, body } = await getJson(this.fetchImpl, url, { method: 'GET' });
    const b = body as { code?: string; routes?: { distance?: number; duration?: number }[] } | null;
    if (b?.code === 'NoRoute') throw new NoRouteError('OSRM: no route');
    if (status !== 200 || b?.code !== 'Ok') {
      throw new RoutingUnavailableError(`OSRM HTTP ${status} ${b?.code ?? ''}`);
    }
    const r = b.routes?.[0];
    if (!r || typeof r.distance !== 'number' || typeof r.duration !== 'number') {
      throw new NoRouteError('OSRM returned no route');
    }
    return {
      distanceMetres: Math.round(r.distance),
      durationSeconds: Math.round(r.duration),
      isEstimate: false,
    };
  }
}
