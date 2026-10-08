import { MapsService, PlaceResult, distanceM, estimateRoute, insideNigeria, rankByProximity } from './maps.service';

const place = (id: string, lat: number, lng: number): PlaceResult => ({ id, name: id, address: id, lat, lng, distanceM: null });
const LAGOS = { lat: 6.6018, lng: 3.3515 };      // Ikeja
const IBADAN = { lat: 7.3775, lng: 3.947 };
const ABUJA = { lat: 9.0765, lng: 7.3986 };

describe('rankByProximity', () => {
  it('puts the places around the person first, in Google\'s order inside a group, and drops namesakes over 150 km away', () => {
    const results = [place('abuja', ABUJA.lat, ABUJA.lng), place('lekki', 6.45, 3.55), place('computer-village', 6.5964, 3.3426), place('ibadan', IBADAN.lat, IBADAN.lng)];
    const ranked = rankByProximity(results, LAGOS).map((r) => r.id);
    expect(ranked[0]).toBe('computer-village');
    expect(ranked).toEqual(['computer-village', 'lekki', 'ibadan']); // Ibadan (about 110 km) comes last; Abuja is over 150 km away and is dropped
  });

  it('keeps Google\'s order when nothing is near, because the person is asking about somewhere else', () => {
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

describe('MapsService', () => {
  const keep = process.env.GOOGLE_MAPS_API_KEY;
  beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = 'KEY'; });
  afterEach(() => { if (keep === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = keep; });
  const answer = (json: unknown, ok = true, status = 200) => jest.fn(async () => ({ ok, status, json: async () => json, text: async () => 'body' }));

  it('asks Google for places with a bias around the person and keeps only Nigerian results', async () => {
    const http = answer({ places: [
      { id: 'p1', displayName: { text: 'Computer Village' }, formattedAddress: 'Ikeja, Lagos', location: { latitude: 6.5964, longitude: 3.3426 } },
      { id: 'p2', displayName: { text: 'Somewhere in Accra' }, formattedAddress: 'Accra', location: { latitude: 5.6, longitude: -0.19 } },
    ] });
    const found = await new MapsService(http as never).searchPlaces('u1', 'Computer Village', LAGOS);
    expect(found.map((p) => p.name)).toEqual(['Computer Village']);
    const [url, init] = http.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toContain('places:searchText');
    expect(init.headers['X-Goog-Api-Key']).toBe('KEY');
    expect(JSON.parse(init.body)).toMatchObject({ textQuery: 'Computer Village', regionCode: 'NG', locationBias: { circle: { center: { latitude: LAGOS.lat, longitude: LAGOS.lng } } } });
  });

  it('searches the whole country when the position is unknown', async () => {
    const http = answer({ places: [] });
    await new MapsService(http as never).searchPlaces('u1', 'KFC Ibadan', null);
    expect(JSON.parse((http.mock.calls[0] as unknown as [string, { body: string }])[1].body).locationBias).toBeUndefined();
  });

  it('says so when the search is not set up or Google fails', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    await expect(new MapsService(answer({}) as never).searchPlaces('u1', 'kfc', null)).rejects.toThrow(/not set up/);
    process.env.GOOGLE_MAPS_API_KEY = 'KEY';
    await expect(new MapsService(answer({}, false, 500) as never).searchPlaces('u1', 'kfc', null)).rejects.toThrow(/not available/);
  });

  it('limits how fast one person can search', async () => {
    const svc = new MapsService(answer({ places: [] }) as never);
    for (let i = 0; i < 90; i++) await svc.searchPlaces('spam', 'kfc', null);
    await expect(svc.searchPlaces('spam', 'kfc', null)).rejects.toThrow(/too many/);
    await expect(svc.searchPlaces('someone-else', 'kfc', null)).resolves.toEqual([]);
  });

  it('returns a road route, and a marked estimate when Google cannot answer', async () => {
    const good = await new MapsService(answer({ routes: [{ distanceMeters: 5230, duration: '812s', polyline: { encodedPolyline: 'abc' } }] }) as never).route(LAGOS, IBADAN);
    expect(good).toEqual({ distanceM: 5230, durationS: 812, polyline: 'abc', source: 'google' });
    const bad = await new MapsService(answer({}, false, 503) as never).route(LAGOS, { lat: 6.5964, lng: 3.3426 });
    expect(bad.source).toBe('estimate');
    expect(bad.polyline).toBeNull();
    expect(bad.distanceM).toBeGreaterThan(distanceM(LAGOS, { lat: 6.5964, lng: 3.3426 }));
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
