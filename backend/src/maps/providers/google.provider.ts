import { Fetch, LatLng, MapProvider, PlaceResult, callJson, insideNigeria } from '../maps.types';

const BIAS_RADIUS_M = 50_000; // the most Google allows for a circular bias

/** Google Maps Platform: Places API (New), Geocoding API and Routes API. Needs GOOGLE_MAPS_API_KEY and a billing account. */
export class GoogleMapProvider implements MapProvider {
  readonly name = 'google' as const;
  constructor(private readonly key: string, private readonly http: Fetch) {}

  async searchPlaces(query: string, near: LatLng | null): Promise<PlaceResult[]> {
    const data = await callJson(this.http, 'Google', 'https://places.googleapis.com/v1/places:searchText', 'POST', {
      'X-Goog-Api-Key': this.key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
    }, {
      textQuery: query, regionCode: 'NG', languageCode: 'en', pageSize: 10,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M } } } : {}),
    });
    return (data.places ?? [])
      .map((p: any): PlaceResult => ({
        id: String(p.id), name: String(p.displayName?.text ?? p.formattedAddress ?? ''), address: String(p.formattedAddress ?? ''),
        lat: Number(p.location?.latitude), lng: Number(p.location?.longitude), distanceM: null,
      }))
      .filter((p: PlaceResult) => p.id && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng) && insideNigeria(p));
  }

  async reverse(at: LatLng): Promise<string | null> {
    const data = await callJson(this.http, 'Google', `https://maps.googleapis.com/maps/api/geocode/json?latlng=${at.lat},${at.lng}&language=en&region=ng&key=${encodeURIComponent(this.key)}`, 'GET');
    const best = (data.results ?? []).find((r: any) => !(r.types ?? []).includes('plus_code')) ?? null;
    return best ? String(best.formatted_address) : null;
  }

  async route(from: LatLng, to: LatLng) {
    const data = await callJson(this.http, 'Google', 'https://routes.googleapis.com/directions/v2:computeRoutes', 'POST', {
      'X-Goog-Api-Key': this.key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    }, {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', languageCode: 'en', units: 'METRIC',
    });
    const r = data.routes?.[0];
    const seconds = Number(String(r?.duration ?? '').replace('s', ''));
    if (!r || !Number.isFinite(Number(r.distanceMeters)) || !Number.isFinite(seconds)) return null;
    return { distanceM: Math.round(Number(r.distanceMeters)), durationS: Math.round(seconds), polyline: r.polyline?.encodedPolyline ?? null };
  }
}
