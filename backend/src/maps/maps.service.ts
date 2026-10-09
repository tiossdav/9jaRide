import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GoogleMapProvider } from './providers/google.provider';
import { MapboxMapProvider } from './providers/mapbox.provider';
import { Fetch, LatLng, MAPS_HTTP, MapProvider, PlaceResult, RouteResult } from './maps.types';

export * from './maps.types';

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
 * The provider gives results in order of relevance. When something relevant is around the person (within 60 km), results are grouped by
 * distance (under 10 km, under 30 km, under 60 km, then the rest) and keep the provider's relevance order inside a group, and results more
 * than 150 km away are dropped. When nothing is near, the person is asking about somewhere else ("KFC in Ibadan" while in Lagos): the
 * provider's own order is kept untouched. This is done here, not in a provider, so it behaves the same whichever provider answers.
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

/** A rough road distance and time when no map service can be reached: straight line plus a detour allowance, at city speed. */
export function estimateRoute(from: LatLng, to: LatLng): RouteResult {
  const distance = Math.round(distanceM(from, to) * 1.35);
  return { distanceM: distance, durationS: Math.round(distance / (30_000 / 3600)), polyline: null, source: 'estimate', provider: 'estimate' };
}

/**
 * Which map service to use. MAPS_PROVIDER=mapbox | google picks one on purpose; left empty, Mapbox is used when MAPBOX_ACCESS_TOKEN is set,
 * otherwise Google when GOOGLE_MAPS_API_KEY is set. A provider named without its key is "not set up", it does not quietly use the other.
 */
export function selectProvider(http: Fetch, env: NodeJS.ProcessEnv = process.env): MapProvider | null {
  const mapbox = env.MAPBOX_ACCESS_TOKEN?.trim();
  const google = env.GOOGLE_MAPS_API_KEY?.trim();
  const wanted = env.MAPS_PROVIDER?.trim().toLowerCase();
  const choice = wanted === 'mapbox' || wanted === 'google' ? wanted : mapbox ? 'mapbox' : google ? 'google' : null;
  if (choice === 'mapbox') return mapbox ? new MapboxMapProvider(mapbox, http) : null;
  if (choice === 'google') return google ? new GoogleMapProvider(google, http) : null;
  return null;
}

/**
 * Everything the apps need from a map service, asked on their behalf so the access token stays on the server: place search, an address for
 * a dropped pin, and road routes. The provider (Mapbox or Google) is a configuration choice; nothing else in the backend knows which one it is.
 * Live tracking does not come from here; it stays GPS to the 9jaRide backend.
 */
@Injectable()
export class MapsService {
  private readonly log = new Logger(MapsService.name);
  private readonly recent = new Map<string, number[]>();

  private readonly http: Fetch;

  /** [http] is only given in tests, to stand in for the map service. */
  constructor(@Optional() @Inject(MAPS_HTTP) http?: Fetch) { this.http = http ?? (fetch as unknown as Fetch); }

  private provider(): MapProvider | null { return selectProvider(this.http); }
  get configured(): boolean { return this.provider() !== null; }
  /** Which provider is answering, for the admin portal and for logs. */
  get providerName(): 'mapbox' | 'google' | null { return this.provider()?.name ?? null; }

  /** A person typing in the search box can send a few requests a second; a script cannot send hundreds. */
  private allow(who: string, perMinute: number): void {
    const now = Date.now();
    const hits = (this.recent.get(who) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= perMinute) throw new HttpException('too many searches, slow down for a moment', HttpStatus.TOO_MANY_REQUESTS);
    hits.push(now);
    this.recent.set(who, hits);
    if (this.recent.size > 5000) for (const [k, v] of this.recent) if (!v.some((t) => now - t < 60_000)) this.recent.delete(k);
  }

  /** Search for a place by name. [near] is where the person is, when the phone knows. */
  async searchPlaces(who: string, query: string, near: LatLng | null): Promise<PlaceResult[]> {
    const provider = this.provider();
    if (!provider) throw new ServiceUnavailableException('Place search is not set up yet.');
    const text = query.trim();
    if (text.length < 2) return [];
    this.allow(who, 90);
    let found: PlaceResult[];
    try {
      found = await provider.searchPlaces(text, near);
    } catch (e) {
      this.log.error(`place search failed (${provider.name}): ${e}`);
      throw new ServiceUnavailableException('Place search is not available right now. Try again in a moment.');
    }
    return rankByProximity(found, near);
  }

  /** The street address for a pin. Null when the provider has nothing better than a code. */
  async reverse(who: string, at: LatLng): Promise<string | null> {
    const provider = this.provider();
    if (!provider) return null;
    this.allow(who, 60);
    try {
      return await provider.reverse(at);
    } catch (e) {
      this.log.error(`reverse geocoding failed (${provider.name}): ${e}`);
      return null;
    }
  }

  /**
   * The road route between two points. Never throws: if the map service cannot answer, a clearly marked estimate comes back so a trip is not
   * blocked by a map outage, and nothing pretends the estimate is a road route.
   */
  async route(from: LatLng, to: LatLng, steps = false): Promise<RouteResult> {
    const provider = this.provider();
    if (!provider) return estimateRoute(from, to);
    try {
      const r = await provider.route(from, to, steps);
      if (!r) throw new Error('no route in the answer');
      return { ...r, source: 'road', provider: provider.name };
    } catch (e) {
      this.log.error(`route failed (${provider.name}), using an estimate: ${e}`);
      return estimateRoute(from, to);
    }
  }

  static validPoint(p: LatLng): void {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) throw new BadRequestException('that is not a valid location');
  }
}
