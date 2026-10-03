import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { DispatchService } from '../dispatch/dispatch.service';
import { Category, keys } from '../dispatch/dispatch.types';

// Placeholders: the trip distance a driver reports is flagged when it is this much longer than the recorded route.
const TRAIL_MIN_POINTS = Number(process.env.TRAIL_MIN_POINTS ?? 10);
const TRAIL_FLAG_RATIO = Number(process.env.TRAIL_FLAG_RATIO ?? 1.3);
const TRAIL_FLAG_MIN_EXCESS_M = Number(process.env.TRAIL_FLAG_MIN_EXCESS_M ?? 1000);
import { FareService } from '../fare/fare.service';
import { Measured } from '../fare/fare.calc';
import { SettlementService } from '../fare/settlement.service';
import { LedgerService } from '../ledger/ledger.service';
import { Principal } from '../auth/auth.types';


export interface RideInput {
  quoteId: string;
  category: Category;
  paymentMethod: 'cash' | 'wallet';
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
}

const STAFF_ROLES = ['support', 'finance', 'admin'];

@Injectable()
export class RidesService {
  private readonly log = new Logger(RidesService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dispatch: DispatchService,
    private readonly fares: FareService,
    private readonly settlement: SettlementService,
    private readonly ledger: LedgerService,
  ) {}

  quote(riderId: string, category: Category, trip: { distanceM: number; durationS: number }) {
    return this.fares.estimate(riderId, category, trip);
  }

  /**
   * Request a ride. The quote is attached, and for a wallet ride the most the fare could be (top of the quoted
   * range) is held, in the SAME transaction as the ride. If the quote is stale or the wallet is short, no ride is created.
   */
  request(riderId: string, idempotencyKey: string, input: RideInput) {
    return this.dispatch.requestRide(
      {
        riderId,
        idempotencyKey,
        category: input.category,
        paymentMethod: input.paymentMethod,
        pickup: input.pickup,
        dropoff: input.dropoff,
      },
      async (client, rideId) => {
        await this.fares.attachQuote(client, rideId, riderId, input.quoteId);
        if (input.paymentMethod === 'wallet') {
          const { rows } = await client.query(`SELECT high_kobo FROM fare_quotes WHERE id = $1`, [input.quoteId]);
          await this.ledger.holdForRide(client, riderId, rideId, Number(rows[0].high_kobo));
        }
      },
    );
  }

