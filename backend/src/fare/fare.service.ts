import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { Fare, Measured, Rates, computeFare, estimateFare } from './fare.calc';
import { percentOf, roundToStep } from '../common/money';

const DEFAULT_ZONE = 'lagos';

export class NoPricingError extends Error {
  constructor(category: string) {
    super(`no approved pricing in effect for category ${category}`);
  }
}
/** The category does not exist, or an admin has switched it off. */
export class CategoryUnavailableError extends Error {
  constructor(category: string) {
    super(`the ${category} category is not available`);
  }
}
export class QuoteInvalidError extends Error {
  constructor() {
    super('quote is expired, not yours, or does not match this ride');
  }
}

export interface QuoteResult {
  quoteId: string;
  expectedKobo: number;
  lowKobo: number;
  highKobo: number;
  expiresAt: Date;
}

export interface StoredFare extends Fare {
  rideId: string;
  outsideQuoteRange: boolean;
  /** True when this call created the snapshot; false when it already existed (a retry). */
  created: boolean;
}

function ratesFromRow(row: any): Rates {
  return {
    baseKobo: Number(row.base_kobo),
    perKmKobo: Number(row.per_km_kobo),
    perMinuteKobo: Number(row.per_minute_kobo),
    waitingPerMinuteKobo: Number(row.waiting_per_minute_kobo),
    freeWaitingSeconds: Number(row.free_waiting_seconds),
    taxKobo: Number(row.tax_kobo),
    roundingStepKobo: Number(row.rounding_step_kobo),
    estimateLowBps: Number(row.estimate_low_bps),
    estimateHighBps: Number(row.estimate_high_bps),
  };
}

