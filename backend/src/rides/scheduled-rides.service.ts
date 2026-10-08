import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { shortCode } from '../common/short-code';
import { DispatchService } from '../dispatch/dispatch.service';
import { Category } from '../dispatch/dispatch.types';
import { FareService, NoPricingError } from '../fare/fare.service';
import { InsufficientFundsError, LedgerService } from '../ledger/ledger.service';

// Placeholders until operations decides. All overridable from the environment.
export const MIN_LEAD_MINUTES = Number(process.env.SCHEDULE_MIN_LEAD_MINUTES ?? 30); // earliest booking: 30 minutes ahead
export const MAX_DAYS_AHEAD = Number(process.env.SCHEDULE_MAX_DAYS_AHEAD ?? 30);
export const MAX_WEEKS = Number(process.env.SCHEDULE_MAX_WEEKS ?? 12);
export const MAX_OPEN_SCHEDULED = Number(process.env.SCHEDULE_MAX_OPEN ?? 30); // per rider
const SEARCH_LEAD_MINUTES = Number(process.env.SCHEDULE_SEARCH_LEAD_MINUTES ?? 30); // dispatch starts this long before pickup (the design says 30)
const SEARCH_WINDOW_SECONDS = Number(process.env.SCHEDULE_SEARCH_WINDOW_SECONDS ?? 900); // and may search this long
const MISSED_GRACE_MINUTES = Number(process.env.SCHEDULE_MISSED_GRACE_MINUTES ?? 10); // too late to start after pickup + this
const WEEK_MS = 7 * 24 * 3_600_000; // Nigeria has no daylight saving, so "same time next week" is exactly 7 days

/** Tells the rider a scheduled ride was cancelled by the system. Real push/SMS plugs in here. */
export interface ScheduleNotifier {
  systemCancelled(riderId: string, rideId: string, reason: string): Promise<void>;
}
export const SCHEDULE_NOTIFIER = Symbol('SCHEDULE_NOTIFIER');

export interface ScheduleInput {
  category: Category;
  paymentMethod: 'cash' | 'wallet';
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  distanceM: number;
  durationS: number;
  firstPickupAt: Date;
  pickupAddress?: string;
  dropoffAddress?: string;
  repeat: 'none' | 'weekly';
  weeks?: number;
}

