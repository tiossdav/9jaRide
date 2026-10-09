import { Fetch, LatLng, MapProvider, NIGERIA, PlaceResult, RouteStep, callJson, insideNigeria } from '../maps.types';

const API = 'https://api.mapbox.com';

/**
 * Mapbox: Search Box (places and businesses), Geocoding v6 (addresses for a spot) and Directions (driving routes with live traffic).
 * Needs MAPBOX_ACCESS_TOKEN. Directions geometry is requested as a precision-5 polyline, the same format Google gives, so the apps
 * decode it the same way whichever provider answered.
 */
export class MapboxMapProvider implements MapProvider {
  readonly name = 'mapbox' as const;
  constructor(private readonly token: string, private readonly http: Fetch) {}

  private url(path: string, params: Record<string, string | number | undefined>): string {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    q.push(`access_token=${encodeURIComponent(this.token)}`);
    return `${API}${path}?${q.join('&')}`;
  }

  private static toPlace(f: any): PlaceResult | null {
    const p = f?.properties ?? {};
    const coords = f?.geometry?.coordinates ?? [p.coordinates?.longitude, p.coordinates?.latitude];
    const lng = Number(coords?.[0]), lat = Number(coords?.[1]);
    const name = String(p.name_preferred ?? p.name ?? '');
    // Search Box gives "full_address" for places with a street address and "place_formatted" ("Ikeja, Lagos, Nigeria") for the rest.
    const address = String(p.full_address ?? [p.address, p.place_formatted].filter(Boolean).join(', ') ?? '');
    const id = String(p.mapbox_id ?? f?.id ?? '');
    if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng) || !insideNigeria({ lat, lng })) return null;
    return { id, name, address: address || name, lat, lng, distanceM: null };
  }

  async searchPlaces(query: string, near: LatLng | null): Promise<PlaceResult[]> {
    const common = {
      q: query, country: 'ng', language: 'en', limit: 10,
      proximity: near ? `${near.lng},${near.lat}` : undefined,
    };
    // Search Box finds businesses and landmarks ("KFC", "Computer Village"); the bounding box keeps it inside Nigeria.
    let data: any;
    try {
      data = await callJson(this.http, 'Mapbox', this.url('/search/searchbox/v1/forward', { ...common, bbox: `${NIGERIA.west},${NIGERIA.south},${NIGERIA.east},${NIGERIA.north}` }), 'GET');
    } catch (e) {
      // A token without Search Box access still gets addresses and places from the Geocoding API.
      data = await callJson(this.http, 'Mapbox', this.url('/search/geocode/v6/forward', common), 'GET').catch(() => { throw e; });
    }
    const out = ((data.features ?? []) as any[]).map(MapboxMapProvider.toPlace).filter((p): p is PlaceResult => p !== null);
    return out;
  }

  async reverse(at: LatLng): Promise<string | null> {
    const data = await callJson(this.http, 'Mapbox', this.url('/search/geocode/v6/reverse', { longitude: at.lng, latitude: at.lat, language: 'en', country: 'ng', limit: 1 }), 'GET');
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const text = String(p.full_address ?? [p.name, p.place_formatted].filter(Boolean).join(', ') ?? '').trim();
    return text || null;
  }

  async route(from: LatLng, to: LatLng, steps = false) {
    const path = `/directions/v5/mapbox/driving-traffic/${from.lng},${from.lat};${to.lng},${to.lat}`;
    const data = await callJson(this.http, 'Mapbox', this.url(path, { geometries: 'polyline', overview: 'full', alternatives: 'false', steps: steps ? 'true' : 'false', language: 'en' }), 'GET');
    const r = data.routes?.[0];
    if (!r || !Number.isFinite(Number(r.distance)) || !Number.isFinite(Number(r.duration))) return null;
    const out: { distanceM: number; durationS: number; polyline: string | null; steps?: RouteStep[] } = {
      distanceM: Math.round(Number(r.distance)), durationS: Math.round(Number(r.duration)), polyline: typeof r.geometry === 'string' ? r.geometry : null,
    };
    if (steps) {
      out.steps = ((r.legs?.[0]?.steps ?? []) as any[])
        .map((st): RouteStep => ({
          instruction: String(st.maneuver?.instruction ?? ''), distanceM: Math.round(Number(st.distance) || 0),
          lat: Number(st.maneuver?.location?.[1]), lng: Number(st.maneuver?.location?.[0]),
          type: [st.maneuver?.type, st.maneuver?.modifier].filter(Boolean).join(' '),
        }))
        .filter((st) => st.instruction && Number.isFinite(st.lat) && Number.isFinite(st.lng));
    }
    return out;
  }
}
