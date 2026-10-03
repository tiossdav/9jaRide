import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { suspendedKey } from '../auth/auth.guard';
import { ACCESS_TOKEN_SECONDS } from '../auth/auth.types';
import { TokensService } from '../auth/tokens.service';
import { PG_POOL, REDIS } from '../common/infra.module';
import { keys } from '../dispatch/dispatch.types';

export const DOCUMENT_KINDS = ['drivers_licence', 'vehicle_papers', 'insurance', 'road_worthiness', 'selfie'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** Must be present, and not expired, to approve. Placeholder list until operations decides. */
export const REQUIRED_DOCUMENTS: DocumentKind[] = (process.env.REQUIRED_DOCUMENTS?.split(',') as DocumentKind[]) ?? ['drivers_licence', 'vehicle_papers', 'insurance'];
const NEEDS_EXPIRY: DocumentKind[] = ['drivers_licence', 'insurance', 'road_worthiness'];

export interface ApplicationInput {
  vehicle: { category: string; make: string; colour: string; plate: string };
  documents: { kind: DocumentKind; fileRef: string; expiresOn?: string }[];
}

const normalisePlate = (p: string) => p.toUpperCase().replace(/[\s-]/g, '');

@Injectable()
export class DriverApplicationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: TokensService,
  ) {}

  // ------------------------------------------------------------------ driver side

  /** Submit, or resubmit after staff asked for changes. A driver can have one open application at a time. */
  async submit(driverId: string, input: ApplicationInput): Promise<{ id: string }> {
    const plate = normalisePlate(input.vehicle.plate);
    if (!/^[A-Z0-9]{5,10}$/.test(plate)) throw new BadRequestException('enter the number plate letters and digits only');
    const kinds = new Set<string>();
    for (const d of input.documents) {
      if (kinds.has(d.kind)) throw new BadRequestException(`document ${d.kind} was sent twice`);
      kinds.add(d.kind);
      if (NEEDS_EXPIRY.includes(d.kind) && !d.expiresOn) throw new BadRequestException(`${d.kind} needs an expiry date`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query(`SELECT role, status FROM users WHERE id = $1 FOR UPDATE`, [driverId]);
      if (user.rows[0]?.role !== 'driver') throw new BadRequestException('only drivers can apply');

      const open = await client.query(
        `SELECT id, status FROM driver_applications WHERE driver_id = $1 AND status IN ('SUBMITTED', 'CHANGES_REQUESTED')`,
        [driverId],
      );
      let id: string;
      if (open.rows[0]) {
        if (open.rows[0].status === 'SUBMITTED') throw new ConflictException({ code: 'application_pending', message: 'your application is already being reviewed' });
        id = open.rows[0].id;
        await client.query(
          `UPDATE driver_applications SET status = 'SUBMITTED', vehicle_category = $2, vehicle_make = $3, vehicle_colour = $4,
                  vehicle_plate = $5, submitted_at = now(), updated_at = now() WHERE id = $1`,
          [id, input.vehicle.category, input.vehicle.make.trim(), input.vehicle.colour.trim(), plate],
        );
        await client.query(`DELETE FROM application_documents WHERE application_id = $1`, [id]);
      } else {
        const created = await client.query(
          `INSERT INTO driver_applications (driver_id, vehicle_category, vehicle_make, vehicle_colour, vehicle_plate)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [driverId, input.vehicle.category, input.vehicle.make.trim(), input.vehicle.colour.trim(), plate],
        );
        id = created.rows[0].id;
      }
      for (const d of input.documents) {
        await client.query(`INSERT INTO application_documents (application_id, kind, file_ref, expires_on) VALUES ($1, $2, $3, $4)`, [
          id, d.kind, d.fileRef, d.expiresOn ?? null,
        ]);
      }
      await client.query('COMMIT');
      return { id };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** The driver's most recent application and what staff said about it. */
  async mine(driverId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, status, vehicle_category, vehicle_make, vehicle_colour, vehicle_plate, review_note, submitted_at, reviewed_at
         FROM driver_applications WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [driverId],
    );
    return rows[0] ? this.presentSummary(rows[0]) : null;
  }

  // ------------------------------------------------------------------ staff side

  private presentSummary(r: any) {
    return {
      id: r.id,
      driverId: r.driver_id,
      status: r.status,
      vehicle: { category: r.vehicle_category, make: r.vehicle_make, colour: r.vehicle_colour, plate: r.vehicle_plate },
      reviewNote: r.review_note,
      submittedAt: r.submitted_at,
      reviewedAt: r.reviewed_at,
    };
  }

  async queue(status = 'SUBMITTED') {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.full_name, u.phone FROM driver_applications a JOIN users u ON u.id = a.driver_id
        WHERE a.status = $1 ORDER BY a.submitted_at LIMIT 200`,
      [status],
    );
    return rows.map((r) => ({ ...this.presentSummary(r), driverName: r.full_name, phone: r.phone }));
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.full_name, u.phone, u.status AS user_status FROM driver_applications a JOIN users u ON u.id = a.driver_id WHERE a.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('application not found');
    const docs = await this.pool.query(
      `SELECT kind, file_ref, expires_on, expires_on < current_date AS expired FROM application_documents WHERE application_id = $1 ORDER BY kind`,
      [id],
    );
    return {
      ...this.presentSummary(rows[0]),
      driverName: rows[0].full_name,
      phone: rows[0].phone,
      accountStatus: rows[0].user_status,
      documents: docs.rows.map((d) => ({ kind: d.kind, fileRef: d.file_ref, expiresOn: d.expires_on, expired: d.expired })),
      missingDocuments: REQUIRED_DOCUMENTS.filter((k) => !docs.rows.some((d) => d.kind === k)),
    };
  }

  /**
   * Approve: every required document must be present and unexpired. This is what creates the driver's vehicle, so a
   * driver cannot reach dispatch without passing review. A plate already on another active vehicle blocks approval.
   */
  async approve(id: string, staffId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const app = (await client.query(`SELECT * FROM driver_applications WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!app) throw new NotFoundException('application not found');
      if (app.status !== 'SUBMITTED') throw new ConflictException({ code: 'wrong_state', message: `application is ${app.status}` });

      const docs = (
        await client.query(`SELECT kind, expires_on < current_date AS expired FROM application_documents WHERE application_id = $1`, [id])
      ).rows;
      const problems = [
        ...REQUIRED_DOCUMENTS.filter((k) => !docs.some((d) => d.kind === k)).map((k) => `${k} is missing`),
        ...docs.filter((d) => d.expired).map((d) => `${d.kind} has expired`),
      ];
      if (problems.length) throw new ConflictException({ code: 'documents_not_ready', message: problems.join('; ') });

      const cat = await client.query(`SELECT active FROM asset_types WHERE code = $1`, [app.vehicle_category]);
      if (!cat.rows[0]?.active) throw new ConflictException({ code: 'category_off', message: 'that vehicle category is switched off' });
      await client.query(`UPDATE vehicles SET active = false WHERE driver_id = $1 AND active`, [app.driver_id]);
      try {
        await client.query(
          `INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, $2, $3, $4, $5)`,
          [app.driver_id, app.vehicle_category, app.vehicle_make, app.vehicle_colour, app.vehicle_plate],
        );
      } catch (e: any) {
        if (e?.code === '23505') throw new ConflictException({ code: 'plate_in_use', message: 'that number plate is registered to another driver' });
        throw e;
      }
      await client.query(
        `UPDATE driver_applications SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now(), updated_at = now() WHERE id = $1`,
        [id, staffId],
      );
      await client.query('COMMIT');
      await this.redis.del(`driver:${app.driver_id}:category`); // pick up the new vehicle on the next ping
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private async decide(id: string, staffId: string, status: 'REJECTED' | 'CHANGES_REQUESTED', note: string) {
    const res = await this.pool.query(
      `UPDATE driver_applications SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'SUBMITTED'`,
      [id, status, note, staffId],
    );
    if (res.rowCount) return;
    const { rows } = await this.pool.query(`SELECT status FROM driver_applications WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('application not found');
    throw new ConflictException({ code: 'wrong_state', message: `application is ${rows[0].status}` });
  }

  reject(id: string, staffId: string, reason: string) {
    return this.decide(id, staffId, 'REJECTED', reason);
  }

  requestChanges(id: string, staffId: string, note: string) {
    return this.decide(id, staffId, 'CHANGES_REQUESTED', note);
  }

  // ------------------------------------------------------------------ account status

  /** Stop an account at once: no new sign-ins, sessions revoked, and a driver leaves the map. */
  async setAccountStatus(userId: string, staffId: string, status: 'active' | 'suspended', reason: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(`UPDATE users SET status = $2 WHERE id = $1 AND status <> $2 RETURNING role`, [userId, status]);
      if (!res.rowCount) {
        await client.query('ROLLBACK');
        const exists = await this.pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
        if (!exists.rowCount) throw new NotFoundException('user not found');
        return false; // already in that state
      }
      await client.query(`INSERT INTO user_status_events (user_id, status, reason, actor_id) VALUES ($1, $2, $3, $4)`, [userId, status, reason, staffId]);
      await client.query('COMMIT');
      if (status === 'active') await this.redis.del(suspendedKey(userId));
      if (status === 'suspended') {
        await this.redis.set(suspendedKey(userId), '1', 'EX', ACCESS_TOKEN_SECONDS + 60);
        await this.tokens.revokeAll('user', userId);
        await this.redis.del(`driver:${userId}:category`, keys.driverState(userId));
        await this.redis.zrem(keys.geo('regular'), userId);
        await this.redis.zrem(keys.geo('comfort'), userId);
        await this.redis.zrem(keys.geo('package'), userId);
      }
      return true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
