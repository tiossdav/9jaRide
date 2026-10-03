import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import {
  AcceptResult,
  DRIVER_STATE_TTL_SECONDS,
  DriverPing,
  OFFER_NOTIFIER,
  OFFER_TIMEOUT_SECONDS,
  OfferNotifier,
  RideRequest,
  SEARCH_RADII_KM,
  SEARCH_WINDOW_SECONDS,
  keys,
} from './dispatch.types';

const ACCEPT_LOCK_MS = 10_000;
const ADVANCE_LOCK_MS = 5_000;
const CANDIDATES_PER_RADIUS = 20;
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class DispatchService {
  private readonly log = new Logger(DispatchService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OFFER_NOTIFIER) private readonly notifier: OfferNotifier,
  ) {}

  // ------------------------------------------------------------------ driver presence

  /**
   * Called for every driver GPS ping. Live position lives in Redis only; Postgres never sees this write.
   * The state hash expires after 20 s, so a driver who stops pinging drops out of matching on their own.
   */
  async recordPing(ping: DriverPing): Promise<void> {
    if (ping.mockLocation) return; // spoofed positions never enter matching
    const stateKey = keys.driverState(ping.driverId);
    // A driver on a trip keeps pinging; that must not put them back into matching.
    const status = (await this.redis.hget(stateKey, 'status')) === 'on_trip' ? 'on_trip' : 'available';
    await this.redis
      .multi()
      .geoadd(keys.geo(ping.category), ping.lng, ping.lat, ping.driverId)
      .hset(stateKey, {
        status,
        category: ping.category,
        score: String(ping.score ?? 1),
        lat: String(ping.lat),
        lng: String(ping.lng),
        at: String(Date.now()),
      })
      .expire(stateKey, DRIVER_STATE_TTL_SECONDS)
      .exec();
  }

  /** A busy flag for fare estimates: a category is busy when no driver is available inside the largest radius. */
  async isCategoryBusy(category: RideRequest['category'], lat: number, lng: number): Promise<boolean> {
    const maxRadius = Math.max(...SEARCH_RADII_KM);
    const found = await this.findCandidates(category, lat, lng, maxRadius, new Set());
    return found.length === 0;
  }

  // ------------------------------------------------------------------ requesting

  /** Idempotent: the same (rider, key) always returns the same ride, so a retry never creates a second one. */
  async requestRide(
    req: RideRequest,
    /** Runs in the same transaction for a NEW ride (attach the fare quote, hold wallet money). If it throws, no ride is created. */
    inTransaction?: (client: PoolClient, rideId: string) => Promise<void>,
  ): Promise<{ rideId: string; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO rides (short_code, rider_id, category, payment_method, pickup, dropoff, idempotency_key)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9)
         ON CONFLICT (rider_id, idempotency_key) DO NOTHING RETURNING id`,
        [
          this.shortCode(), req.riderId, req.category, req.paymentMethod,
          req.pickup.lng, req.pickup.lat, req.dropoff.lng, req.dropoff.lat, req.idempotencyKey,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        const existing = await this.pool.query('SELECT id FROM rides WHERE rider_id = $1 AND idempotency_key = $2', [
          req.riderId, req.idempotencyKey,
        ]);
        return { rideId: existing.rows[0].id, created: false };
      }
      const rideId = inserted.rows[0].id as string;
      await client.query(`INSERT INTO ride_status_history (ride_id, to_status, actor_id) VALUES ($1, 'REQUESTED', $2)`, [rideId, req.riderId]);
      await client.query(
        `UPDATE rides SET status = 'SEARCHING_DRIVER', search_started_at = now(), updated_at = now() WHERE id = $1 AND status = 'REQUESTED'`,
        [rideId],
      );
      await client.query(
        `INSERT INTO ride_status_history (ride_id, from_status, to_status) VALUES ($1, 'REQUESTED', 'SEARCHING_DRIVER')`,
        [rideId],
      );
      if (inTransaction) await inTransaction(client, rideId);
      await client.query('COMMIT');
      // Fire-and-forget is safe: if this fails, the sweeper picks the ride up within one tick.
      this.advance(rideId).catch((e) => this.log.error(`advance failed for ${rideId}: ${e}`));
      return { rideId, created: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------ the dispatch loop

  /**
   * Move a SEARCHING_DRIVER ride one step: end the search, wait on a live offer, or offer to the next driver.
   * Safe to call from anywhere and from any instance: a short Redis lock keeps two callers from double-offering.
   */
  async advance(rideId: string): Promise<void> {
    const lock = await this.redis.set(keys.rideAdvanceLock(rideId), '1', 'PX', ADVANCE_LOCK_MS, 'NX');
    if (!lock) return;
    try {
      const { rows } = await this.pool.query(
        `SELECT id, rider_id, category, status, search_started_at,
                ST_Y(pickup::geometry) AS lat, ST_X(pickup::geometry) AS lng,
                EXTRACT(EPOCH FROM (now() - search_started_at)) AS searched_s
           FROM rides WHERE id = $1`,
        [rideId],
      );
      const ride = rows[0];
      if (!ride || ride.status !== 'SEARCHING_DRIVER') return;

      if (Number(ride.searched_s) >= SEARCH_WINDOW_SECONDS) {
        await this.endSearch(ride.id, ride.rider_id);
        return;
      }

      const open = await this.pool.query(
        `SELECT 1 FROM ride_offers WHERE ride_id = $1 AND status = 'OFFERED' AND expires_at > now()`,
        [rideId],
      );
      if (open.rowCount) return; // someone is still deciding

      const tried = await this.pool.query(`SELECT driver_id FROM ride_offers WHERE ride_id = $1`, [rideId]);
      const exclude = new Set<string>(tried.rows.map((r) => r.driver_id));

      // Widen 3 km -> 5 km -> 8 km until somebody is found.
      for (const radius of SEARCH_RADII_KM) {
        const candidates = await this.findCandidates(ride.category, Number(ride.lat), Number(ride.lng), radius, exclude);
        for (const c of candidates) {
          if (await this.offerTo(ride.id, c.driverId, c.distanceKm)) return;
        }
      }
      // Nobody free right now: leave it SEARCHING_DRIVER; the next sweeper tick retries until the window closes.
    } finally {
      await this.redis.del(keys.rideAdvanceLock(rideId));
    }
  }

  /** Candidate drivers near a point, ranked by distance weighted by driver score. Stale members are pruned as found. */
  async findCandidates(
    category: RideRequest['category'],
    lat: number,
    lng: number,
    radiusKm: number,
    exclude: Set<string>,
  ): Promise<{ driverId: string; distanceKm: number; rank: number }[]> {
    const raw = (await this.redis.geosearch(
      keys.geo(category), 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', CANDIDATES_PER_RADIUS, 'WITHDIST',
    )) as [string, string][];

    const out: { driverId: string; distanceKm: number; rank: number }[] = [];
    for (const [driverId, dist] of raw) {
      if (exclude.has(driverId)) continue;
      const state = await this.redis.hgetall(keys.driverState(driverId));
      if (!state.status) {
        // No recent ping: the state hash expired, so this geo member is stale.
        await this.redis.zrem(keys.geo(category), driverId);
        continue;
      }
      if (state.status !== 'available') continue;
      const distanceKm = Number(dist);
      const score = Number(state.score ?? 1);
      out.push({ driverId, distanceKm, rank: distanceKm * (2 - score) });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }

  /**
   * Offer a ride to one driver. A driver can hold only one open offer (SET NX), so one driver is never
   * offered two rides at once. Returns false when the driver was taken by another ride in the meantime.
   */
  private async offerTo(rideId: string, driverId: string, distanceKm: number): Promise<boolean> {
    const claimed = await this.redis.set(keys.driverOffer(driverId), rideId, 'EX', OFFER_TIMEOUT_SECONDS, 'NX');
    if (!claimed) return false;

    const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000);
    let offerId: string;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ride_offers (ride_id, driver_id, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (ride_id, driver_id) DO NOTHING RETURNING id`,
        [rideId, driverId, expiresAt],
      );
      if (!rows[0]) {
        await this.redis.del(keys.driverOffer(driverId));
        return false;
      }
      offerId = rows[0].id;
      await this.redis.set(keys.rideOffer(rideId), driverId, 'EX', OFFER_TIMEOUT_SECONDS);
    } catch (e) {
      await this.redis.del(keys.driverOffer(driverId));
      throw e;
    }
    await this.notifier.sendOffer(driverId, { rideId, offerId, expiresAt, pickupDistanceKm: distanceKm });
    return true;
  }

  // ------------------------------------------------------------------ accept / decline

  /**
   * The atomic accept step. Two parts that must BOTH succeed:
   *   1. a Redis SET NX lock on the ride blocks competing accepts;
   *   2. one conditional Postgres UPDATE assigns the driver only if the ride is still SEARCHING_DRIVER.
   * If the UPDATE touches zero rows, the accept loses. Correctness never depends on timing.
   */
  async acceptOffer(rideId: string, driverId: string): Promise<AcceptResult> {
    const offeredTo = await this.redis.get(keys.rideOffer(rideId));
    if (!offeredTo) return { ok: false, reason: 'offer_expired' };
    if (offeredTo !== driverId) return { ok: false, reason: 'not_offered_to_you' };

    const lockKey = keys.rideAcceptLock(rideId);
    const locked = await this.redis.set(lockKey, driverId, 'PX', ACCEPT_LOCK_MS, 'NX');
    if (!locked) return { ok: false, reason: 'ride_taken' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const assigned = await client.query(
        `UPDATE rides SET driver_id = $1, status = 'DRIVER_ASSIGNED', updated_at = now()
          WHERE id = $2 AND status = 'SEARCHING_DRIVER' RETURNING rider_id`,
        [driverId, rideId],
      );
      if (assigned.rowCount === 0) {
        await client.query('ROLLBACK');
        await this.redis.del(lockKey);
        return { ok: false, reason: 'ride_taken' };
      }
      await client.query(
        `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id) VALUES ($1, 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', $2)`,
        [rideId, driverId],
      );
      // Only a still-open offer for this driver can be accepted (blocks accepting after the sweeper expired it).
      const offer = await client.query(
        `UPDATE ride_offers SET status = 'ACCEPTED', responded_at = now()
          WHERE ride_id = $1 AND driver_id = $2 AND status = 'OFFERED' AND expires_at > now()`,
        [rideId, driverId],
      );
      if (offer.rowCount === 0) {
        await client.query('ROLLBACK');
        await this.redis.del(lockKey);
        return { ok: false, reason: 'offer_expired' };
      }
      await client.query(`UPDATE ride_offers SET status = 'LOST', responded_at = now() WHERE ride_id = $1 AND status = 'OFFERED'`, [rideId]);
      await client.query('COMMIT');

      // Driver is now on a ride: out of matching until they finish.
      await this.redis.multi().hset(keys.driverState(driverId), 'status', 'on_trip').del(keys.rideOffer(rideId)).del(keys.driverOffer(driverId)).exec();
      await this.notifier.rideAssigned(assigned.rows[0].rider_id, driverId, rideId);
      return { ok: true, rideId };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.redis.del(lockKey);
      // The partial unique index (one active ride per driver) is the database-level guard for double booking.
      if (e?.code === PG_UNIQUE_VIOLATION) return { ok: false, reason: 'driver_busy' };
      throw e;
    } finally {
      client.release();
    }
  }

  async declineOffer(rideId: string, driverId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE ride_offers SET status = 'DECLINED', responded_at = now()
        WHERE ride_id = $1 AND driver_id = $2 AND status = 'OFFERED'`,
      [rideId, driverId],
    );
    if (!res.rowCount) return;
    await this.redis.del(keys.rideOffer(rideId), keys.driverOffer(driverId));
    await this.advance(rideId);
  }

  // ------------------------------------------------------------------ sweeper

  /**
   * Runs every few seconds on the worker. It owns three jobs, all idempotent:
   *   1. expire offers past their 15 s deadline and offer to the next driver;
   *   2. re-queue any SEARCHING_DRIVER ride with no live offer (this is the Redis-restart recovery path);
   *   3. end searches older than 90 s as NO_DRIVER_FOUND (done inside advance()).
   */
  async sweep(): Promise<{ expired: number; advanced: number }> {
    const got = await this.redis.set(keys.sweeperLock, '1', 'PX', 4_000, 'NX');
    if (!got) return { expired: 0, advanced: 0 };

    const expired = await this.pool.query(
      `UPDATE ride_offers SET status = 'EXPIRED', responded_at = now()
        WHERE status = 'OFFERED' AND expires_at <= now() RETURNING ride_id, driver_id`,
    );
    for (const row of expired.rows) await this.redis.del(keys.driverOffer(row.driver_id), keys.rideOffer(row.ride_id));

    const searching = await this.pool.query(`SELECT id FROM rides WHERE status = 'SEARCHING_DRIVER'`);
    await Promise.all(searching.rows.map((r) => this.advance(r.id).catch((e) => this.log.error(`advance ${r.id}: ${e}`))));
    return { expired: expired.rowCount ?? 0, advanced: searching.rowCount ?? 0 };
  }

  private async endSearch(rideId: string, riderId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE rides SET status = 'NO_DRIVER_FOUND', updated_at = now() WHERE id = $1 AND status = 'SEARCHING_DRIVER'`,
      [rideId],
    );
    if (!res.rowCount) return;
    await this.pool.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, reason) VALUES ($1, 'SEARCHING_DRIVER', 'NO_DRIVER_FOUND', 'search window elapsed')`,
      [rideId],
    );
    // No ride, so the reserved wallet money goes back to the rider.
    await this.pool.query(`UPDATE wallet_holds SET status = 'RELEASED' WHERE ride_id = $1 AND status = 'ACTIVE'`, [rideId]);
    await this.notifier.noDriverFound(riderId, rideId);
  }

  private shortCode(): string {
    // Public, unguessable and not derived from a timestamp (spec defect: trip IDs that look like timestamps).
    const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    const bytes = randomBytes(8);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  }
}
