import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { FareService } from '../fare/fare.service';
import { InsufficientFundsError, LedgerService } from '../ledger/ledger.service';
import { PushService } from '../push/push.service';

/** How long the other person has to answer before the question lapses and the trip simply goes on to the original destination. */
export const EXTENSION_ANSWER_SECONDS = 120;
/** A trip can be extended a few times, but a rider or driver cannot flood the other with requests. */
const MAX_PER_RIDE = 5;
/** The new place must be at least this far from the old one to be worth a change. */
const MIN_STEP_M = 150;

export interface ExtensionInput {
  lat: number;
  lng: number;
  address?: string;
  /** The road distance and time from the current destination to the new place, worked out by the phone's map. */
  distanceM: number;
  durationS: number;
}

export interface ExtensionView {
  id: string;
  requestedBy: 'rider' | 'driver';
  /** True when the person looking is the one who asked. */
  mine: boolean;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  oldAddress: string | null;
  newDropoff: { lat: number; lng: number; address: string | null };
  extraDistanceM: number;
  extraDurationS: number;
  extraKobo: number;
  lowKobo: number;
  highKobo: number;
  /** What the whole trip is expected to cost if this is accepted (the trip's expected fare, earlier extensions, and this one). */
  newTotalKobo: number | null;
  secondsLeft: number;
  declineReason: string | null;
  createdAt: Date;
  respondedAt: Date | null;
}

const OPEN_STATUSES = ['TRIP_STARTED'];

/**
 * Going further than the booked destination. Either the driver or the rider proposes a new destination; the other person sees the
 * extra distance and extra fare and accepts or declines. Only an acceptance changes anything (the destination, the expected fare,
 * the money held for a wallet trip). A decline, a lapse, or a withdrawal leaves the original trip untouched, and the fare is
 * always worked out from the distance really driven, so a driver is never left unpaid for an extension a rider agreed to.
 */
