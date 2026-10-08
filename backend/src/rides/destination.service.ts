import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { FareService } from '../fare/fare.service';
import { InsufficientFundsError, LedgerService } from '../ledger/ledger.service';
import { MapsService, insideNigeria } from '../maps/maps.service';
import { PushService } from '../push/push.service';

/** The rider can change the drop-off only from the moment the driver has arrived until the trip is over. */
export const DESTINATION_EDITABLE = ['DRIVER_ARRIVED', 'IN_TRANSIT'];
/** A driver's last position older than this is too stale to route from. */
const DRIVER_FIX_MAX_AGE_S = 180;
/** Choosing the place the trip is already going to is not a change. */
const SAME_PLACE_M = 30;
const MAX_PER_RIDE = 10;

export interface DestinationInput { lat: number; lng: number; address?: string }

export interface DestinationChangeView {
  id: string;
  oldAddress: string | null;
  newDropoff: { lat: number; lng: number; address: string | null };
  remainingDistanceM: number;
  remainingDurationS: number;
  routeSource: 'google' | 'estimate';
  deltaExpectedKobo: number;
  createdAt: Date;
}

/**
 * "Edit drop-off during the trip". It is the same trip with a new end point: the pickup, the trip, and its history stay as they were.
 * Only the rider on the ride can do it, and only once the driver has arrived (the app hides the button before then, and this is the
 * check that counts). The route is worked out again from where the driver is now, so the distance and time still to go are right.
 */
