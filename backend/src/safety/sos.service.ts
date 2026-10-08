import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import {
  CALL_ESCALATOR,
  CallEscalator,
  SMS_SENDER,
  SOS_ACK_NOTIFIER,
  SOS_ESCALATION_SECONDS,
  STAFF_ALERTER,
  SmsSender,
  SosAckNotifier,
  SosInput,
  SosStored,
  StaffAlerter,
} from './safety.types';

@Injectable()
export class SosService {
  private readonly log = new Logger(SosService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(STAFF_ALERTER) private readonly staff: StaffAlerter,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(CALL_ESCALATOR) private readonly caller: CallEscalator,
    @Inject(SOS_ACK_NOTIFIER) private readonly ackNotifier: SosAckNotifier,
  ) {}

  /**
   * Store the alert FIRST, then notify. The returned value is the "received" confirmation: the app must
   * show "SOS sent" only after this resolves, never on tap (spec: the current text is premature).
   * Staff alerting is best-effort and can never undo or block storing.
   */
  async raise(input: SosInput): Promise<SosStored> {
    const stored = await this.store(input);
    if (!stored.duplicate) {
      // Past this point nothing may throw back to the caller: the alert is already safe in Postgres.
      await this.notifyStaff(stored.id).catch((e) => this.log.error(`staff notification failed for ${stored.id}: ${e}`));
    }
    return stored;
  }

  private async store(input: SosInput): Promise<SosStored> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Resolve context on the server: the active ride and vehicle come from our data, not from the request.
      const ride = await client.query(
        input.role === 'driver'
          ? `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_TRANSIT') ORDER BY created_at DESC LIMIT 1`
          : `SELECT id FROM rides WHERE rider_id = $1 AND status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_TRANSIT') ORDER BY created_at DESC LIMIT 1`,
        [input.userId],
      );
      const rideId: string | null = ride.rows[0]?.id ?? null;

      const vehicle = await client.query(
        input.role === 'driver'
          ? `SELECT id FROM vehicles WHERE driver_id = $1 AND active LIMIT 1`
          : `SELECT v.id FROM rides r JOIN vehicles v ON v.driver_id = r.driver_id AND v.active WHERE r.id = $1`,
        [input.role === 'driver' ? input.userId : rideId],
      );
      const vehicleId: string | null = vehicle.rows[0]?.id ?? null;