  /** A ride, visible only to its own rider and driver (and staff). Anyone else gets a 404, not a 403, so ids cannot be probed. */
  async get(me: Principal, rideId: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.short_code, r.status, r.payment_status, r.category, r.payment_method, r.rider_id, r.driver_id,
              ST_Y(r.pickup::geometry) AS pickup_lat, ST_X(r.pickup::geometry) AS pickup_lng,
              ST_Y(r.dropoff::geometry) AS dropoff_lat, ST_X(r.dropoff::geometry) AS dropoff_lng,
              r.created_at, r.scheduled_for, r.schedule_id, r.cancel_reason, d.full_name AS driver_name, v.make, v.colour, v.plate
         FROM rides r
         LEFT JOIN users d ON d.id = r.driver_id
         LEFT JOIN vehicles v ON v.driver_id = r.driver_id AND v.active
        WHERE r.id = $1 AND (r.rider_id = $2 OR r.driver_id = $2 OR $3::boolean)`,
      [rideId, me.id, STAFF_ROLES.includes(me.role)],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('ride not found');
    return {
      id: r.id,
      shortCode: r.short_code,
      status: r.status,
      paymentStatus: r.payment_status,
      category: r.category,
      paymentMethod: r.payment_method,
      pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
      dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng },
      createdAt: r.created_at,
      scheduledFor: r.scheduled_for,
      scheduleId: r.schedule_id,
      cancelReason: r.cancel_reason,
      driver: r.driver_id ? { name: r.driver_name, vehicle: { make: r.make, colour: r.colour, plate: r.plate } } : null,
    };
  }

  async receipt(me: Principal, rideId: string) {
    await this.get(me, rideId); // same visibility rule
    const fare = await this.fares.getReceipt(rideId);
    if (!fare) throw new NotFoundException('no receipt yet: the trip has not been completed');
    return fare;
  }

  // ------------------------------------------------------------------ driver side

  accept(driverId: string, rideId: string) {
    return this.dispatch.acceptOffer(rideId, driverId);
  }

  decline(driverId: string, rideId: string) {
    return this.dispatch.declineOffer(rideId, driverId);
  }

  /** DRIVER_ASSIGNED -> DRIVER_ARRIVED, or DRIVER_ARRIVED -> TRIP_STARTED. Only the assigned driver can do it. */
  async advanceTrip(driverId: string, rideId: string, from: 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVED', to: 'DRIVER_ARRIVED' | 'TRIP_STARTED') {
    await this.ledger.withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE rides SET status = $4, updated_at = now() WHERE id = $1 AND driver_id = $2 AND status = $3`,
        [rideId, driverId, from, to],
      );
      if (!res.rowCount) {
        const { rows } = await client.query(`SELECT status FROM rides WHERE id = $1 AND driver_id = $2`, [rideId, driverId]);
        if (!rows[0]) throw new NotFoundException('ride not found');
        if (rows[0].status === to) return; // a retry of the same tap
        throw new ConflictException({ code: 'wrong_state', message: `ride is ${rows[0].status}, expected ${from}` });
      }
      await client.query(
        `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id) VALUES ($1, $2, $3, $4)`,
        [rideId, from, to, driverId],
      );
    });
  }

  /**
   * Finish the trip and settle the money. The distance and time come from the driver app: there is no server-side
   * trip tracking yet, so the quote range check (outside_quote_range) is the only guard against an inflated fare.
   */
  async complete(driverId: string, rideId: string, measured: Measured) {
    const { rows } = await this.pool.query(`SELECT 1 FROM rides WHERE id = $1 AND driver_id = $2`, [rideId, driverId]);
    if (!rows[0]) throw new NotFoundException('ride not found');
    const fare = await this.settlement.settleCompletedTrip(rideId, measured);
    // Free the driver for matching again; their next ping puts them back on the map.
    await this.redis.del(keys.driverState(driverId), keys.driverRide(driverId));
    // The money is settled; a failure here must never undo or hide that, so it is logged, not thrown.
    await this.checkTripDistance(rideId, driverId, measured.distanceM).catch((e) => this.log.error(`distance check failed for ${rideId}: ${e}`));
    return fare;
  }

  /**
   * Phone clocks are not the server clock, so the window is padded by 30 s before the start and 60 s after the end
   * (a driver waiting at the pickup adds almost no distance).
   * Compare the distance the driver reported with the route their phone actually recorded since the trip started.
   * Only a reported distance well ABOVE the route is suspicious (it raises the fare); GPS jitter makes the route a bit
   * long, never short. A flag does not change the fare: it puts the ride in front of staff.
   */
  private async checkTripDistance(rideId: string, driverId: string, claimedM: number): Promise<void> {
    const { rows } = await this.pool.query(
      `WITH started AS (
         SELECT created_at AS t0 FROM ride_status_history WHERE ride_id = $1 AND to_status = 'TRIP_STARTED' ORDER BY id DESC LIMIT 1
       )
       SELECT count(*)::int AS n,
              ST_Length(ST_MakeLine(p.location::geometry ORDER BY p.recorded_at)::geography)::float8 AS len
         FROM driver_location_points p, started
        WHERE p.driver_id = $2 AND p.recorded_at >= started.t0 - interval '30 seconds' AND p.recorded_at <= now() + interval '60 seconds'
          AND (p.accuracy_m IS NULL OR p.accuracy_m <= 50)`,
      [rideId, driverId],
    );
    const points: number = rows[0].n;
    const trailM: number | null = points >= 2 && rows[0].len != null ? Math.round(rows[0].len) : null;
    const flagged =
      points >= TRAIL_MIN_POINTS && trailM !== null && claimedM > trailM * TRAIL_FLAG_RATIO && claimedM - trailM >= TRAIL_FLAG_MIN_EXCESS_M;
    await this.pool.query(
      `INSERT INTO trip_distance_checks (ride_id, claimed_m, trail_m, trail_points, flagged) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ride_id) DO NOTHING`,
      [rideId, claimedM, trailM, points, flagged],
    );
    if (flagged) this.log.warn(`ride ${rideId}: driver reported ${claimedM} m but the recorded route is ${trailM} m`);
  }

  async flaggedTrips(onlyOpen = true) {
    const { rows } = await this.pool.query(
      `SELECT c.ride_id, c.claimed_m, c.trail_m, c.trail_points, c.flagged, c.reviewed_by, c.reviewed_at, c.created_at, f.total_kobo
         FROM trip_distance_checks c JOIN ride_fares f ON f.ride_id = c.ride_id
        WHERE c.flagged AND ($1::boolean = false OR c.reviewed_at IS NULL) ORDER BY c.created_at DESC LIMIT 200`,
      [onlyOpen],
    );
    return rows.map((r) => ({
      rideId: r.ride_id, claimedM: r.claimed_m, trailM: r.trail_m, trailPoints: r.trail_points, fareKobo: Number(r.total_kobo),
      reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, createdAt: r.created_at,
    }));
  }

  async reviewTrip(rideId: string, staffId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE trip_distance_checks SET reviewed_by = $2, reviewed_at = now() WHERE ride_id = $1 AND flagged AND reviewed_at IS NULL`,
      [rideId, staffId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ------------------------------------------------------------------ cancellation

  /**
   * Rider cancels before the trip starts: a scheduled, searching, assigned or arrived ride. Releases the wallet hold,
   * withdraws any open offer and frees the driver. Repeating the call is harmless. No cancellation fee yet (a policy
   * decision), so a rider can cancel freely until the trip starts.
   */
  async cancelByRider(riderId: string, rideId: string, reason?: string): Promise<{ cancelled: boolean }> {
    const outcome = await this.ledger.withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT status, driver_id FROM rides WHERE id = $1 AND rider_id = $2 FOR UPDATE`, [rideId, riderId]);
      const ride = rows[0];
      if (!ride) throw new NotFoundException('ride not found');
      if (ride.status === 'CANCELLED_BY_RIDER') return null; // a retried tap
      if (!['SCHEDULED', 'REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED'].includes(ride.status)) {
        throw new ConflictException({ code: 'wrong_state', message: `a ride that is ${ride.status} cannot be cancelled` });
      }
      await client.query(
        `UPDATE rides SET status = 'CANCELLED_BY_RIDER', cancel_reason = $2, updated_at = now(),
                payment_status = CASE WHEN payment_status = 'HELD' THEN 'UNPAID' ELSE payment_status END
          WHERE id = $1`,
        [rideId, reason ?? null],
      );
      await client.query(
        `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, reason) VALUES ($1, $2, 'CANCELLED_BY_RIDER', $3, $4)`,
        [rideId, ride.status, riderId, reason ?? null],
      );
      await this.ledger.releaseHold(client, rideId);
      const offers = await client.query(
        `UPDATE ride_offers SET status = 'EXPIRED', responded_at = now() WHERE ride_id = $1 AND status = 'OFFERED' RETURNING driver_id`,
        [rideId],
      );
      return { driverId: ride.driver_id as string | null, offeredTo: offers.rows.map((o) => o.driver_id as string) };
    });
    if (!outcome) return { cancelled: false };

    // Redis is cleaned up after the commit: a leftover key only costs a driver a few seconds of not seeing offers.
    await this.redis.del(keys.rideOffer(rideId), ...outcome.offeredTo.map((d) => keys.driverOffer(d)));
    if (outcome.driverId) await this.redis.del(keys.driverState(outcome.driverId), keys.driverRide(outcome.driverId));
    return { cancelled: true };
  }
}
