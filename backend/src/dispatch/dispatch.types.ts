/** A ride category's code, such as 'regular'. The list is data an admin manages (asset_types), not a fixed set. */
export type Category = string;

export const OFFER_TIMEOUT_SECONDS = Number(process.env.OFFER_TIMEOUT_SECONDS ?? 15);
export const SEARCH_WINDOW_SECONDS = Number(process.env.SEARCH_WINDOW_SECONDS ?? 90);
export const SEARCH_RADII_KM = (process.env.SEARCH_RADII_KM ?? '3').split(',').map(Number);

// Redis key layout. Redis holds only live positions, locks and short-lived offers (spec: strict Redis/Postgres split).
export const keys = {
  geo: (category: Category) => `drivers:geo:${category}`,
  driverState: (driverId: string) => `driver:${driverId}:state`, // hash, expires DRIVER_STATE_TTL_SECONDS after the last ping
  driverOffer: (driverId: string) => `driver:${driverId}:offer`, // one open offer per driver
  // The ride a driver is on. Unlike driverState it does not expire after 20 s, so a driver who loses signal on a
  // trip is not put back into matching when their pings resume. A long expiry is only a safety net.
  driverRide: (driverId: string) => `driver:${driverId}:ride`,
  rideOffer: (rideId: string) => `ride:${rideId}:offer`, // driver the ride is currently offered to
  rideAcceptLock: (rideId: string) => `lock:ride:${rideId}:accept`,
  rideAdvanceLock: (rideId: string) => `lock:ride:${rideId}:advance`,
  sweeperLock: 'lock:dispatch:sweeper',
};

/** How long a driver counts as online after their last location report. The app reports every 10 s, so this survives a missed report or a slow network. */
export const DRIVER_STATE_TTL_SECONDS = Number(process.env.DRIVER_STATE_TTL_SECONDS ?? 45);

export interface DriverPing {
  driverId: string;
  category: Category;
  lat: number;
  lng: number;
  accuracyM?: number;
  speedKmh?: number;
  mockLocation?: boolean;
  /** 0..1 rolling acceptance/cancellation score; lower ranks the driver lower, never blocks them. */
  score?: number;
}

export interface RideRequest {
  riderId: string;
  idempotencyKey: string;
  category: Category;
  paymentMethod: 'cash' | 'wallet';
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  pickupAddress?: string;
  dropoffAddress?: string;
}

export type AcceptResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: 'offer_expired' | 'not_offered_to_you' | 'ride_taken' | 'driver_busy' };

/** Delivers an offer by WebSocket and high-priority FCM push (the push must work even if the socket is down). */
export interface OfferNotifier {
  sendOffer(driverId: string, offer: { rideId: string; offerId: string; expiresAt: Date; pickupDistanceKm: number }): Promise<void>;
  rideAssigned(riderId: string, driverId: string, rideId: string): Promise<void>;
  noDriverFound(riderId: string, rideId: string): Promise<void>;
}
export const OFFER_NOTIFIER = Symbol('OFFER_NOTIFIER');
