import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';

export interface LatLng { lat: number; lng: number }

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Straight-line metres from the person's position, when it is known. */
  distanceM: number | null;
}

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** Google's encoded polyline, or null when the road route is not available. */
  polyline: string | null;
  /** "google" is a real road route; "estimate" is a straight-line guess used only when Google could not answer. */
  source: 'google' | 'estimate';
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export const MAPS_HTTP = Symbol('MAPS_HTTP');

/** Nigeria's outline as a box. Used to throw away results from other countries, not to limit where a rider can go within Nigeria. */
const NIGERIA = { south: 4.2, north: 13.95, west: 2.6, east: 14.75 };
export const insideNigeria = (p: LatLng) => p.lat >= NIGERIA.south && p.lat <= NIGERIA.north && p.lng >= NIGERIA.west && p.lng <= NIGERIA.east;

const BIAS_RADIUS_M = 50_000; // the most Google allows for a circular bias
const LOCAL_KM = 60;          // a result this close counts as "around here"
const FAR_KM = 150;           // once something local exists, results beyond this are noise
const BUCKETS_KM = [10, 30, LOCAL_KM];

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Put the nearest relevant results first without confining the search to one city.
 * Google gives results in order of relevance. When something relevant is around the person (within 60 km), results are grouped by
 * distance (under 10 km, under 30 km, under 60 km, then the rest) and keep Google's relevance order inside a group, and results more than
 * 150 km away are dropped. When nothing is near, the person is asking about somewhere else ("KFC in Ibadan" while in Lagos): Google's
 * own order is kept untouched.
 */
export function rankByProximity(results: PlaceResult[], near: LatLng | null): PlaceResult[] {
  if (!near) return results;
  const withDistance = results.map((r) => ({ ...r, distanceM: Math.round(distanceM(near, r)) }));
  const nearest = Math.min(...withDistance.map((r) => r.distanceM as number));
  if (!withDistance.length || nearest > LOCAL_KM * 1000) return withDistance;
  const bucket = (m: number) => { const i = BUCKETS_KM.findIndex((km) => m <= km * 1000); return i === -1 ? BUCKETS_KM.length : i; };
  return withDistance
    .filter((r) => (r.distanceM as number) <= FAR_KM * 1000)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => bucket(a.r.distanceM as number) - bucket(b.r.distanceM as number) || a.i - b.i)
    .map((x) => x.r);
}

/** A rough road distance and time when Google cannot be reached: straight line plus a detour allowance, at city speed. */
export function estimateRoute(from: LatLng, to: LatLng): RouteResult {
  const distance = Math.round(distanceM(from, to) * 1.35);
  return { distanceM: distance, durationS: Math.round(distance / (30_000 / 3600)), polyline: null, source: 'estimate' };
}

/**
 * Everything the apps need from Google Maps, asked on their behalf so the key stays on the server: place search, an address for a
 * dropped pin, and road routes. Live tracking does not come from here; it stays GPS to the 9jaRide backend.
 */
@Injectable()
export class MapsService {
  private readonly log = new Logger(MapsService.name);
  private readonly recent = new Map<string, number[]>();

  private readonly http: Fetch;

  /** [http] is only given in tests, to stand in for Google. */
  constructor(@Optional() @Inject(MAPS_HTTP) http?: Fetch) { this.http = http ?? (fetch as unknown as Fetch); }

  private key(): string | null { return process.env.GOOGLE_MAPS_API_KEY?.trim() || null; }
  get configured(): boolean { return this.key() !== null; }

  /** A person typing in the search box can send a few requests a second; a script cannot send hundreds. */
  private allow(who: string, perMinute: number): void {
    const now = Date.now();
    const hits = (this.recent.get(who) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= perMinute) throw new HttpException('too many searches, slow down for a moment', HttpStatus.TOO_MANY_REQUESTS);
    hits.push(now);
    this.recent.set(who, hits);
    if (this.recent.size > 5000) for (const [k, v] of this.recent) if (!v.some((t) => now - t < 60_000)) this.recent.delete(k);
  }

  private async call(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown): Promise<any> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const res = await this.http(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal });
      if (!res.ok) throw new Error(`Google answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  /** Search for a place by name. [near] is where the person is, when the phone knows. */
  async searchPlaces(who: string, query: string, near: LatLng | null): Promise<PlaceResult[]> {
    const key = this.key();
    if (!key) throw new ServiceUnavailableException('Place search is not set up yet.');
    const text = query.trim();
    if (text.length < 2) return [];
    this.allow(who, 90);
    let data: any;
    try {
      data = await this.call('https://places.googleapis.com/v1/places:searchText', 'POST', {
        'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      }, {
        textQuery: text, regionCode: 'NG', languageCode: 'en', pageSize: 10,
        ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M } } } : {}),
      });
    } catch (e) {
      this.log.error(`place search failed: ${e}`);
      throw new ServiceUnavailableException('Place search is not available right now. Try again in a moment.');
    }
    const results: PlaceResult[] = (data.places ?? [])
      .map((p: any): PlaceResult => ({
        id: String(p.id), name: String(p.displayName?.text ?? p.formattedAddress ?? ''), address: String(p.formattedAddress ?? ''),
        lat: Number(p.location?.latitude), lng: Number(p.location?.longitude), distanceM: null,
      }))
      .filter((p: PlaceResult) => p.id && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng) && insideNigeria(p));
    return rankByProximity(results, near);
  }

  /** The street address for a pin. Null when Google has nothing better than a code. */
  async reverse(who: string, at: LatLng): Promise<string | null> {
    const key = this.key();
    if (!key) return null;
    this.allow(who, 60);
    try {
      const data = await this.call(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${at.lat},${at.lng}&language=en&region=ng&key=${encodeURIComponent(key)}`, 'GET', {});
      const best = (data.results ?? []).find((r: any) => !(r.types ?? []).includes('plus_code')) ?? null;
      return best ? String(best.formatted_address) : null;
    } catch (e) {
      this.log.error(`reverse geocoding failed: ${e}`);
      return null;
    }
  }

  /**
   * The road route between two points. Never throws: if Google cannot answer, a clearly marked estimate comes back so a trip is not
   * blocked by a map outage, and nothing pretends the estimate is a road route.
   */
  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const key = this.key();
    if (!key) return estimateRoute(from, to);
    try {
      const data = await this.call('https://routes.googleapis.com/directions/v2:computeRoutes', 'POST', {
        'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      }, {
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', languageCode: 'en', units: 'METRIC',
      });
      const r = data.routes?.[0];
      const seconds = Number(String(r?.duration ?? '').replace('s', ''));
      if (!r || !Number.isFinite(Number(r.distanceMeters)) || !Number.isFinite(seconds)) throw new Error('no route in the answer');
      return { distanceM: Math.round(Number(r.distanceMeters)), durationS: Math.round(seconds), polyline: r.polyline?.encodedPolyline ?? null, source: 'google' };
    } catch (e) {
      this.log.error(`route failed, using an estimate: ${e}`);
      return estimateRoute(from, to);
    }
  }

  static validPoint(p: LatLng): void {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) throw new BadRequestException('that is not a valid location');
  }
}
