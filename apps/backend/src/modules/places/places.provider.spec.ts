import { DevPlaces, GooglePlaces, PhotonPlaces, PlacesUnavailableError } from './places.provider';

const NEAR = { lat: -1.2741, lng: 36.8513 };

function fakeFetch(...replies: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('PhotonPlaces (request/response format, fake server)', () => {
  it('searches near the passenger and returns names with positions', async () => {
    const f = fakeFetch({
      status: 200,
      body: {
        features: [
          {
            geometry: { coordinates: [36.8908, -1.2967] },
            properties: { name: 'Donholm', city: 'Nairobi', country: 'Kenya' },
          },
          {
            geometry: { coordinates: [36.85, -1.27] },
            properties: { street: 'First Avenue', housenumber: '12' },
          },
          { geometry: {}, properties: { name: 'No position' } },
        ],
      },
    });
    const r = await new PhotonPlaces('https://photon.test', f.fn).search('donholm', NEAR, null);
    expect(r).toEqual([
      {
        id: 'pt:-1.296700,36.890800',
        name: 'Donholm',
        detail: 'Nairobi, Kenya',
        point: { lat: -1.2967, lng: 36.8908 },
      },
      {
        id: 'pt:-1.270000,36.850000',
        name: 'First Avenue 12',
        detail: null,
        point: { lat: -1.27, lng: 36.85 },
      },
    ]);
    const u = new URL(f.calls[0]!.url);
    expect(u.pathname).toBe('/api/');
    expect(u.searchParams.get('q')).toBe('donholm');
    expect(u.searchParams.get('lat')).toBe(String(NEAR.lat));
    expect(u.searchParams.get('lon')).toBe(String(NEAR.lng));
  });

  it('names a point on the map; a server error becomes PlacesUnavailableError', async () => {
    const ok = fakeFetch({
      status: 200,
      body: { features: [{ properties: { name: 'BBS Mall' } }] },
    });
    expect(await new PhotonPlaces('https://photon.test', ok.fn).reverse(NEAR)).toBe('BBS Mall');
    expect(new URL(ok.calls[0]!.url).pathname).toBe('/reverse');
    const bad = fakeFetch({ status: 502, body: {} });
    await expect(
      new PhotonPlaces('https://photon.test', bad.fn).reverse(NEAR),
    ).rejects.toBeInstanceOf(PlacesUnavailableError);
  });
});

describe('GooglePlaces (request/response format, fake server)', () => {
  it('autocompletes with a session token and a bias around the passenger', async () => {
    const f = fakeFetch({
      status: 200,
      body: {
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJabc123',
              structuredFormat: {
                mainText: { text: 'BBS Mall' },
                secondaryText: { text: 'Eastleigh, Nairobi' },
              },
            },
          },
          { queryPrediction: { text: { text: 'bbs' } } },
        ],
      },
    });
    const r = await new GooglePlaces('key-123456789012345678', f.fn).search(
      'bbs',
      NEAR,
      'sess12345',
    );
    expect(r).toEqual([
      { id: 'g:ChIJabc123', name: 'BBS Mall', detail: 'Eastleigh, Nairobi', point: null },
    ]);
    const call = f.calls[0]!;
    expect(call.url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect((call.init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(
      'key-123456789012345678',
    );
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({ input: 'bbs', sessionToken: 'sess12345' });
    expect(body.locationBias.circle.center).toEqual({ latitude: NEAR.lat, longitude: NEAR.lng });
  });

  it('gets the position of the chosen place, asking only for the fields it needs', async () => {
    const f = fakeFetch({
      status: 200,
      body: {
        location: { latitude: -1.2741, longitude: 36.8513 },
        displayName: { text: 'BBS Mall' },
        formattedAddress: 'Eastleigh, Nairobi, Kenya',
      },
    });
    const d = await new GooglePlaces('key-123456789012345678', f.fn).details(
      'g:ChIJabc123',
      'sess12345',
    );
    expect(d).toEqual({ point: NEAR, name: 'BBS Mall', detail: 'Eastleigh, Nairobi, Kenya' });
    const u = new URL(f.calls[0]!.url);
    expect(u.pathname).toBe('/v1/places/ChIJabc123');
    expect(u.searchParams.get('sessionToken')).toBe('sess12345');
    expect((f.calls[0]!.init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
      'location,displayName,formattedAddress',
    );
  });

  it('refuses ids that are not Google place ids (no path tricks)', async () => {
    const g = new GooglePlaces('key-123456789012345678', fakeFetch({ status: 200, body: {} }).fn);
    await expect(g.details('g:../../secret', null)).rejects.toBeInstanceOf(PlacesUnavailableError);
    await expect(g.details('pt:1,2', null)).rejects.toBeInstanceOf(PlacesUnavailableError);
  });

  it('names a point with the Geocoding API', async () => {
    const f = fakeFetch({
      status: 200,
      body: { status: 'OK', results: [{ formatted_address: 'Donholm, Nairobi' }] },
    });
    expect(await new GooglePlaces('key-123456789012345678', f.fn).reverse(NEAR)).toBe(
      'Donholm, Nairobi',
    );
    expect(new URL(f.calls[0]!.url).searchParams.get('latlng')).toBe(`${NEAR.lat},${NEAR.lng}`);
    const denied = fakeFetch({ status: 200, body: { status: 'REQUEST_DENIED' } });
    await expect(
      new GooglePlaces('key-123456789012345678', denied.fn).reverse(NEAR),
    ).rejects.toBeInstanceOf(PlacesUnavailableError);
  });
});

describe('DevPlaces', () => {
  it('finds the sample places by name and returns their position by id', async () => {
    const dev = new DevPlaces();
    const [donholm] = await dev.search('donh');
    expect(donholm!.name).toBe('Donholm');
    expect((await dev.details(donholm!.id)).point).toEqual(donholm!.point);
  });
});
