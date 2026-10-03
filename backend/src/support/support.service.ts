import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { shortCode } from '../common/short-code';

export const TOPICS = ['trip', 'payment', 'safety', 'account', 'app', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

@Injectable()
export class SupportService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // ------------------------------------------------------------------ riders and drivers

  /** A problem report from an app. Sending it twice (a bad network, a double tap) makes one ticket. */
  async raise(userId: string, role: 'rider' | 'driver', key: string, input: { topic: Topic; message: string; rideId?: string }): Promise<{ id: string; code: string }> {
    if (input.rideId) {
      const ride = await this.pool.query(`SELECT 1 FROM rides WHERE id = $1 AND (rider_id = $2 OR driver_id = $2)`, [input.rideId, userId]);
      if (!ride.rowCount) throw new NotFoundException('that trip is not yours');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO support_tickets (short_code, raised_by, raised_role, ride_id, topic, message, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (raised_by, idempotency_key) DO UPDATE SET updated_at = support_tickets.updated_at RETURNING id, short_code`,
          [shortCode(), userId, role, input.rideId ?? null, input.topic, input.message.trim(), key],
        );
        return { id: rows[0].id, code: rows[0].short_code };
      } catch (e: any) {
        if (e?.code === '23505' && String(e.constraint).includes('short_code')) continue; // a code clash: try another
        throw e;
      }
    }
    throw new ConflictException('could not make a ticket number, try again');
  }

  async mine(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, short_code, topic, message, status, resolution, created_at, resolved_at FROM support_tickets WHERE raised_by = $1 ORDER BY created_at DESC LIMIT 50`, [userId],
    );
    return rows.map((t) => ({ id: t.id, code: t.short_code, topic: t.topic, message: t.message, status: t.status, resolution: t.resolution, createdAt: t.created_at, resolvedAt: t.resolved_at }));
  }

  // ------------------------------------------------------------------ staff

  async queue(q: { status?: string; search?: string }) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q.status) { params.push(q.status); where += ` AND t.status = $${params.length}`; }
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); where += ` AND (t.short_code ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR t.message ILIKE $${params.length})`; }
    const [counts] = (await this.pool.query(
      `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress, count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at)) FILTER (WHERE resolved_at IS NOT NULL AND created_at > now() - interval '30 days'), NULL)::int AS median_s
         FROM support_tickets`,
    )).rows;
    const { rows } = await this.pool.query(
      `SELECT t.id, t.short_code, t.topic, t.message, t.status, t.raised_role, t.created_at, u.full_name, s.full_name AS assignee
         FROM support_tickets t JOIN users u ON u.id = t.raised_by LEFT JOIN staff_users s ON s.id = t.assigned_to
        WHERE ${where} ORDER BY (t.status = 'RESOLVED'), t.created_at LIMIT 200`, params,
    );
    return {
      counts: { open: counts.open, inProgress: counts.in_progress, resolved: counts.resolved, medianResolveSeconds: counts.median_s },
      items: rows.map((t) => ({ id: t.id, code: t.short_code, topic: t.topic, message: t.message, status: t.status, role: t.raised_role, person: t.full_name, assignee: t.assignee, createdAt: t.created_at })),
    };
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT t.*, u.full_name, u.phone, s.full_name AS assignee, r.short_code AS ride_code
         FROM support_tickets t JOIN users u ON u.id = t.raised_by LEFT JOIN staff_users s ON s.id = t.assigned_to LEFT JOIN rides r ON r.id = t.ride_id WHERE t.id = $1`, [id],
    );
    const t = rows[0];
    if (!t) throw new NotFoundException('ticket not found');
    const notes = await this.pool.query(`SELECT n.body, n.created_at, s.full_name FROM support_notes n LEFT JOIN staff_users s ON s.id = n.staff_id WHERE n.ticket_id = $1 ORDER BY n.id`, [id]);
    return {
      id: t.id, code: t.short_code, topic: t.topic, message: t.message, status: t.status, resolution: t.resolution, role: t.raised_role, createdAt: t.created_at, resolvedAt: t.resolved_at,
      person: { id: t.raised_by, name: t.full_name, phone: t.phone }, assignee: t.assignee, ride: t.ride_id ? { id: t.ride_id, code: t.ride_code } : null,
      notes: notes.rows.map((n) => ({ body: n.body, at: n.created_at, by: n.full_name })),
    };
  }

  /** Taking a ticket marks it in progress. Two people cannot take the same one: the second is told who has it. */
  async take(staffId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE support_tickets SET assigned_to = $2, status = 'IN_PROGRESS', updated_at = now() WHERE id = $1 AND status <> 'RESOLVED' AND (assigned_to IS NULL OR assigned_to = $2)`, [id, staffId],
    );
    if (rowCount) return;
    const t = await this.pool.query(`SELECT s.full_name, t.status FROM support_tickets t LEFT JOIN staff_users s ON s.id = t.assigned_to WHERE t.id = $1`, [id]);
    if (!t.rows[0]) throw new NotFoundException('ticket not found');
    if (t.rows[0].status === 'RESOLVED') throw new ConflictException({ code: 'wrong_state', message: 'that ticket is already resolved' });
    throw new ConflictException({ code: 'taken', message: `${t.rows[0].full_name ?? 'Someone else'} is already handling this ticket` });
  }

  async addNote(staffId: string, id: string, body: string): Promise<void> {
    if (!body.trim()) throw new BadRequestException('write something first');
    const exists = await this.pool.query(`SELECT 1 FROM support_tickets WHERE id = $1`, [id]);
    if (!exists.rowCount) throw new NotFoundException('ticket not found');
    await this.pool.query(`INSERT INTO support_notes (ticket_id, staff_id, body) VALUES ($1, $2, $3)`, [id, staffId, body.trim()]);
    await this.pool.query(`UPDATE support_tickets SET updated_at = now() WHERE id = $1`, [id]);
  }

  /** Resolve with a message the person sees in their app; or reopen a ticket that was closed too soon. */
  async setStatus(staffId: string, id: string, status: 'RESOLVED' | 'OPEN', resolution?: string): Promise<void> {
    if (status === 'RESOLVED') {
      if (!resolution || resolution.trim().length < 3) throw new BadRequestException('say what was done: the person sees this in their app');
      const { rowCount } = await this.pool.query(
        `UPDATE support_tickets SET status = 'RESOLVED', resolution = $2, resolved_at = now(), assigned_to = COALESCE(assigned_to, $3), updated_at = now() WHERE id = $1 AND status <> 'RESOLVED'`, [id, resolution.trim(), staffId],
      );
      if (!rowCount) throw new ConflictException({ code: 'wrong_state', message: 'that ticket is already resolved, or does not exist' });
      return;
    }
    const { rowCount } = await this.pool.query(`UPDATE support_tickets SET status = 'OPEN', resolution = NULL, resolved_at = NULL, assigned_to = NULL, updated_at = now() WHERE id = $1 AND status = 'RESOLVED'`, [id]);
    if (!rowCount) throw new ConflictException({ code: 'wrong_state', message: 'only a resolved ticket can be reopened' });
  }
}
