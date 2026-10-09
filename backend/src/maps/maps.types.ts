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

/** One manoeuvre on a route ("Turn left onto Allen Avenue"), with where it happens and how far the road goes on after it. */
export interface RouteStep {
  instruction: string;
  /** Metres from this manoeuvre to the next one. */
  distanceM: number;
  lat: number;
  lng: number;
  /** The kind of manoeuvre as the provider names it (turn, roundabout, arrive...), for choosing an arrow. */
  type: string;
}

/** Which service answered. "estimate" means none did and the numbers are a straight-line guess. */
export type RouteProvider = 'mapbox' | 'google' | 'estimate';

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** An encoded polyline (precision 5, the same format from Mapbox and Google), or null when the road route is not available. */
  polyline: string | null;
  /** "road" is a real road route; "estimate" is a straight-line guess used only when the map service could not answer. */
  source: 'road' | 'estimate';
  provider: RouteProvider;
  /** Turn-by-turn instructions, only when asked for and only from a provider that has them. */
  steps?: RouteStep[];
}

/** The HTTP call both providers use. Replaced by a stand-in in tests. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;
export const MAPS_HTTP = Symbol('MAPS_HTTP');

/**
 * What the apps need from a map service: search for a place, name a spot, and drive between two spots. The business logic (fares,
 * dispatch, trip monitoring) only ever talks to MapsService, never to a provider, so a provider can be switched by configuration
 * (MAPS_PROVIDER) without touching anything else. A provider throws when the service fails; MapsService decides what to do about it.
 */
export interface MapProvider {
  readonly name: 'mapbox' | 'google';
  /** Places matching words, in the provider's own order of relevance. [near] biases the search toward where the person is. */
  searchPlaces(query: string, near: LatLng | null): Promise<PlaceResult[]>;
  /** The street address for a spot, or null when the provider has nothing better than a code. */
  reverse(at: LatLng): Promise<string | null>;
  /** The driving route, or null when the provider found none. [steps] asks for turn-by-turn instructions too (a provider without them leaves them out). */
  route(from: LatLng, to: LatLng, steps?: boolean): Promise<{ distanceM: number; durationS: number; polyline: string | null; steps?: RouteStep[] } | null>;
}

/** Nigeria's outline as a box. Used to throw away results from other countries, not to limit where a rider can go within Nigeria. */
export const NIGERIA = { south: 4.2, north: 13.95, west: 2.6, east: 14.75 };
export const insideNigeria = (p: LatLng) => p.lat >= NIGERIA.south && p.lat <= NIGERIA.north && p.lng >= NIGERIA.west && p.lng <= NIGERIA.east;

/** One call to a map service with a time limit. Shared by the providers. */
export async function callJson(http: Fetch, name: string, url: string, method: 'GET' | 'POST', headers: Record<string, string> = {}, body?: unknown): Promise<any> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await http(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal });
    // the address is not in the error: it carries the access token
    if (!res.ok) throw new Error(`${name} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
