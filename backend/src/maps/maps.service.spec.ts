import { MapsService, PlaceResult, distanceM, estimateRoute, insideNigeria, rankByProximity, selectProvider } from './maps.service';

const place = (id: string, lat: number, lng: number): PlaceResult => ({ id, name: id, address: id, lat, lng, distanceM: null });
const LAGOS = { lat: 6.6018, lng: 3.3515 };      // Ikeja
const IBADAN = { lat: 7.3775, lng: 3.947 };
const ABUJA = { lat: 9.0765, lng: 7.3986 };

describe('rankByProximity', () => {
  it('puts the places around the person first, in the provider\'s order inside a group, and drops namesakes over 150 km away', () => {
    const results = [place('abuja', ABUJA.lat, ABUJA.lng), place('lekki', 6.45, 3.55), place('computer-village', 6.5964, 3.3426), place('ibadan', IBADAN.lat, IBADAN.lng)];
    const ranked = rankByProximity(results, LAGOS).map((r) => r.id);
    expect(ranked[0]).toBe('computer-village');
    expect(ranked).toEqual(['computer-village', 'lekki', 'ibadan']); // Ibadan (about 110 km) comes last; Abuja is over 150 km away and is dropped
  });

  it('keeps the provider\'s order when nothing is near, because the person is asking about somewhere else', () => {
    const results = [place('kfc-ring-road', 7.4, 3.9), place('kfc-dugbe', 7.38, 3.88)];
    expect(rankByProximity(results, LAGOS).map((r) => r.id)).toEqual(['kfc-ring-road', 'kfc-dugbe']);
  });

  it('works anywhere in the country, not just one city', () => {
    const results = [place('lagos', LAGOS.lat, LAGOS.lng), place('kfc-wuse', 9.07, 7.47), place('kfc-garki', 9.03, 7.49)];
    expect(rankByProximity(results, ABUJA).map((r) => r.id)).toEqual(['kfc-wuse', 'kfc-garki']);
  });

  it('leaves the order alone with no position', () => {
    const results = [place('a', 1, 1), place('b', 2, 2)];
    expect(rankByProximity(results, null)).toBe(results);
  });
});

const answer = (json: unknown, ok = true, status = 200) => jest.fn(async () => ({ ok, status, json: async () => json, text: async () => 'body' }));
const called = (http: jest.Mock, n = 0) => http.mock.calls[n] as unknown as [string, { body?: string; headers: Record<string, string> }];

describe('choosing the map provider', () => {
  const http = answer({}) as never;
  it('uses Mapbox when its token is set, Google when only its key is, and nothing when neither is', () => {
    expect(selectProvider(http, { MAPBOX_ACCESS_TOKEN: 't' })?.name).toBe('mapbox');
    expect(selectProvider(http, { GOOGLE_MAPS_API_KEY: 'k' })?.name).toBe('google');
    expect(selectProvider(http, { MAPBOX_ACCESS_TOKEN: 't', GOOGLE_MAPS_API_KEY: 'k' })?.name).toBe('mapbox');
    expect(selectProvider(http, {})).toBeNull();
  });
  it('lets MAPS_PROVIDER pick on purpose, and never quietly uses the other one when the chosen one has no key', () => {
    expect(selectProvider(http, { MAPS_PROVIDER: 'google', MAPBOX_ACCESS_TOKEN: 't', GOOGLE_MAPS_API_KEY: 'k' })?.name).toBe('google');
    expect(selectProvider(http, { MAPS_PROVIDER: 'google', MAPBOX_ACCESS_TOKEN: 't' })).toBeNull();
    expect(selectProvider(http, { MAPS_PROVIDER: 'mapbox', GOOGLE_MAPS_API_KEY: 'k' })).toBeNull();
  });
});