      const loc = input.location;
      const inserted = await client.query(
        `INSERT INTO sos_events (idempotency_key, raised_by, raised_by_role, ride_id, vehicle_id, location, location_accuracy_m)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END,
                 $8)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [input.idempotencyKey, input.userId, input.role, rideId, vehicleId, loc?.lat ?? null, loc?.lng ?? null, loc?.accuracyM ?? null],
      );

      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        const existing = await this.pool.query('SELECT id FROM sos_events WHERE idempotency_key = $1', [input.idempotencyKey]);
        return { id: existing.rows[0].id, stored: true, duplicate: true };
      }

      const id = inserted.rows[0].id as string;
      await client.query(`INSERT INTO sos_timeline (sos_id, kind, actor_id, detail) VALUES ($1, 'created', $2, $3)`, [
        id, input.userId, JSON.stringify({ role: input.role, rideId, vehicleId, location: loc ?? null }),
      ]);
      await client.query('COMMIT');
      return { id, stored: true, duplicate: false };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Channel 1: live alert in the admin portal. Channel 2: SMS to the on-call phone. Each recorded on the timeline. */
  private async notifyStaff(id: string): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT raised_by_role, ride_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM sos_events WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    const results = await Promise.allSettled([
      this.staff.newSos({ id, role: row.raised_by_role, rideId: row.ride_id, lat: row.lat ?? undefined, lng: row.lng ?? undefined }),
      process.env.ONCALL_PHONE
        ? this.sms.send(process.env.ONCALL_PHONE, `9jaRide SOS ${id.slice(0, 8)} from a ${row.raised_by_role}. Open the Safety Center.`)
        : Promise.resolve(),
    ]);
    const [staffRes, smsRes] = results;
    if (smsRes.status === 'fulfilled' && process.env.ONCALL_PHONE) await this.timeline(id, 'sms_sent', null, {});
    for (const [name, r] of [['staff', staffRes], ['sms', smsRes]] as const) {
      if (r.status === 'rejected') this.log.error(`SOS ${id}: ${name} channel failed: ${r.reason}`);
    }
  }

  // ------------------------------------------------------------------ staff actions

  /** First acknowledgement wins; the person who raised the SOS is told. Re-acknowledging is a no-op. */
  async acknowledge(sosId: string, staffId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE sos_events SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
        WHERE id = $1 AND status = 'OPEN' RETURNING raised_by`,
      [sosId, staffId],
    );
    if (!rows[0]) return false;
    await this.timeline(sosId, 'acknowledged', staffId, {});
    await this.ackNotifier.acknowledged(rows[0].raised_by, sosId).catch((e) => this.log.error(`ack notify failed: ${e}`));
    return true;
  }

  async assign(sosId: string, staffId: string, assigneeId: string): Promise<void> {
    await this.pool.query(`UPDATE sos_events SET assigned_to = $2 WHERE id = $1 AND status <> 'RESOLVED'`, [sosId, assigneeId]);
    await this.timeline(sosId, 'assigned', staffId, { assigneeId });
  }

  /** Staff note or call-back log entry, for the evidence timeline. */
  async addNote(sosId: string, staffId: string, kind: 'note' | 'callback', detail: Record<string, unknown>): Promise<void> {
    await this.timeline(sosId, kind, staffId, detail);
  }

  async resolve(sosId: string, staffId: string, outcome: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE sos_events SET status = 'RESOLVED', resolved_at = now() WHERE id = $1 AND status <> 'RESOLVED'`,
      [sosId],
    );
    if (!res.rowCount) return false;
    await this.timeline(sosId, 'resolved', staffId, { outcome });
    return true;
  }

  /** Latest position while the alert is open, so staff see where the person is now, not only where they pressed. */
  async appendLocation(sosId: string, userId: string, loc: { lat: number; lng: number; accuracyM?: number }): Promise<void> {
    const res = await this.pool.query(
      `UPDATE sos_events SET location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, location_accuracy_m = $4
        WHERE id = $1 AND raised_by = $5 AND status <> 'RESOLVED'`,
      [sosId, loc.lat, loc.lng, loc.accuracyM ?? null, userId],
    );
    if (res.rowCount) await this.timeline(sosId, 'location', userId, loc);
  }

  /** Staff queue: open alerts first, oldest first. */
  async listActive() {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.status, s.raised_by_role, s.ride_id, s.created_at, s.acknowledged_at, s.escalated_at, s.assigned_to,
              ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng
         FROM sos_events s WHERE s.status <> 'RESOLVED'
         ORDER BY (s.status = 'OPEN') DESC, s.created_at ASC`,
    );
    return rows;
  }

  async getTimeline(sosId: string) {
    const { rows } = await this.pool.query(
      `SELECT kind, actor_id, detail, created_at FROM sos_timeline WHERE sos_id = $1 ORDER BY created_at, id`,
      [sosId],
    );
    return rows;
  }

  // ------------------------------------------------------------------ escalation

  /**
   * Run every few seconds by the worker. An SOS still OPEN after 60 s phones the on-call person, around the clock.
   * The UPDATE claims each alert exactly once, so several workers cannot call twice.
   */
  async escalateUnacknowledged(): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE sos_events SET escalated_at = now()
        WHERE status = 'OPEN' AND escalated_at IS NULL AND created_at <= now() - make_interval(secs => $1)
        RETURNING id`,
      [SOS_ESCALATION_SECONDS],
    );
    for (const { id } of rows) {
      await this.timeline(id, 'escalated', null, { afterSeconds: SOS_ESCALATION_SECONDS });
      const phone = process.env.ONCALL_PHONE;
      if (!phone) {
        this.log.error(`SOS ${id} unacknowledged after ${SOS_ESCALATION_SECONDS}s and ONCALL_PHONE is not set`);
        continue;
      }
      await this.caller.call(phone, id).catch((e) => this.log.error(`escalation call failed for ${id}: ${e}`));
    }
    return rows.length;
  }

  private async timeline(sosId: string, kind: string, actorId: string | null, detail: unknown): Promise<void> {
    await this.pool.query(`INSERT INTO sos_timeline (sos_id, kind, actor_id, detail) VALUES ($1, $2, $3, $4)`, [
      sosId, kind, actorId, JSON.stringify(detail ?? {}),
    ]);
  }
}
