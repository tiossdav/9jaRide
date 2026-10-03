import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { DispatchService } from '../dispatch/dispatch.service';
import { Category, keys } from '../dispatch/dispatch.types';
import { FareService } from '../fare/fare.service';
import { Measured } from '../fare/fare.calc';
import { SettlementService } from '../fare/settlement.service';
import { LedgerService } from '../ledger/ledger.service';
import { Principal } from '../auth/auth.types';

const CATEGORY_CACHE_SECONDS = 300;

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
              r.created_at, d.full_name AS driver_name, v.make, v.colour, v.plate
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

  /** Position ping. The category comes from the driver's active vehicle, never from the request. */
  async ping(driverId: string, p: { lat: number; lng: number; accuracyM?: number; speedKmh?: number; mockLocation?: boolean }) {
    const category = await this.driverCategory(driverId);
    await this.dispatch.recordPing({ driverId, category, ...p });
  }

  private async driverCategory(driverId: string): Promise<Category> {
    const cacheKey = `driver:${driverId}:category`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached as Category;
    const { rows } = await this.pool.query(`SELECT v.category FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE v.driver_id = $1 AND v.active AND u.status = 'active'`, [driverId]);
    if (!rows[0]) throw new ConflictException({ code: 'no_active_vehicle', message: 'you need an approved vehicle and an active account to go online' });
    await this.redis.set(cacheKey, rows[0].category, 'EX', CATEGORY_CACHE_SECONDS);
    return rows[0].category;
  }

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
    await this.redis.del(keys.driverState(driverId));
    return fare;
  }
}