describe('MapsService with Mapbox', () => {
  const keep = { ...process.env };
  beforeEach(() => { delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.MAPS_PROVIDER; process.env.MAPBOX_ACCESS_TOKEN = 'TOKEN'; });
  afterEach(() => { process.env = { ...keep }; });

  const feature = (id: string, name: string, lng: number, lat: number, full?: string) => ({ properties: { mapbox_id: id, name, full_address: full, place_formatted: 'Ikeja, Lagos, Nigeria' }, geometry: { coordinates: [lng, lat] } });

  it('searches Nigeria with the phone\'s position as the bias, and keeps only Nigerian results', async () => {
    const http = answer({ features: [feature('p1', 'Computer Village', 3.3426, 6.5964), feature('p2', 'Somewhere in Accra', -0.19, 5.6)] });
    const found = await new MapsService(http as never).searchPlaces('u1', 'Computer Village', LAGOS);
    expect(found.map((p) => p.name)).toEqual(['Computer Village']);
    expect(found[0].address).toBe('Ikeja, Lagos, Nigeria');
    const [url] = called(http);
    expect(url).toContain('/search/searchbox/v1/forward');
    expect(url).toContain('q=Computer%20Village');
    expect(url).toContain('country=ng');
    expect(url).toContain(`proximity=${encodeURIComponent('3.3515,6.6018')}`);
    expect(url).toContain('access_token=TOKEN');
  });

  it('searches the whole country when the position is unknown', async () => {
    const http = answer({ features: [] });
    await new MapsService(http as never).searchPlaces('u1', 'KFC Ibadan', null);
    expect(called(http)[0]).not.toContain('proximity');
  });

  it('falls back to the geocoding service when Search Box refuses the token', async () => {
    const http = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}), text: async () => 'no access' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ features: [feature('a1', '12 Allen Avenue', 3.35, 6.6, '12 Allen Avenue, Ikeja')] }), text: async () => '' });
    const found = await new MapsService(http as never).searchPlaces('u1', 'allen avenue', LAGOS);
    expect(found[0].address).toBe('12 Allen Avenue, Ikeja');
    expect(called(http, 1)[0]).toContain('/search/geocode/v6/forward');
  });

  it('says so when the search is not set up or Mapbox fails, and never puts the token in the error', async () => {
    delete process.env.MAPBOX_ACCESS_TOKEN;
    await expect(new MapsService(answer({}) as never).searchPlaces('u1', 'kfc', null)).rejects.toThrow(/not set up/);
    process.env.MAPBOX_ACCESS_TOKEN = 'TOKEN';
    const err = await new MapsService(answer({}, false, 500) as never).searchPlaces('u1', 'kfc', null).catch((e) => e);
    expect(String(err.message)).toMatch(/not available/);
    expect(String(err.message)).not.toContain('TOKEN');
  });

  it('limits how fast one person can search', async () => {
    const svc = new MapsService(answer({ features: [] }) as never);
    for (let i = 0; i < 90; i++) await svc.searchPlaces('spam', 'kfc', null);
    await expect(svc.searchPlaces('spam', 'kfc', null)).rejects.toThrow(/too many/);
    await expect(svc.searchPlaces('someone-else', 'kfc', null)).resolves.toEqual([]);
  });

  it('returns a road route with its distance, time and polyline, asking for live traffic', async () => {
    const http = answer({ routes: [{ distance: 5230.4, duration: 811.6, geometry: '_p~iF~ps|U_ulLnnqC' }] });
    const good = await new MapsService(http as never).route(LAGOS, IBADAN);
    expect(good).toEqual({ distanceM: 5230, durationS: 812, polyline: '_p~iF~ps|U_ulLnnqC', source: 'road', provider: 'mapbox' });
    const [url] = called(http);
    expect(url).toContain('/directions/v5/mapbox/driving-traffic/3.3515,6.6018;3.947,7.3775');
    expect(url).toContain('geometries=polyline');
  });

  it('gives a marked estimate when Mapbox cannot answer or finds no route', async () => {
    const down = await new MapsService(answer({}, false, 503) as never).route(LAGOS, { lat: 6.5964, lng: 3.3426 });
    expect(down).toMatchObject({ source: 'estimate', provider: 'estimate', polyline: null });
    expect(down.distanceM).toBeGreaterThan(distanceM(LAGOS, { lat: 6.5964, lng: 3.3426 }));
    expect((await new MapsService(answer({ routes: [] }) as never).route(LAGOS, IBADAN)).source).toBe('estimate');
  });

  it('gives the street address for a pin, and null when there is none', async () => {
    const http = answer({ features: [{ properties: { full_address: '12 Allen Avenue, Ikeja, Lagos, Nigeria' } }] });
    expect(await new MapsService(http as never).reverse('u1', LAGOS)).toBe('12 Allen Avenue, Ikeja, Lagos, Nigeria');
    expect(called(http)[0]).toContain('/search/geocode/v6/reverse');
    expect(called(http)[0]).toContain('longitude=3.3515');
    expect(await new MapsService(answer({ features: [] }) as never).reverse('u1', LAGOS)).toBeNull();
  });

  it('reports which provider is answering', () => {
    expect(new MapsService(answer({}) as never).providerName).toBe('mapbox');
  });
});