@Injectable()
export class FareService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The approved pricing version in force at `at`. Unapproved or future versions are never used. */
  private async activeVersion(db: Pick<Pool, 'query'>, category: string, at: Date) {
    // A category an admin has switched off, or that does not exist, is not offered for any new booking.
    const offered = await db.query(`SELECT active FROM asset_types WHERE code = $1`, [category]);
    if (!offered.rows[0]?.active) throw new CategoryUnavailableError(category);
    const { rows } = await db.query(
      `SELECT * FROM pricing_versions
        WHERE category = $1 AND zone = $2 AND approved_at IS NOT NULL AND effective_from <= $3
        ORDER BY effective_from DESC LIMIT 1`,
      [category, DEFAULT_ZONE, at],
    );
    if (!rows[0]) throw new NoPricingError(category);
    return rows[0];
  }

  /** Quote a trip before it is requested. The quote pins the pricing version and is valid for 5 minutes. */
  async estimate(
    riderId: string,
    category: string,
    trip: { distanceM: number; durationS: number },
    at = new Date(),
  ): Promise<QuoteResult> {
    const version = await this.activeVersion(this.pool, category, at);
    const est = estimateFare(ratesFromRow(version), trip);
    const { rows } = await this.pool.query(
      `INSERT INTO fare_quotes (rider_id, category, pricing_version_id, distance_m, duration_s, expected_kobo, low_kobo, high_kobo, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz + make_interval(secs => $10))
       RETURNING id, expires_at`,
      [
        riderId, category, version.id, trip.distanceM, trip.durationS,
        est.expectedKobo, est.lowKobo, est.highKobo, at, version.quote_validity_seconds,
      ],
    );
    return { quoteId: rows[0].id, ...est, expiresAt: rows[0].expires_at };
  }

  /**
   * What going further adds to a ride's fare: the distance and time fees for the extra stretch, by the pricing the ride was booked under.
   * No booking fee or daily tax is added again; those were charged once for the whole trip.
   */
  async extensionEstimate(db: Pick<Pool, 'query'>, rideId: string, trip: { distanceM: number; durationS: number }) {
    const { rows } = await db.query(`SELECT pv.* FROM rides r JOIN pricing_versions pv ON pv.id = r.pricing_version_id WHERE r.id = $1`, [rideId]);
    if (!rows[0]) throw new Error(`ride ${rideId} was never priced`);
    const rates = ratesFromRow(rows[0]);
    const raw = Math.round((rates.perKmKobo * trip.distanceM) / 1000) + Math.round((rates.perMinuteKobo * trip.durationS) / 60);
    const expectedKobo = roundToStep(raw, rates.roundingStepKobo);
    return {
      expectedKobo,
      lowKobo: Math.min(expectedKobo, roundToStep(percentOf(expectedKobo, rates.estimateLowBps), rates.roundingStepKobo)),
      highKobo: Math.max(expectedKobo, roundToStep(percentOf(expectedKobo, rates.estimateHighBps), rates.roundingStepKobo)),
    };
  }

  /** An indicative price for a trip that is not being booked right now (a scheduled ride). Stores nothing. */
  async preview(category: string, trip: { distanceM: number; durationS: number }, at = new Date()) {
    const version = await this.activeVersion(this.pool, category, at);
    return estimateFare(ratesFromRow(version), trip);
  }

  /**
   * Tie a still-live quote to a new ride, so the ride is priced by the version it was quoted under.
   * Call inside the ride-request transaction. Later fee changes never touch it (new rides only).
   */
  async attachQuote(client: PoolClient, rideId: string, riderId: string, quoteId: string): Promise<void> {
    const res = await client.query(
      `UPDATE rides r SET fare_quote_id = q.id, pricing_version_id = q.pricing_version_id, updated_at = now()
         FROM fare_quotes q
        WHERE r.id = $1 AND q.id = $2
          AND r.rider_id = $3 AND q.rider_id = $3
          AND q.category = r.category
          AND q.expires_at > now()
          AND r.status IN ('REQUESTED', 'SEARCHING_DRIVER')
          AND r.fare_quote_id IS NULL`,
      [rideId, quoteId, riderId],
    );
    if (res.rowCount === 0) throw new QuoteInvalidError();
  }

  /**
   * Write the immutable fare snapshot for a finished trip, priced by the version the ride was quoted under.
   * Idempotent: a retry returns the stored snapshot untouched, so an old receipt can never change.
   * Call inside a transaction; the database checks at commit that the lines add up to the total.
   */
  async finalize(client: PoolClient, rideId: string, measured: Measured): Promise<StoredFare> {
    const { rows } = await client.query(
      `SELECT r.id, r.pricing_version_id, q.low_kobo + x.low AS low_kobo, q.high_kobo + x.high AS high_kobo
         FROM rides r LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id
         CROSS JOIN LATERAL (SELECT COALESCE(sum(extra_low_kobo), 0) AS low, COALESCE(sum(extra_high_kobo), 0) AS high FROM ride_extensions WHERE ride_id = r.id AND status = 'ACCEPTED') x
        WHERE r.id = $1 FOR UPDATE OF r`,
      [rideId],
    );
    const ride = rows[0];
    if (!ride) throw new Error(`ride ${rideId} not found`);

    const existing = await this.loadSnapshot(client, rideId);
    if (existing) return { ...existing, created: false };

    if (!ride.pricing_version_id) throw new Error(`ride ${rideId} was never priced: no quote attached`);
    const versionRow = (await client.query(`SELECT * FROM pricing_versions WHERE id = $1`, [ride.pricing_version_id])).rows[0];
    const fare = computeFare(ratesFromRow(versionRow), measured);

    // The estimate guard is an open decision (spec). Until it is made, a fare above the shown range is
    // charged as computed but flagged for review, never silently capped or ignored.
    const outsideQuoteRange =
      ride.high_kobo != null && (fare.totalKobo > Number(ride.high_kobo) || fare.totalKobo < Number(ride.low_kobo));

    await client.query(
      `INSERT INTO ride_fares (ride_id, pricing_version_id, distance_m, duration_s, waiting_s,
                               subtotal_kobo, rounding_kobo, tax_kobo, total_kobo, outside_quote_range)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        rideId, ride.pricing_version_id, measured.distanceM, measured.durationS, measured.waitingS,
        fare.subtotalKobo, fare.roundingKobo, fare.taxKobo, fare.totalKobo, outsideQuoteRange,
      ],
    );
    for (const [i, line] of fare.lines.entries()) {
      await client.query(
        `INSERT INTO ride_fare_lines (ride_id, position, kind, label, amount_kobo) VALUES ($1, $2, $3, $4, $5)`,
        [rideId, i, line.kind, line.label, line.amountKobo],
      );
    }
    return { ...fare, rideId, outsideQuoteRange, created: true };
  }

  /** The receipt: stored lines exactly as charged, never recomputed from current prices. */
  async getReceipt(rideId: string): Promise<Omit<StoredFare, 'created'> | null> {
    const snapshot = await this.loadSnapshot(this.pool, rideId);
    return snapshot;
  }

  private async loadSnapshot(db: Pick<Pool, 'query'>, rideId: string): Promise<Omit<StoredFare, 'created'> | null> {
    const fare = (await db.query(`SELECT * FROM ride_fares WHERE ride_id = $1`, [rideId])).rows[0];
    if (!fare) return null;
    const lines = (
      await db.query(`SELECT kind, label, amount_kobo FROM ride_fare_lines WHERE ride_id = $1 ORDER BY position`, [rideId])
    ).rows;
    return {
      rideId,
      lines: lines.map((l) => ({ kind: l.kind, label: l.kind === 'service' ? 'Booking Fee' : l.label, amountKobo: Number(l.amount_kobo) })),
      subtotalKobo: Number(fare.subtotal_kobo),
      roundingKobo: Number(fare.rounding_kobo),
      taxKobo: Number(fare.tax_kobo),
      totalKobo: Number(fare.total_kobo),
      outsideQuoteRange: fare.outside_quote_range,
    };
  }
}