@Injectable()
export class DestinationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly fares: FareService,
    private readonly ledger: LedgerService,
    private readonly maps: MapsService,
    @Optional() private readonly push?: PushService,
  ) {}

  private view(r: any): DestinationChangeView {
    return {
      id: r.id, oldAddress: r.old_address, newDropoff: { lat: Number(r.nlat), lng: Number(r.nlng), address: r.new_address },
      remainingDistanceM: r.remaining_distance_m, remainingDurationS: r.remaining_duration_s, routeSource: r.route_source,
      deltaExpectedKobo: Number(r.delta_expected_kobo), createdAt: r.created_at,
    };
  }

  /** Every change made on a ride, newest first. */
  async list(rideId: string): Promise<DestinationChangeView[]> {
    const { rows } = await this.pool.query(
      `SELECT c.*, ST_Y(c.new_dropoff::geometry) AS nlat, ST_X(c.new_dropoff::geometry) AS nlng FROM ride_destination_changes c WHERE c.ride_id = $1 ORDER BY c.created_at DESC`, [rideId]);
    return rows.map((r) => this.view(r));
  }

  /** What the changes have done to the fare range and the expected fare so far. */
  async deltas(rideId: string): Promise<{ expected: number; low: number; high: number }> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(sum(delta_expected_kobo), 0)::bigint AS e, COALESCE(sum(delta_low_kobo), 0)::bigint AS l, COALESCE(sum(delta_high_kobo), 0)::bigint AS h FROM ride_destination_changes WHERE ride_id = $1`, [rideId]);
    return { expected: Number(rows[0].e), low: Number(rows[0].l), high: Number(rows[0].h) };
  }

  /** A token that changes whenever the drop-off changes, so a held request knows to answer. */
  async version(rideId: string): Promise<string> {
    const { rows } = await this.pool.query(`SELECT id FROM ride_destination_changes WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1`, [rideId]);
    return rows[0]?.id ?? '';
  }

  /** The driver's latest real position (never a mock, never old), or null. */
  private async driverFix(driverId: string) {
    const { rows } = await this.pool.query(
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM driver_location_points
        WHERE driver_id = $1 AND recorded_at > now() - make_interval(secs => $2) ORDER BY recorded_at DESC LIMIT 1`, [driverId, DRIVER_FIX_MAX_AGE_S]);
    return rows[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lng) } : null;
  }

  async change(riderId: string, rideId: string, input: DestinationInput): Promise<{ changed: boolean; change: DestinationChangeView | null }> {
    if (!insideNigeria(input)) throw new BadRequestException({ code: 'bad_location', message: 'Choose a place in Nigeria.' });
    // the route is worked out before the ride is locked, so a slow map answer never holds the ride row
    const peek = await this.pool.query(
      `SELECT r.status, r.driver_id, ST_Y(r.dropoff::geometry) AS dlat, ST_X(r.dropoff::geometry) AS dlng FROM rides r WHERE r.id = $1 AND r.rider_id = $2`, [rideId, riderId]);
    const ride0 = peek.rows[0];
    if (!ride0) throw new NotFoundException('ride not found');
    if (!DESTINATION_EDITABLE.includes(ride0.status)) throw new ConflictException({ code: 'destination_locked', message: ride0.status === 'DRIVER_ASSIGNED' ? 'You can change the destination once your driver has arrived.' : 'The destination can only be changed during an active trip.' });
    const from = await this.driverFix(ride0.driver_id);
    if (!from) throw new ConflictException({ code: 'driver_location_unavailable', message: 'We cannot see your driver\'s location right now. Try again in a moment.' });
    const [toNew, toOld] = await Promise.all([this.maps.route(from, input), this.maps.route(from, { lat: Number(ride0.dlat), lng: Number(ride0.dlng) })]);

    const outcome = await this.ledger.withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id, status, driver_id, payment_method, ST_Distance(dropoff, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)::float8 AS moved_m, dropoff_address
           FROM rides WHERE id = $1 AND rider_id = $2 FOR UPDATE`, [rideId, riderId, input.lng, input.lat]);
      const ride = locked.rows[0];
      if (!ride) throw new NotFoundException('ride not found');
      if (!DESTINATION_EDITABLE.includes(ride.status)) throw new ConflictException({ code: 'destination_locked', message: 'The destination can only be changed during an active trip.' });
      // a retried tap, or the same place chosen again, changes nothing
      if (ride.moved_m < SAME_PLACE_M) return { changed: false, driverId: ride.driver_id as string };
      const count = await client.query(`SELECT count(*)::int AS n FROM ride_destination_changes WHERE ride_id = $1`, [rideId]);
      if (count.rows[0].n >= MAX_PER_RIDE) throw new ConflictException({ code: 'too_many', message: 'The destination has been changed too many times on this trip.' });

      const next = await this.fares.remainingEstimate(client, rideId, toNew);
      const old = await this.fares.remainingEstimate(client, rideId, toOld);
      const delta = { expected: next.expectedKobo - old.expectedKobo, low: next.lowKobo - old.lowKobo, high: next.highKobo - old.highKobo };
      // a wallet trip holds the most it can cost; a longer trip needs the hold raised, a shorter one keeps the hold (it is released at the end)
      if (ride.payment_method === 'wallet' && delta.high > 0) {
        try { await this.ledger.extendHold(client, riderId, rideId, delta.high); }
        catch (e) {
          if (e instanceof InsufficientFundsError) throw new ConflictException({ code: 'insufficient_funds', message: 'Your wallet cannot cover the longer trip. Top up, or pay the driver in cash.' });
          throw e;
        }
      }
      const address = input.address?.trim().slice(0, 200) || null;
      const inserted = await client.query(
        `INSERT INTO ride_destination_changes (ride_id, changed_by, from_point, old_dropoff, old_address, new_dropoff, new_address,
                                               remaining_distance_m, remaining_duration_s, route_source, delta_expected_kobo, delta_low_kobo, delta_high_kobo)
         SELECT r.id, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, r.dropoff, r.dropoff_address, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8, $9, $10, $11, $12, $13
           FROM rides r WHERE r.id = $1 RETURNING id`,
        [rideId, riderId, from.lat, from.lng, input.lat, input.lng, address, toNew.distanceM, toNew.durationS, toNew.source, delta.expected, delta.low, delta.high]);
      await client.query(`UPDATE rides SET dropoff = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, dropoff_address = $4, updated_at = now() WHERE id = $1`, [rideId, input.lng, input.lat, address]);
      // the trip's history keeps the original pickup and notes the change; the status itself does not move
      await client.query(
        `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, reason) VALUES ($1, $2, $2, $3, $4)`,
        [rideId, ride.status, riderId, `Drop-off changed${address ? ` to ${address}` : ''}: ${(toNew.distanceM / 1000).toFixed(1)} km to go`]);
      return { changed: true, driverId: ride.driver_id as string, id: inserted.rows[0].id as string, address };
    });

    if (!outcome.changed) return { changed: false, change: (await this.list(rideId))[0] ?? null };
    void this.push?.toUser(outcome.driverId, {
      type: 'destination', title: 'Destination changed',
      body: `Your rider changed the drop-off${outcome.address ? ` to ${outcome.address}` : ''}. Open 9jaRide for the new route.`, data: { rideId },
    });
    return { changed: true, change: (await this.list(rideId)).find((c) => c.id === outcome.id) ?? null };
  }
}
