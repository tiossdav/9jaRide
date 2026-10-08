import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { Anchor, Fix, haversineM, step, trackingConfig } from './tracking';

const CLOCK_ROOM_MS = 30_000;

export interface RideProgress {
  /** Metres driven so far on the way to the pickup. */
  pickupTravelledM: number;
  /** Metres driven with the rider so far. When the trip is finished this is the trip's tracked distance. */
  tripTravelledM: number;
  finished: boolean;
}

/**
 * Turns the driver's GPS readings into distance travelled, per booking, and notices arrival at the pickup. Called with every
 * batch of readings that arrives while the driver has a ride; it never throws into the location path.
 */
@Injectable()
export class TrackingService {
  private readonly log = new Logger(TrackingService.name);
  private readonly cfg = trackingConfig();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** `points` are the driver's accepted readings, oldest first. */
  async record(driverId: string, rideId: string, points: (Fix & { atMs: number })[]): Promise<void> {
    try {
      await this.apply(driverId, rideId, points);
    } catch (e) {
      this.log.error(`tracking failed for ride ${rideId}: ${e}`);
    }
  }

  private async apply(driverId: string, rideId: string, points: Fix[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ride = (
        await client.query(
          `SELECT r.status, ST_Y(r.pickup::geometry) AS plat, ST_X(r.pickup::geometry) AS plng,
                  (SELECT created_at FROM ride_status_history WHERE ride_id = r.id AND to_status = 'DRIVER_ARRIVED' ORDER BY id DESC LIMIT 1) AS arrived_at,
                  (SELECT created_at FROM ride_status_history WHERE ride_id = r.id AND to_status = 'IN_TRANSIT' ORDER BY id DESC LIMIT 1) AS started_at
             FROM rides r WHERE r.id = $1 AND r.driver_id = $2`, [rideId, driverId],
        )
      ).rows[0];
      if (!ride || !['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_TRANSIT'].includes(ride.status)) { await client.query('ROLLBACK'); return; }

      await client.query(`INSERT INTO ride_tracking (ride_id) VALUES ($1) ON CONFLICT (ride_id) DO NOTHING`, [rideId]);
      const t = (await client.query(`SELECT * FROM ride_tracking WHERE ride_id = $1 FOR UPDATE`, [rideId])).rows[0];
      if (t.finished_at) { await client.query('ROLLBACK'); return; }

      let pickupM: number = t.pickup_leg_m;
      let tripM: number = t.trip_m;
      let pAnchor: Anchor | null = t.pickup_anchor;
      let tAnchor: Anchor | null = t.trip_anchor;
      let pJumps: number = t.pickup_jumps;
      let tJumps: number = t.trip_jumps;
      let accepted = 0;
      let ignored = 0;
      // phone and server clocks never agree exactly, so the change between the parts of a booking is given some room
      const startedMs = ride.started_at ? new Date(ride.started_at).getTime() - CLOCK_ROOM_MS : null;
      const arrivedMs = ride.arrived_at ? new Date(ride.arrived_at).getTime() - CLOCK_ROOM_MS : null;

      for (const p of points) {
        // which part of the booking this reading belongs to is decided by when it was taken, so an offline batch lands in the right one
        if (startedMs != null && p.atMs >= startedMs) {
          const r = step(tAnchor, tJumps, p, this.cfg);
          tripM += r.addM; tAnchor = r.anchor; tJumps = r.jumps;
          r.outcome === 'added' || r.outcome === 'start' || r.outcome === 'reset' ? accepted++ : ignored++;
        } else if (arrivedMs != null && p.atMs >= arrivedMs) {
          continue; // waiting at the pickup: no distance
        } else {
          const r = step(pAnchor, pJumps, p, this.cfg);
          pickupM += r.addM; pAnchor = r.anchor; pJumps = r.jumps;
          r.outcome === 'added' || r.outcome === 'start' || r.outcome === 'reset' ? accepted++ : ignored++;
        }
      }
      await client.query(
        `UPDATE ride_tracking SET pickup_leg_m = $2, trip_m = $3, pickup_anchor = $4, trip_anchor = $5, pickup_jumps = $6, trip_jumps = $7,
                accepted_points = accepted_points + $8, ignored_points = ignored_points + $9, updated_at = now() WHERE ride_id = $1`,
        [rideId, Math.round(pickupM), Math.round(tripM), pAnchor, tAnchor, pJumps, tJumps, accepted, ignored],
      );

      // The newest good reading within the arrival radius of the pickup moves the booking to "arrived" by itself.
      const newest = points[points.length - 1];
      if (ride.status === 'DRIVER_ASSIGNED' && newest && (newest.accuracyM == null || newest.accuracyM <= this.cfg.maxAccuracyM)
          && haversineM(newest, { lat: ride.plat, lng: ride.plng }) <= this.cfg.arriveRadiusM) {
        const res = await client.query(`UPDATE rides SET status = 'DRIVER_ARRIVED', updated_at = now() WHERE id = $1 AND driver_id = $2 AND status = 'DRIVER_ASSIGNED'`, [rideId, driverId]);
        if (res.rowCount) {
          await client.query(`INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, reason) VALUES ($1, 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', $2, 'reached the pickup point')`, [rideId, driverId]);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** The distances are final once the trip is completed. */
  async finish(rideId: string): Promise<void> {
    await this.pool.query(`UPDATE ride_tracking SET finished_at = now(), updated_at = now() WHERE ride_id = $1 AND finished_at IS NULL`, [rideId]);
  }

  async progress(rideId: string): Promise<RideProgress> {
    const t = (await this.pool.query(`SELECT pickup_leg_m, trip_m, finished_at FROM ride_tracking WHERE ride_id = $1`, [rideId])).rows[0];
    return { pickupTravelledM: t?.pickup_leg_m ?? 0, tripTravelledM: t?.trip_m ?? 0, finished: !!t?.finished_at };
  }
}
