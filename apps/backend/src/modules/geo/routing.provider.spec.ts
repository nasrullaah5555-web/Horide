import {
  GoogleRoutesRouting,
  NoRouteError,
  OsrmRouting,
  RoutingUnavailableError,
} from './routing.provider';

const FROM = { lat: 9.3505, lng: 42.7979 };
const TO = { lat: 9.3655, lng: 42.8079 };

/** A stand-in for fetch that records the request and returns a canned response. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('GoogleRoutesRouting (request/response format, fake server)', () => {
  it('asks for a driving route without traffic and reads distance and duration', async () => {
    const f = fakeFetch(200, { routes: [{ distanceMeters: 2412, duration: '347s' }] });
    const r = await new GoogleRoutesRouting('key-123', f.fn).route(FROM, TO);
    expect(r).toEqual({ distanceMetres: 2412, durationSeconds: 347, isEstimate: false });
    const init = f.calls[0]!.init;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('key-123');
    expect(headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration');
    const body = JSON.parse(init.body as string);
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
    expect(body.origin.location.latLng).toEqual({ latitude: FROM.lat, longitude: FROM.lng });
  });

  it('no route → NoRouteError; HTTP error or odd reply → RoutingUnavailableError', async () => {
    await expect(
      new GoogleRoutesRouting('k', fakeFetch(200, {}).fn).route(FROM, TO),
    ).rejects.toBeInstanceOf(NoRouteError);
    await expect(
      new GoogleRoutesRouting('k', fakeFetch(403, { error: {} }).fn).route(FROM, TO),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
    await expect(
      new GoogleRoutesRouting('k', fakeFetch(200, { routes: [{ distanceMeters: 5 }] }).fn).route(
        FROM,
        TO,
      ),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it('a network failure is "unavailable", not a crash', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new GoogleRoutesRouting('k', failing).route(FROM, TO)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
  });
});

describe('OsrmRouting (request/response format, fake server)', () => {
  it('uses lng,lat order and the driving profile', async () => {
    const f = fakeFetch(200, { code: 'Ok', routes: [{ distance: 2411.6, duration: 346.7 }] });
    const r = await new OsrmRouting('https://osrm.example.org/', f.fn).route(FROM, TO);
    expect(r).toEqual({ distanceMetres: 2412, durationSeconds: 347, isEstimate: false });
    expect(f.calls[0]!.url).toBe(
      'https://osrm.example.org/route/v1/driving/42.7979,9.3505;42.8079,9.3655?overview=false&alternatives=false&steps=false',
    );
  });

  it('NoRoute → NoRouteError; server errors → RoutingUnavailableError', async () => {
    await expect(
      new OsrmRouting('https://o.test', fakeFetch(400, { code: 'NoRoute' }).fn).route(FROM, TO),
    ).rejects.toBeInstanceOf(NoRouteError);
    await expect(
      new OsrmRouting('https://o.test', fakeFetch(500, { code: 'Error' }).fn).route(FROM, TO),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
  });
});