@Injectable()
export class ScheduledRidesService {
  private readonly log = new Logger(ScheduledRidesService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SCHEDULE_NOTIFIER) private readonly notifier: ScheduleNotifier,
    private readonly fares: FareService,
    private readonly ledger: LedgerService,
    private readonly dispatch: DispatchService,
  ) {}

  // ------------------------------------------------------------------ booking

  /**
   * Book one ride or a weekly series. Nothing is priced or held yet: the fare is worked out with the rates in force
   * when dispatch starts, and wallet money is held then. The estimate returned here is indicative only.
   */
  async create(riderId: string, idempotencyKey: string, input: ScheduleInput) {
    const now = Date.now();
    const first = input.firstPickupAt.getTime();
    if (Number.isNaN(first)) throw new BadRequestException('pickup time is not a valid date');
    if (first < now + MIN_LEAD_MINUTES * 60_000) {
      throw new BadRequestException({ code: 'too_soon', message: `book at least ${MIN_LEAD_MINUTES} minutes ahead; use a normal ride for sooner` });
    }
    if (first > now + MAX_DAYS_AHEAD * 86_400_000) {
      throw new BadRequestException({ code: 'too_far', message: `rides can be booked at most ${MAX_DAYS_AHEAD} days ahead` });
    }
    const count = input.repeat === 'weekly' ? (input.weeks ?? 0) : 1;
    if (input.repeat === 'weekly' && (!Number.isInteger(count) || count < 2 || count > MAX_WEEKS)) {
      throw new BadRequestException({ code: 'bad_weeks', message: `a weekly ride repeats for 2 to ${MAX_WEEKS} weeks` });
    }
    const estimate = await this.fares.preview(input.category, { distanceM: input.distanceM, durationS: input.durationS });

    return this.ledger.withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO ride_schedules (rider_id, category, payment_method, pickup, dropoff, est_distance_m, est_duration_s,
                                     first_pickup_at, repeat, occurrences, idempotency_key, pickup_address, dropoff_address)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                 $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (rider_id, idempotency_key) DO NOTHING RETURNING id`,
        [riderId, input.category, input.paymentMethod, input.pickup.lng, input.pickup.lat, input.dropoff.lng, input.dropoff.lat,
         input.distanceM, input.durationS, input.firstPickupAt, input.repeat, count, idempotencyKey, input.pickupAddress ?? null, input.dropoffAddress ?? null],
      );
      if (!inserted.rowCount) {
        const existing = await client.query(`SELECT id FROM ride_schedules WHERE rider_id = $1 AND idempotency_key = $2`, [riderId, idempotencyKey]);
        return { ...(await this.describe(client, existing.rows[0].id)), duplicate: true };
      }
      const scheduleId = inserted.rows[0].id as string;

      // Lock the rider row so two bookings at once cannot together exceed the limit.
      await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [riderId]);
      const open = await client.query(`SELECT count(*)::int AS n FROM rides WHERE rider_id = $1 AND status = 'SCHEDULED'`, [riderId]);
      if (open.rows[0].n + count > MAX_OPEN_SCHEDULED) {
        throw new ConflictException({ code: 'too_many_scheduled', message: `you can have at most ${MAX_OPEN_SCHEDULED} scheduled rides at a time` });
      }

      for (let i = 0; i < count; i++) {
        const ride = await client.query(
          `INSERT INTO rides (short_code, rider_id, category, status, payment_method, pickup, dropoff, idempotency_key,
                              scheduled_for, schedule_id, est_distance_m, est_duration_s, pickup_address, dropoff_address)
           SELECT $1, rider_id, category, 'SCHEDULED', payment_method, pickup, dropoff, $2, $3, id, est_distance_m, est_duration_s, pickup_address, dropoff_address
             FROM ride_schedules WHERE id = $4 RETURNING id`,
          [shortCode(), `${idempotencyKey}:${i}`, new Date(first + i * WEEK_MS), scheduleId],
        );
        await client.query(`INSERT INTO ride_status_history (ride_id, to_status, actor_id) VALUES ($1, 'SCHEDULED', $2)`, [ride.rows[0].id, riderId]);
      }
      return { ...(await this.describe(client, scheduleId)), duplicate: false, estimate };
    });
  }

  private async describe(db: Pick<Pool, 'query'>, scheduleId: string) {
    const s = (await db.query(`SELECT id, category, payment_method, repeat, occurrences, status, first_pickup_at, pickup_address, dropoff_address, est_distance_m, est_duration_s FROM ride_schedules WHERE id = $1`, [scheduleId])).rows[0];
    const rides = (await db.query(`SELECT id, status, scheduled_for FROM rides WHERE schedule_id = $1 ORDER BY scheduled_for`, [scheduleId])).rows;
    return {
      scheduleId: s.id as string,
      category: s.category,
      paymentMethod: s.payment_method,
      repeat: s.repeat,
      status: s.status,
      pickupAddress: s.pickup_address as string | null,
      dropoffAddress: s.dropoff_address as string | null,
      distanceM: s.est_distance_m as number,
      durationS: s.est_duration_s as number,
      rides: rides.map((r) => ({ rideId: r.id as string, status: r.status as string, scheduledFor: r.scheduled_for as Date })),
    };
  }

  async list(riderId: string) {
    const { rows } = await this.pool.query(`SELECT id FROM ride_schedules WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 50`, [riderId]);
    return Promise.all(rows.map((r) => this.describe(this.pool, r.id)));
  }

  /** Cancel every occurrence that has not started dispatch yet. Occurrences already live are cancelled one by one. */
  async cancelSeries(riderId: string, scheduleId: string): Promise<{ cancelled: number }> {
    return this.ledger.withTransaction(async (client) => {
      const owned = await client.query(`SELECT 1 FROM ride_schedules WHERE id = $1 AND rider_id = $2 FOR UPDATE`, [scheduleId, riderId]);
      if (!owned.rowCount) throw new NotFoundException('schedule not found');
      await client.query(`UPDATE ride_schedules SET status = 'CANCELLED' WHERE id = $1`, [scheduleId]);
      const done = await client.query(
        `UPDATE rides SET status = 'CANCELLED_BY_RIDER', cancel_reason = 'schedule cancelled', updated_at = now()
          WHERE schedule_id = $1 AND status = 'SCHEDULED' RETURNING id`,
        [scheduleId],
      );
      for (const { id } of done.rows) {
        await client.query(
          `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, reason) VALUES ($1, 'SCHEDULED', 'CANCELLED_BY_RIDER', $2, 'schedule cancelled')`,
          [id, riderId],
        );
      }
      return { cancelled: done.rowCount ?? 0 };
    });
  }

  // ------------------------------------------------------------------ activation (the delayed job)

  /**
   * Called every 30 seconds by the worker, safe on several instances. For each ride whose dispatch time has come:
   * price it with today's rates, hold the wallet money, and start the driver search with a longer window than an
   * on-demand ride gets. A ride that cannot start (no pricing, wallet short) is cancelled and the rider told.
   * A ride more than MISSED_GRACE past its pickup time (the worker was down) is cancelled, not started late.
   */
  async activateDue(limit = 50): Promise<number> {
    let handled = 0;
    for (let i = 0; i < limit; i++) {
      const outcome = await this.activateOne();
      if (!outcome) break;
      handled++;
    }
    return handled;
  }

  private async activateOne(): Promise<boolean> {
    const state: { failure: { rideId: string; riderId: string; reason: string } | null; started: string | null } = { failure: null, started: null };

    try {
      const claimed = await this.ledger.withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT id, rider_id, category, payment_method, est_distance_m, est_duration_s,
                  scheduled_for + make_interval(mins => $2) < now() AS missed
             FROM rides
            WHERE status = 'SCHEDULED' AND scheduled_for - make_interval(mins => $1) <= now()
            ORDER BY scheduled_for LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [SEARCH_LEAD_MINUTES, MISSED_GRACE_MINUTES],
        );
        const ride = rows[0];
        if (!ride) return false;

        if (ride.missed) {
          state.failure = { rideId: ride.id, riderId: ride.rider_id, reason: 'we could not start this ride in time' };
          await this.cancelBySystem(client, ride.id, state.failure.reason);
          return true;
        }
        try {
          // Price with the rates in force NOW; this pins the pricing version for the whole ride.
          const quote = await this.fares.estimate(ride.rider_id, ride.category, { distanceM: ride.est_distance_m, durationS: ride.est_duration_s });
          await client.query(
            `UPDATE rides SET status = 'SEARCHING_DRIVER', search_started_at = now(), search_window_seconds = $2, updated_at = now() WHERE id = $1`,
            [ride.id, SEARCH_WINDOW_SECONDS],
          );
          await client.query(`INSERT INTO ride_status_history (ride_id, from_status, to_status, reason) VALUES ($1, 'SCHEDULED', 'SEARCHING_DRIVER', 'dispatch time reached')`, [ride.id]);
          await this.fares.attachQuote(client, ride.id, ride.rider_id, quote.quoteId);
          if (ride.payment_method === 'wallet') await this.ledger.holdForRide(client, ride.rider_id, ride.id, quote.highKobo);
          state.started = ride.id;
        } catch (e) {
          if (!(e instanceof NoPricingError) && !(e instanceof InsufficientFundsError)) throw e;
          // Undo the half-done start inside this transaction, then cancel cleanly.
          throw new ActivationRefused(ride.id, ride.rider_id, e instanceof InsufficientFundsError ? 'your wallet balance is too low for this ride' : 'pricing is unavailable for this ride');
        }
        return true;
      });
      if (!claimed) return false;
    } catch (e) {
      if (!(e instanceof ActivationRefused)) throw e;
      state.failure = { rideId: e.rideId, riderId: e.riderId, reason: e.message };
      // The transaction above rolled back, so the ride is still SCHEDULED; cancel it in a fresh one.
      await this.ledger.withTransaction(async (client) => {
        await client.query(`SELECT 1 FROM rides WHERE id = $1 FOR UPDATE`, [e.rideId]);
        await this.cancelBySystem(client, e.rideId, e.message);
      });
    }

    const { failure: f, started } = state;
    if (f) {
      this.log.warn(`scheduled ride ${f.rideId} cancelled: ${f.reason}`);
      await this.notifier.systemCancelled(f.riderId, f.rideId, f.reason).catch((err) => this.log.error(`cancel notice failed: ${err}`));
    }
    if (started) this.dispatch.advance(started).catch((err) => this.log.error(`advance failed for ${started}: ${err}`));
    return true;
  }

  private async cancelBySystem(client: import('pg').PoolClient, rideId: string, reason: string) {
    const res = await client.query(
      `UPDATE rides SET status = 'CANCELLED_BY_SYSTEM', cancel_reason = $2, updated_at = now() WHERE id = $1 AND status = 'SCHEDULED'`,
      [rideId, reason],
    );
    if (res.rowCount) {
      await client.query(`INSERT INTO ride_status_history (ride_id, from_status, to_status, reason) VALUES ($1, 'SCHEDULED', 'CANCELLED_BY_SYSTEM', $2)`, [rideId, reason]);
    }
  }
}

class ActivationRefused extends Error {
  constructor(public readonly rideId: string, public readonly riderId: string, message: string) {
    super(message);
  }
}