@Injectable()
export class ExtensionsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly fares: FareService,
    private readonly ledger: LedgerService,
    @Optional() private readonly push?: PushService,
  ) {}

  private view(r: any, viewerId: string, baseExpectedKobo: number | null, earlierKobo: number): ExtensionView {
    const age = (Date.now() - new Date(r.created_at).getTime()) / 1000;
    const lapsed = r.status === 'PENDING' && age > EXTENSION_ANSWER_SECONDS;
    return {
      id: r.id, requestedBy: r.requested_by, mine: r.requester_id === viewerId, status: lapsed ? 'EXPIRED' : r.status,
      oldAddress: r.old_address, newDropoff: { lat: Number(r.nlat), lng: Number(r.nlng), address: r.new_address },
      extraDistanceM: r.extra_distance_m, extraDurationS: r.extra_duration_s,
      extraKobo: Number(r.extra_expected_kobo), lowKobo: Number(r.extra_low_kobo), highKobo: Number(r.extra_high_kobo),
      newTotalKobo: baseExpectedKobo == null ? null : baseExpectedKobo + earlierKobo + Number(r.extra_expected_kobo),
      secondsLeft: r.status === 'PENDING' ? Math.max(0, Math.round(EXTENSION_ANSWER_SECONDS - age)) : 0,
      declineReason: r.decline_reason, createdAt: r.created_at, respondedAt: r.responded_at,
    };
  }

  private static readonly SELECT = `SELECT e.*, ST_Y(e.new_dropoff::geometry) AS nlat, ST_X(e.new_dropoff::geometry) AS nlng FROM ride_extensions e`;

  /** Every extension of a ride, newest first, as [viewerId] sees it. */
  async list(rideId: string, viewerId: string): Promise<ExtensionView[]> {
    const { rows } = await this.pool.query(`${ExtensionsService.SELECT} WHERE e.ride_id = $1 ORDER BY e.created_at DESC`, [rideId]);
    if (!rows.length) return [];
    const base = (await this.pool.query(`SELECT q.expected_kobo FROM rides r LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id WHERE r.id = $1`, [rideId])).rows[0]?.expected_kobo;
    const accepted = rows.filter((r) => r.status === 'ACCEPTED').reduce((s, r) => s + Number(r.extra_expected_kobo), 0);
    // for a still-open question, "earlier" is everything already accepted
    return rows.map((r) => this.view(r, viewerId, base == null ? null : Number(base), r.status === 'ACCEPTED' ? 0 : accepted));
  }

  /** What the trip's expected fare has grown by through accepted extensions. */
  async acceptedKobo(rideId: string): Promise<{ expected: number; low: number; high: number }> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(sum(extra_expected_kobo), 0)::bigint AS e, COALESCE(sum(extra_low_kobo), 0)::bigint AS l, COALESCE(sum(extra_high_kobo), 0)::bigint AS h FROM ride_extensions WHERE ride_id = $1 AND status = 'ACCEPTED'`, [rideId]);
    return { expected: Number(rows[0].e), low: Number(rows[0].l), high: Number(rows[0].h) };
  }

  /** A short token that changes whenever an extension is asked, answered or lapses, so a held request can notice. */
  async version(rideId: string): Promise<string> {
    const { rows } = await this.pool.query(`SELECT id, status, created_at FROM ride_extensions WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1`, [rideId]);
    if (!rows[0]) return '';
    const lapsed = rows[0].status === 'PENDING' && Date.now() - new Date(rows[0].created_at).getTime() > EXTENSION_ANSWER_SECONDS * 1000;
    return `${rows[0].id}:${lapsed ? 'EXPIRED' : rows[0].status}`;
  }

  /** Who is who on this ride. Only its own rider and driver may take part. */
  private async seat(client: Pick<Pool, 'query'>, userId: string, rideId: string, lock = false) {
    const { rows } = await client.query(
      `SELECT id, status, rider_id, driver_id, payment_method
         FROM rides WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [rideId]);
    const r = rows[0];
    if (!r) throw new NotFoundException('ride not found');
    if (userId !== r.rider_id && userId !== r.driver_id) throw new NotFoundException('ride not found');
    return { ride: r, role: (userId === r.rider_id ? 'rider' : 'driver') as 'rider' | 'driver' };
  }

  /** Propose going on to a new destination. The other person is asked; nothing changes until they say yes. */
  async request(userId: string, rideId: string, input: ExtensionInput): Promise<ExtensionView> {
    const created = await this.ledger.withTransaction(async (client) => {
      const { ride, role } = await this.seat(client, userId, rideId, true);
      if (!OPEN_STATUSES.includes(ride.status)) throw new ConflictException({ code: 'wrong_state', message: 'A trip can only be extended while it is under way.' });

      // an unanswered question from before has lapsed: close it so a new one can be asked
      await client.query(`UPDATE ride_extensions SET status = 'EXPIRED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' AND created_at < now() - make_interval(secs => $2)`, [rideId, EXTENSION_ANSWER_SECONDS]);
      const open = await client.query(`SELECT 1 FROM ride_extensions WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
      if (open.rowCount) throw new ConflictException({ code: 'extension_pending', message: 'There is already a request waiting for an answer.' });
      const count = await client.query(`SELECT count(*)::int AS n FROM ride_extensions WHERE ride_id = $1`, [rideId]);
      if (count.rows[0].n >= MAX_PER_RIDE) throw new ConflictException({ code: 'too_many', message: 'This trip has had too many extension requests.' });

      const steps = await client.query(
        `SELECT ST_Distance(dropoff, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)::float8 AS straight FROM rides WHERE id = $1`, [rideId, input.lng, input.lat]);
      const straight: number = steps.rows[0].straight;
      if (straight < MIN_STEP_M) throw new BadRequestException({ code: 'too_close', message: 'That is almost where you are already going. Choose a place further on.' });
      // The phone's map worked out the road distance. It cannot be shorter than the straight line, or absurdly longer.
      if (input.distanceM < straight * 0.9 || input.distanceM > straight * 5 + 3000) throw new BadRequestException({ code: 'bad_distance', message: 'That distance does not match the places chosen.' });

      const price = await this.fares.extensionEstimate(client, rideId, { distanceM: input.distanceM, durationS: input.durationS });
      // a wallet trip can only be extended by what the wallet can still cover
      if (ride.payment_method === 'wallet' && !(await this.ledger.canHold(client, ride.rider_id, price.highKobo))) {
        throw new ConflictException({ code: 'insufficient_funds', message: role === 'rider' ? 'Your wallet cannot cover the extra fare. Top up, or ask your driver to continue in cash.' : 'The rider\'s wallet cannot cover the extra fare.' });
      }
      const { rows } = await client.query(
        `INSERT INTO ride_extensions (ride_id, requested_by, requester_id, old_dropoff, old_address, new_dropoff, new_address,
                                      extra_distance_m, extra_duration_s, extra_expected_kobo, extra_low_kobo, extra_high_kobo)
         SELECT r.id, $2, $3, r.dropoff, r.dropoff_address, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, $9, $10, $11 FROM rides r WHERE r.id = $1
         RETURNING id`,
        [rideId, role, userId, input.lng, input.lat, input.address?.slice(0, 200) ?? null, input.distanceM, input.durationS, price.expectedKobo, price.lowKobo, price.highKobo],
      );
      return { id: rows[0].id as string, other: (role === 'rider' ? ride.driver_id : ride.rider_id) as string, role, expected: price.expectedKobo, address: input.address ?? null };
    });
    const mine = (await this.list(rideId, userId)).find((e) => e.id === created.id)!;
    void this.push?.toUser(created.other, {
      type: 'extension', title: 'Trip extension requested',
      body: `${created.role === 'rider' ? 'Your rider' : 'Your driver'} would like to go on${created.address ? ` to ${created.address}` : ''}. Open 9jaRide to answer.`,
      data: { rideId },
    });
    return mine;
  }

  /** The other person's answer. Accepting changes the destination and the expected fare; declining changes nothing. */
  async respond(userId: string, rideId: string, extId: string, accept: boolean, reason?: string): Promise<ExtensionView> {
    const outcome = await this.ledger.withTransaction(async (client) => {
      const { ride, role } = await this.seat(client, userId, rideId, true);
      const found = await client.query(`${ExtensionsService.SELECT} WHERE e.id = $1 AND e.ride_id = $2 FOR UPDATE OF e`, [extId, rideId]);
      const e = found.rows[0];
      if (!e) throw new NotFoundException('extension not found');
      if (e.requested_by === role) throw new ForbiddenException('The other person has to answer this request.');
      if (e.status !== 'PENDING') {
        if (e.status === (accept ? 'ACCEPTED' : 'DECLINED')) return { already: true, other: e.requester_id as string, e, ride }; // a retried tap
        throw new ConflictException({ code: 'extension_closed', message: e.status === 'EXPIRED' ? 'This request has lapsed.' : 'This request is no longer open.' });
      }
      if (Date.now() - new Date(e.created_at).getTime() > EXTENSION_ANSWER_SECONDS * 1000) {
        await client.query(`UPDATE ride_extensions SET status = 'EXPIRED', responded_at = now() WHERE id = $1`, [extId]);
        throw new ConflictException({ code: 'extension_closed', message: 'This request has lapsed.' });
      }
      if (!OPEN_STATUSES.includes(ride.status)) throw new ConflictException({ code: 'wrong_state', message: 'The trip is no longer under way.' });

      if (!accept) {
        await client.query(`UPDATE ride_extensions SET status = 'DECLINED', decline_reason = $2, responded_at = now() WHERE id = $1`, [extId, reason?.trim().slice(0, 200) || null]);
        return { already: false, other: e.requester_id as string, e: { ...e, status: 'DECLINED' }, ride, declined: true };
      }
      if (ride.payment_method === 'wallet') {
        try { await this.ledger.extendHold(client, ride.rider_id, rideId, Number(e.extra_high_kobo)); }
        catch (err) {
          if (err instanceof InsufficientFundsError) throw new ConflictException({ code: 'insufficient_funds', message: 'The wallet cannot cover the extra fare. Top up, or continue in cash.' });
          throw err;
        }
      }
      await client.query(`UPDATE rides SET dropoff = $2::geography, dropoff_address = $3, updated_at = now() WHERE id = $1`, [rideId, e.new_dropoff, e.new_address]);
      await client.query(`UPDATE ride_extensions SET status = 'ACCEPTED', responded_at = now() WHERE id = $1`, [extId]);
      await client.query(
        `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, reason) VALUES ($1, 'TRIP_STARTED', 'TRIP_STARTED', $2, $3)`,
        [rideId, userId, `Trip extended${e.new_address ? ` to ${e.new_address}` : ''}: +${(e.extra_distance_m / 1000).toFixed(1)} km, about ₦${Math.round(Number(e.extra_expected_kobo) / 100).toLocaleString('en-NG')} more`],
      );
      return { already: false, other: e.requester_id as string, e: { ...e, status: 'ACCEPTED' }, ride, accepted: true };
    });
    if (!outcome.already) {
      void this.push?.toUser(outcome.other, {
        type: 'extension',
        title: (outcome as any).accepted ? 'Trip extended' : 'Extension declined',
        body: (outcome as any).accepted ? 'The new destination is set.' : 'The trip continues to the original destination.',
        data: { rideId },
      });
    }
    return (await this.list(rideId, userId)).find((x) => x.id === extId)!;
  }

  /** The person who asked takes the question back. */
  async withdraw(userId: string, rideId: string, extId: string): Promise<ExtensionView> {
    await this.seat(this.pool, userId, rideId); // refuses a stranger
    const own = await this.pool.query(`SELECT requester_id FROM ride_extensions WHERE id = $1 AND ride_id = $2`, [extId, rideId]);
    if (!own.rows[0]) throw new NotFoundException('extension not found');
    if (own.rows[0].requester_id !== userId) throw new ForbiddenException('Only the person who asked can take the request back.');
    await this.pool.query(
      `UPDATE ride_extensions SET status = 'CANCELLED', responded_at = now() WHERE id = $1 AND ride_id = $2 AND requester_id = $3 AND status = 'PENDING'`, [extId, rideId, userId]);
    const v = (await this.list(rideId, userId)).find((x) => x.id === extId);
    if (!v) throw new NotFoundException('extension not found');
    return v;
  }

  /** The trip ended: anything still waiting for an answer no longer matters. */
  async closeOpen(rideId: string): Promise<void> {
    await this.pool.query(`UPDATE ride_extensions SET status = 'CANCELLED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
  }
}