describe('MapsService with Google (kept ready for when a Google subscription exists)', () => {
  const keep = { ...process.env };
  beforeEach(() => { delete process.env.MAPBOX_ACCESS_TOKEN; delete process.env.MAPS_PROVIDER; process.env.GOOGLE_MAPS_API_KEY = 'KEY'; });
  afterEach(() => { process.env = { ...keep }; });

  it('asks Google for places with a bias around the person and keeps only Nigerian results', async () => {
    const http = answer({ places: [
      { id: 'p1', displayName: { text: 'Computer Village' }, formattedAddress: 'Ikeja, Lagos', location: { latitude: 6.5964, longitude: 3.3426 } },
      { id: 'p2', displayName: { text: 'Somewhere in Accra' }, formattedAddress: 'Accra', location: { latitude: 5.6, longitude: -0.19 } },
    ] });
    const found = await new MapsService(http as never).searchPlaces('u1', 'Computer Village', LAGOS);
    expect(found.map((p) => p.name)).toEqual(['Computer Village']);
    const [url, init] = called(http);
    expect(url).toContain('places:searchText');
    expect(init.headers['X-Goog-Api-Key']).toBe('KEY');
    expect(JSON.parse(init.body as string)).toMatchObject({ textQuery: 'Computer Village', regionCode: 'NG', locationBias: { circle: { center: { latitude: LAGOS.lat, longitude: LAGOS.lng } } } });
  });

  it('returns the same kind of route as Mapbox does, and the same estimate when Google cannot answer', async () => {
    const good = await new MapsService(answer({ routes: [{ distanceMeters: 5230, duration: '812s', polyline: { encodedPolyline: 'abc' } }] }) as never).route(LAGOS, IBADAN);
    expect(good).toEqual({ distanceM: 5230, durationS: 812, polyline: 'abc', source: 'road', provider: 'google' });
    expect((await new MapsService(answer({}, false, 503) as never).route(LAGOS, IBADAN)).source).toBe('estimate');
  });

  it('gives the street address for a pin, skipping plus codes', async () => {
    const http = answer({ results: [{ types: ['plus_code'], formatted_address: '5RWQ+X9' }, { types: ['street_address'], formatted_address: '12 Allen Avenue, Ikeja' }] });
    expect(await new MapsService(http as never).reverse('u1', LAGOS)).toBe('12 Allen Avenue, Ikeja');
  });
});

describe('helpers', () => {
  it('knows what is inside Nigeria', () => {
    expect(insideNigeria(LAGOS)).toBe(true);
    expect(insideNigeria({ lat: 5.6, lng: -0.19 })).toBe(false);
  });
  it('estimates a route longer than the straight line', () => {
    expect(estimateRoute(LAGOS, ABUJA).distanceM).toBeGreaterThan(distanceM(LAGOS, ABUJA));
  });
});
