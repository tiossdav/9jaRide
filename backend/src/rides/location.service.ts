import { ConflictException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { DispatchService } from '../dispatch/dispatch.service';
import { Category, keys } from '../dispatch/dispatch.types';

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

@Injectable()
export class LocationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dispatch: DispatchService,
  ) {}

  /** The category comes from the driver's approved, active vehicle, never from the request. */
  async driverCategory(driverId: string): Promise<Category> {
    const cacheKey = `driver:${driverId}:category`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached as Category;
    const { rows } = await this.pool.query(
      `SELECT v.category FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE v.driver_id = $1 AND v.active AND u.status = 'active'`,
      [driverId],
    );
    if (!rows[0]) throw new ConflictException({ code: 'no_active_vehicle', message: 'you need an approved vehicle and an active account to go online' });
    await this.redis.set(cacheKey, rows[0].category, 'EX', CATEGORY_CACHE_SECONDS);
    return rows[0].category;
  }

  /**
   * Take a batch of readings from the driver app: one fresh point from the foreground, or many from the offline queue
   * after the phone reconnected. Safe to upload twice. Spoofed positions are dropped. While the driver is on a trip
   * every accepted reading is also kept, so the distance they report at the end can be checked against the route.
   */
  async ingest(driverId: string, points: LocationPoint[]): Promise<IngestResult> {
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

    if (await this.redis.exists(keys.driverRide(driverId))) {
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
