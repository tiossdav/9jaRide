import { ConflictException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { DispatchService } from '../dispatch/dispatch.service';
import { Category, keys } from '../dispatch/dispatch.types';
import { TrackingService } from './tracking.service';

const CATEGORY_CACHE_SECONDS = 300;
/** Only a point this fresh may put a driver on the map. An older one (an offline batch) is history, not presence. */
const LIVE_MAX_AGE_SECONDS = 30;
const MAX_FUTURE_SKEW_SECONDS = 60;
const MAX_AGE_HOURS = 24;
export const MAX_BATCH = 100;

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedKmh?: number;
  mockLocation?: boolean;
  /** When the phone took the reading, not when it was uploaded. An offline queue sends old readings. */
  recordedAt: Date;
}

export interface IngestResult {
  accepted: number;
  rejected: number;
  /** True when the newest point was fresh enough to update the driver's place on the map. */
  live: boolean;
}

/** A phone holds the "online here" claim this long after its last report. */
export const DEVICE_HOLD_SECONDS = 120;

@Injectable()
export class LocationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dispatch: DispatchService,
    private readonly tracking: TrackingService,
  ) {}

  private deviceKey = (driverId: string) => `driver:${driverId}:device`;

  /** Tells the server which phone the driver is online on. The phone that says so last takes over from any other. */
  async claimDevice(driverId: string, deviceId: string): Promise<void> {
    await this.redis.set(this.deviceKey(driverId), deviceId, 'EX', DEVICE_HOLD_SECONDS);
  }

  /** Going offline gives the claim up, but only for the phone that holds it, so an old phone cannot knock a new one off. */
  async releaseDevice(driverId: string, deviceId: string): Promise<void> {
    if ((await this.redis.get(this.deviceKey(driverId))) === deviceId) await this.redis.del(this.deviceKey(driverId));
  }

  /**
   * One phone is online per driver account. A phone that is not the one holding the claim is refused with a clear reason, so the
   * app can say so and go offline, instead of looking online here while the other phone is the one the system sees.
   * Phones that send no device id (older apps) are not checked.
   */
  async assertDevice(driverId: string, deviceId?: string): Promise<void> {
    if (!deviceId) return;
    const holder = await this.redis.get(this.deviceKey(driverId));
    if (holder && holder !== deviceId) {
      throw new ConflictException({ code: 'other_device', message: 'You are online on another phone with this account. Go offline there first, or go online here again to take over.' });
    }
    await this.redis.set(this.deviceKey(driverId), deviceId, 'EX', DEVICE_HOLD_SECONDS); // nobody holds it yet, or it is this phone: keep it
  }

  /** The category comes from the driver's approved, active vehicle, never from the request. */
  async driverCategory(driverId: string): Promise<Category> {
    const cacheKey = `driver:${driverId}:category`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached as Category;
    const { rows } = await this.pool.query(
      `SELECT v.category FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE v.driver_id = $1 AND v.active AND v.suspended_at IS NULL AND u.status = 'active'`,
      [driverId],
    );
    if (!rows[0]) throw new ConflictException({ code: 'no_active_vehicle', message: 'you need an approved, unsuspended vehicle and an active account to go online' });
    // a vehicle someone else owns comes with an arrangement the driver must agree to first
    const pending = await this.pool.query(`SELECT 1 FROM vehicle_assignments WHERE driver_id = $1 AND ended_at IS NULL AND owner_id IS NOT NULL AND agreement_accepted_at IS NULL`, [driverId]);
    if (pending.rowCount) throw new ConflictException({ code: 'agreement_pending', message: 'agree to the vehicle payment arrangement before you go online' });
    await this.redis.set(cacheKey, rows[0].category, 'EX', CATEGORY_CACHE_SECONDS);
    return rows[0].category;
  }

  /**
   * Take a batch of readings from the driver app: one fresh point from the foreground, or many from the offline queue
   * after the phone reconnected. Safe to upload twice. Spoofed positions are dropped. While the driver is on a trip
   * every accepted reading is also kept, so the distance they report at the end can be checked against the route.
   */
  async ingest(driverId: string, points: LocationPoint[], deviceId?: string): Promise<IngestResult> {
    await this.assertDevice(driverId, deviceId);
    const category = await this.driverCategory(driverId);
    const now = Date.now();
    const valid = points
      .filter((p) => !p.mockLocation)
      .filter((p) => {
        const t = p.recordedAt.getTime();
        return Number.isFinite(t) && t <= now + MAX_FUTURE_SKEW_SECONDS * 1000 && t >= now - MAX_AGE_HOURS * 3_600_000;
      })
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    const rejected = points.length - valid.length;
    if (!valid.length) return { accepted: 0, rejected, live: false };

    const newest = valid[valid.length - 1];
    const live = now - newest.recordedAt.getTime() <= LIVE_MAX_AGE_SECONDS * 1000;
    if (live) {
      await this.dispatch.recordPing({ driverId, category, lat: newest.lat, lng: newest.lng, accuracyM: newest.accuracyM, speedKmh: newest.speedKmh });
    }

    const rideId = await this.redis.get(keys.driverRide(driverId));
    if (rideId) {
      // distance driven, kept apart for the way to the pickup and the trip itself
      await this.tracking.record(driverId, rideId, valid.map((p) => ({ lat: p.lat, lng: p.lng, atMs: p.recordedAt.getTime(), accuracyM: p.accuracyM })));
      await this.pool.query(
        `INSERT INTO driver_location_points (driver_id, recorded_at, location, accuracy_m, speed_kmh)
         SELECT $1, t.ts, ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326)::geography, t.acc, t.spd
           FROM unnest($2::timestamptz[], $3::float8[], $4::float8[], $5::real[], $6::real[]) AS t(ts, lat, lng, acc, spd)
         ON CONFLICT (driver_id, recorded_at) DO NOTHING`,
        [
          driverId,
          valid.map((p) => p.recordedAt),
          valid.map((p) => p.lat),
          valid.map((p) => p.lng),
          valid.map((p) => p.accuracyM ?? null),
          valid.map((p) => p.speedKmh ?? null),
        ],
      );
    }
    return { accepted: valid.length, rejected, live };
  }
}
