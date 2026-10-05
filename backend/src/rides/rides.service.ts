import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { DispatchService } from '../dispatch/dispatch.service';
import { TrackingService } from './tracking.service';
import { Category, keys } from '../dispatch/dispatch.types';
import { PromoService } from '../promo/promo.service';
import { SettingsService } from '../settings/settings.service';
import { splitFare } from '../ledger/postings';

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
  pickupAddress?: string;
  dropoffAddress?: string;
  /** A promo code the rider typed. Checked again here, inside the transaction, so a code cannot be over-used. */
  promoCode?: string;
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
    private readonly promo: PromoService,
    private readonly settings: SettingsService,
    private readonly tracking: TrackingService,
  ) {}

  async checkPromo(riderId: string, code: string, category: Category, trip: { distanceM: number; durationS: number }) {
    const estimate = await this.fares.preview(category, trip);
    const { promo, discountKobo } = await this.promo.check(this.pool, riderId, code, category, estimate.expectedKobo);
    return { code: promo.code, description: promo.description, discountKobo, expectedKobo: estimate.expectedKobo, payKobo: estimate.expectedKobo - discountKobo };
  }

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
        pickupAddress: input.pickupAddress,
        dropoffAddress: input.dropoffAddress,
      },
      async (client, rideId) => {
        await this.fares.attachQuote(client, rideId, riderId, input.quoteId);
        if (input.paymentMethod === 'wallet') {
          const { rows } = await client.query(`SELECT high_kobo FROM fare_quotes WHERE id = $1`, [input.quoteId]);
          await this.ledger.holdForRide(client, riderId, rideId, Number(rows[0].high_kobo));
        }
        if (input.promoCode?.trim()) {
          const q = await client.query(`SELECT expected_kobo FROM fare_quotes WHERE id = $1`, [input.quoteId]);
          await this.promo.reserve(client, rideId, riderId, input.promoCode, input.category, Number(q.rows[0].expected_kobo));
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
              r.created_at, r.scheduled_for, r.schedule_id, r.cancel_reason, r.pickup_address, r.dropoff_address, d.full_name AS driver_name, v.make, v.colour, v.plate,
              d.phone AS driver_phone,
              (SELECT round(avg(x.stars)::numeric, 1) FROM ride_ratings x JOIN rides xr ON xr.id = x.ride_id WHERE x.direction = 'rider_to_driver' AND xr.driver_id = r.driver_id) AS driver_rating,
              (SELECT h.created_at FROM ride_status_history h WHERE h.ride_id = r.id ORDER BY h.id DESC LIMIT 1) AS status_changed_at,
              q.low_kobo, q.high_kobo, f.total_kobo, r.promo_discount_kobo, pc.code AS promo_code, f.distance_m AS fare_distance_m, f.duration_s AS fare_duration_s, rr.stars AS my_stars
         FROM rides r
         LEFT JOIN users d ON d.id = r.driver_id
         LEFT JOIN vehicles v ON v.driver_id = r.driver_id AND v.active
         LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id
         LEFT JOIN ride_fares f ON f.ride_id = r.id
         LEFT JOIN promo_codes pc ON pc.id = r.promo_code_id
         LEFT JOIN ride_ratings rr ON rr.ride_id = r.id AND rr.direction = 'rider_to_driver'
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
      pickupAddress: r.pickup_address,
      dropoffAddress: r.dropoff_address,
      estimate: r.low_kobo == null ? null : { lowKobo: Number(r.low_kobo), highKobo: Number(r.high_kobo) },
      fareKobo: r.total_kobo == null ? null : Number(r.total_kobo),
      // What the rider actually pays: the fare less any promo code. Same as fareKobo when there is none.
      discountKobo: r.promo_discount_kobo == null ? 0 : Number(r.promo_discount_kobo),
      promoCode: r.promo_code ?? null,
      payableKobo: r.total_kobo == null ? null : Number(r.total_kobo) - (r.promo_discount_kobo == null ? 0 : Number(r.promo_discount_kobo)),
      distanceM: r.fare_distance_m ?? null,
      durationS: r.fare_duration_s ?? null,
      myRating: r.my_stars ?? null,
      // distance the driver really drove (from GPS), apart for the way to the pickup and the trip; final once the trip is done
      tracking: await this.tracking.progress(r.id),
      scheduledFor: r.scheduled_for,
      scheduleId: r.schedule_id,
      cancelReason: r.cancel_reason,
      statusChangedAt: r.status_changed_at,
      // The driver's number is shared with the rider only while the trip is live, so they can find each other.
      driver: r.driver_id
        ? {
            name: r.driver_name,
            rating: r.driver_rating == null ? null : Number(r.driver_rating),
            phone: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED'].includes(r.status) && r.rider_id === me.id ? r.driver_phone : null,
            vehicle: { make: r.make, colour: r.colour, plate: r.plate },
          }
        : null,
    };
  }

  /** Where the rider's driver is right now, from the live position the driver app sends. Null when there is none to show. */
  async driverPosition(me: Principal, rideId: string) {
    const { rows } = await this.pool.query(
      `SELECT driver_id, status FROM rides WHERE id = $1 AND rider_id = $2`,
      [rideId, me.id],
    );
    const ride = rows[0];
    if (!ride) throw new NotFoundException('ride not found');
    if (!ride.driver_id || !['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED'].includes(ride.status)) return null;
    const state = await this.redis.hgetall(keys.driverState(ride.driver_id));
    if (!state.lat || !state.lng) return null;
    return { lat: Number(state.lat), lng: Number(state.lng), at: Number(state.at), ...(await this.tracking.progress(rideId)) };
  }

  /** The rider's rides, newest first. `scope=active` is the ones still in progress; `history` is everything else. */
  async listForRider(riderId: string, scope: 'active' | 'history', limit = 50) {
    const active = "('SCHEDULED','REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVED','TRIP_STARTED')";
    const { rows } = await this.pool.query(
      `SELECT r.id, r.short_code, r.status, r.payment_method, r.category, r.created_at, r.scheduled_for, r.schedule_id,
              r.pickup_address, r.dropoff_address, f.total_kobo, q.low_kobo, q.high_kobo,
              ST_Y(r.dropoff::geometry) AS dlat, ST_X(r.dropoff::geometry) AS dlng
         FROM rides r
         LEFT JOIN ride_fares f ON f.ride_id = r.id
         LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id
        WHERE r.rider_id = $1 AND (r.status IN ${active}) = $2
        ORDER BY COALESCE(r.scheduled_for, r.created_at) ${scope === 'active' ? 'ASC' : 'DESC'}
        LIMIT $3`,
      [riderId, scope === 'active', limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      shortCode: r.short_code as string,
      status: r.status as string,
      paymentMethod: r.payment_method as string,
      category: r.category as string,
      createdAt: r.created_at as Date,
      scheduledFor: r.scheduled_for as Date | null,
      scheduleId: r.schedule_id as string | null,
      pickupAddress: r.pickup_address as string | null,
      dropoffAddress: r.dropoff_address as string | null,
      dropoff: r.dlat == null ? null : { lat: Number(r.dlat), lng: Number(r.dlng) },
      fareKobo: r.total_kobo == null ? null : Number(r.total_kobo),
      estimate: r.low_kobo == null ? null : { lowKobo: Number(r.low_kobo), highKobo: Number(r.high_kobo) },
    }));
  }

  /** The ride the rider is in right now, so the app can pick it back up after being closed. SCHEDULED rides do not count. */
  async activeForRider(riderId: string) {
    const { rows } = await this.pool.query(
      `SELECT id FROM rides WHERE rider_id = $1 AND status IN ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVED','TRIP_STARTED')
        ORDER BY created_at DESC LIMIT 1`,
      [riderId],
    );
    return rows[0] ? { rideId: rows[0].id as string } : { rideId: null };
  }

  /** One rating per completed ride per side: the rider rates the driver, the driver rates the rider. */
  async rate(me: { id: string; role: string }, rideId: string, stars: number, tags: string[], comment?: string): Promise<{ saved: boolean }> {
    const asRider = me.role === 'rider';
    const ride = await this.pool.query(
      `SELECT status, rider_id, driver_id FROM rides WHERE id = $1 AND ${asRider ? 'rider_id' : 'driver_id'} = $2`, [rideId, me.id]);
    if (!ride.rows[0]) throw new NotFoundException('ride not found');
    if (ride.rows[0].status !== 'TRIP_COMPLETED') throw new ConflictException({ code: 'wrong_state', message: 'only a finished trip can be rated' });
    const text = comment?.trim() ? comment.trim().slice(0, 500) : null;
    const res = await this.pool.query(
      `INSERT INTO ride_ratings (ride_id, rater_id, ratee_id, direction, stars, tags, comment) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ride_id, direction) DO NOTHING`,
      [rideId, me.id, asRider ? ride.rows[0].driver_id : ride.rows[0].rider_id, asRider ? 'rider_to_driver' : 'driver_to_rider', stars, tags, text],
    );
    return { saved: (res.rowCount ?? 0) > 0 };
  }

  async receipt(me: Principal, rideId: string) {
    const ride = await this.get(me, rideId); // same visibility rule
    const fare = await this.fares.getReceipt(rideId);
    if (!fare) throw new NotFoundException('no receipt yet: the trip has not been completed');
    return { ...fare, promoCode: ride.promoCode, discountKobo: ride.discountKobo, payableKobo: fare.totalKobo - ride.discountKobo };
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
    await this.tracking.finish(rideId).catch((e) => this.log.error(`could not close tracking for ${rideId}: ${e}`));
    const earnings = await this.driverEarnings(rideId, fare.totalKobo, fare.taxKobo);
    // Free the driver for matching again; their next ping puts them back on the map.
    await this.redis.del(keys.driverState(driverId), keys.driverRide(driverId));
    // The money is settled; a failure here must never undo or hide that, so it is logged, not thrown.
    await this.checkTripDistance(rideId, driverId, measured.distanceM).catch((e) => this.log.error(`distance check failed for ${rideId}: ${e}`));
    return { ...fare, ...earnings };
  }

  /** What the driver keeps from a fare and what the platform takes, by the rules in force when the ride was booked. */
  private async driverEarnings(rideId: string, totalKobo: number, taxKobo: number) {
    const { rows } = await this.pool.query(`SELECT created_at, COALESCE(promo_discount_kobo, 0)::bigint AS discount FROM rides WHERE id = $1`, [rideId]);
    const rules = await this.settings.effective('revenue', rows[0].created_at);
    const { commission, driverShare } = splitFare(totalKobo, taxKobo, rules.commissionBps, rules.taxBase === 'included');
    // what came off for a vehicle the driver is paying toward, so the app can show what is left
    const owed = (await this.pool.query(`SELECT amount_kobo FROM vehicle_deductions WHERE ride_id = $1`, [rideId])).rows[0];
    const vehicleKobo = owed ? Number(owed.amount_kobo) : 0;
    return { commissionKobo: commission, driverEarnKobo: driverShare, discountKobo: Number(rows[0].discount), vehicleDeductionKobo: vehicleKobo, driverKeepsKobo: driverShare - vehicleKobo };
  }

  // ------------------------------------------------------------------ what the driver app shows

  /** Holds until a ride's status is no longer [was], or the time is up. True when it changed. Checks once a second, cheaply. */
  async waitForStatusChange(rideId: string, was: string, seconds: number): Promise<boolean> {
    const until = Date.now() + Math.min(seconds, 25) * 1000;
    while (Date.now() < until) {
      const { rows } = await this.pool.query(`SELECT status FROM rides WHERE id = $1`, [rideId]);
      if (!rows[0] || rows[0].status !== was) return true;
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(0, until - Date.now()))));
    }
    return false;
  }

  /** The driver's offer, as soon as there is one, or null once [seconds] have passed. Looks at the cache twice a second. */
  async waitForDriverOffer(driverId: string, seconds: number) {
    const until = Date.now() + Math.min(seconds, 25) * 1000;
    for (;;) {
      const offer = await this.driverOffer(driverId);
      if (offer || Date.now() >= until) return offer;
      await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, until - Date.now()))));
    }
  }

  /** The offer waiting for this driver, if any: where to, how far, what it pays, and how long is left. */
  async driverOffer(driverId: string) {
    const rideId = await this.redis.get(keys.driverOffer(driverId));
    if (!rideId) return null;
    const ttl = await this.redis.ttl(keys.driverOffer(driverId));
    const state = await this.redis.hgetall(keys.driverState(driverId));
    const { rows } = await this.pool.query(
      `SELECT r.id, r.short_code, r.status, r.category, r.payment_method, r.pickup_address, r.dropoff_address, u.full_name AS rider_name,
              ST_Y(r.pickup::geometry) AS plat, ST_X(r.pickup::geometry) AS plng, ST_Y(r.dropoff::geometry) AS dlat, ST_X(r.dropoff::geometry) AS dlng,
              q.expected_kobo, q.low_kobo, q.high_kobo, a.label AS category_label,
              (SELECT round(avg(x.stars)::numeric, 1)::float8 FROM ride_ratings x WHERE x.direction = 'driver_to_rider' AND x.ratee_id = r.rider_id) AS rider_rating
         FROM rides r JOIN users u ON u.id = r.rider_id LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id LEFT JOIN asset_types a ON a.code = r.category
        WHERE r.id = $1 AND r.status = 'SEARCHING_DRIVER'`, [rideId],
    );
    const r = rows[0];
    if (!r) return null;
    const from = state.lat && state.lng ? { lat: Number(state.lat), lng: Number(state.lng) } : null;
    const km = from ? haversineKm(from, { lat: r.plat, lng: r.plng }) : null;
    return {
      rideId: r.id, code: r.short_code, secondsLeft: Math.max(0, ttl), category: r.category_label ?? r.category, paymentMethod: r.payment_method,
      pickup: { lat: r.plat, lng: r.plng, address: r.pickup_address }, dropoff: { lat: r.dlat, lng: r.dlng, address: r.dropoff_address },
      pickupKm: km == null ? null : Math.round(km * 10) / 10, estimate: r.expected_kobo == null ? null : { expectedKobo: Number(r.expected_kobo), lowKobo: Number(r.low_kobo), highKobo: Number(r.high_kobo) },
      rider: { name: String(r.rider_name).split(' ')[0], rating: r.rider_rating },
    };
  }

  /** The ride this driver is on right now (so the app can pick up where it left off), or null. */
  async driverActiveRide(driverId: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.short_code, r.status, r.category, r.payment_method, r.pickup_address, r.dropoff_address, u.full_name AS rider_name, u.phone AS rider_phone,
              ST_Y(r.pickup::geometry) AS plat, ST_X(r.pickup::geometry) AS plng, ST_Y(r.dropoff::geometry) AS dlat, ST_X(r.dropoff::geometry) AS dlng,
              q.expected_kobo, a.label AS category_label
         FROM rides r JOIN users u ON u.id = r.rider_id LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id LEFT JOIN asset_types a ON a.code = r.category
        WHERE r.driver_id = $1 AND r.status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED') ORDER BY r.updated_at DESC LIMIT 1`, [driverId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      rideId: r.id, code: r.short_code, status: r.status, category: r.category_label ?? r.category, paymentMethod: r.payment_method,
      pickup: { lat: r.plat, lng: r.plng, address: r.pickup_address }, dropoff: { lat: r.dlat, lng: r.dlng, address: r.dropoff_address },
      expectedKobo: r.expected_kobo == null ? null : Number(r.expected_kobo), rider: { name: String(r.rider_name).split(' ')[0], phone: r.rider_phone },
      tracking: await this.tracking.progress(r.id),
    };
  }

  /**
   * The driver gives up a ride they accepted (before the trip starts). The rider is told it was cancelled by the driver;
   * frequent cancelling counts in the Cancellation Policy.
   */
  async cancelByDriver(driverId: string, rideId: string, reason?: string): Promise<{ cancelled: boolean }> {
    const outcome = await this.ledger.withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT status FROM rides WHERE id = $1 AND driver_id = $2 FOR UPDATE`, [rideId, driverId]);
      const ride = rows[0];
      if (!ride) throw new NotFoundException('ride not found');
      if (ride.status === 'CANCELLED_BY_DRIVER') return false; // a retried tap
      if (!['DRIVER_ASSIGNED', 'DRIVER_ARRIVED'].includes(ride.status)) throw new ConflictException({ code: 'wrong_state', message: `a ride that is ${ride.status} cannot be cancelled` });
      await client.query(`UPDATE rides SET status = 'CANCELLED_BY_DRIVER', cancel_reason = $2, updated_at = now(), payment_status = CASE WHEN payment_status = 'HELD' THEN 'UNPAID' ELSE payment_status END WHERE id = $1`, [rideId, reason ?? null]);
      await client.query(`INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, reason) VALUES ($1, $2, 'CANCELLED_BY_DRIVER', $3, $4)`, [rideId, ride.status, driverId, reason ?? null]);
      await this.ledger.releaseHold(client, rideId);
      return true;
    });
    if (outcome) await this.redis.del(keys.driverState(driverId), keys.driverRide(driverId));
    return { cancelled: outcome };
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

/** Straight-line distance in km between two points. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
