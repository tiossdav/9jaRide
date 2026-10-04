import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../common/infra.module';

export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const PAYMENT_METHODS = ['cash', 'transfer', 'earnings', 'other'] as const;

export interface PlanTerms {
  totalKobo: number;
  depositKobo: number;
  instalmentKobo: number;
  frequency: Frequency;
  startsOn: string; // yyyy-mm-dd
  notes?: string;
}

/**
 * Everything about a plan that is worked out rather than stored, in one place, using the database's clock:
 * paid so far, still owed, how many instalments have fallen due, how far behind, and the next due date.
 * Nothing here is saved, so it can never disagree with the payment history.
 */
const PLAN_SQL = `
  WITH paid AS (
    SELECT p.*,
           COALESCE((SELECT sum(CASE WHEN pay.kind = 'reversal' THEN -pay.amount_kobo ELSE pay.amount_kobo END)
                       FROM vehicle_plan_payments pay WHERE pay.plan_id = p.id), 0)::bigint AS paid_kobo,
           COALESCE((SELECT sum(pay.amount_kobo) FROM vehicle_plan_payments pay WHERE pay.plan_id = p.id AND pay.kind = 'deposit'), 0)::bigint AS deposit_paid_kobo
      FROM vehicle_plans p
  ), due AS (
    SELECT paid.*,
           CASE WHEN current_date < starts_on THEN 0
                WHEN frequency = 'daily'   THEN (current_date - starts_on) + 1
                WHEN frequency = 'weekly'  THEN (current_date - starts_on) / 7 + 1
                ELSE (extract(year FROM age(current_date, starts_on)) * 12 + extract(month FROM age(current_date, starts_on)))::int + 1
           END AS periods_due
      FROM paid
  )
  SELECT due.*,
         GREATEST(total_kobo - paid_kobo, 0)::bigint AS outstanding_kobo,
         -- what should have been paid by today: the deposit plus every instalment that has fallen due, never more than the price
         LEAST(total_kobo, deposit_kobo + instalment_kobo * periods_due)::bigint AS expected_kobo
    FROM due`;

const FIELDS = `
  pl.id, pl.driver_id, pl.vehicle_id, pl.total_kobo, pl.deposit_kobo, pl.instalment_kobo, pl.frequency, pl.starts_on, pl.collection,
  pl.status, pl.notes, pl.created_at, pl.paid_kobo, pl.outstanding_kobo, pl.expected_kobo,
  GREATEST(pl.expected_kobo - pl.paid_kobo, 0)::bigint AS overdue_kobo,
  CASE WHEN pl.outstanding_kobo = 0 THEN NULL ELSE
    (pl.starts_on + (GREATEST(floor((pl.paid_kobo - pl.deposit_kobo)::numeric / pl.instalment_kobo), 0)::int *
      CASE pl.frequency WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END))::date
  END AS next_due_on,
  u.full_name AS driver_name, u.phone AS driver_phone, v.plate, v.make, v.colour, v.category`;

@Injectable()
export class VehiclePlansService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  static validate(t: PlanTerms): void {
    if (!Number.isInteger(t.totalKobo) || t.totalKobo <= 0) throw new BadRequestException('the vehicle price must be more than zero');
    if (!Number.isInteger(t.depositKobo) || t.depositKobo < 0 || t.depositKobo > t.totalKobo) throw new BadRequestException('the deposit cannot be more than the price');
    if (!Number.isInteger(t.instalmentKobo) || t.instalmentKobo <= 0) throw new BadRequestException('the instalment must be more than zero');
    if (t.instalmentKobo > t.totalKobo - t.depositKobo && t.totalKobo > t.depositKobo) throw new BadRequestException('the instalment is bigger than what is left to pay after the deposit');
    if (!FREQUENCIES.includes(t.frequency)) throw new BadRequestException('choose daily, weekly or monthly');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.startsOn)) throw new BadRequestException('enter the first due date');
  }

  /** Called while a platform-vehicle application is being approved, inside its transaction. */
  async createInTx(client: PoolClient, driverId: string, vehicleId: string, t: PlanTerms, staffId: string): Promise<string> {
    VehiclePlansService.validate(t);
    try {
      const { rows } = await client.query(
        `INSERT INTO vehicle_plans (driver_id, vehicle_id, total_kobo, deposit_kobo, instalment_kobo, frequency, starts_on, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [driverId, vehicleId, t.totalKobo, t.depositKobo, t.instalmentKobo, t.frequency, t.startsOn, t.notes?.trim() || null, staffId],
      );
      return rows[0].id;
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException({ code: 'plan_exists', message: 'that driver or vehicle already has a payment plan running' });
      throw e;
    }
  }

  // ------------------------------------------------------------------ reading

  private present(r: any) {
    return {
      id: r.id, status: r.status, collection: r.collection,
      driver: { id: r.driver_id, name: r.driver_name, phone: r.driver_phone },
      vehicle: { id: r.vehicle_id, plate: r.plate, make: r.make, colour: r.colour, category: r.category },
      terms: { totalKobo: Number(r.total_kobo), depositKobo: Number(r.deposit_kobo), instalmentKobo: Number(r.instalment_kobo), frequency: r.frequency, startsOn: r.starts_on, notes: r.notes },
      paidKobo: Number(r.paid_kobo), outstandingKobo: Number(r.outstanding_kobo), expectedKobo: Number(r.expected_kobo), overdueKobo: Number(r.overdue_kobo),
      nextDueOn: r.next_due_on, createdAt: r.created_at,
    };
  }

  private readonly FROM = `FROM (${PLAN_SQL}) pl JOIN users u ON u.id = pl.driver_id JOIN vehicles v ON v.id = pl.vehicle_id`;

  async list(opts: { status?: string; search?: string; page?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.status && opts.status !== 'all') { args.push(opts.status); where.push(`pl.status = $${args.length}`); }
    if (opts.search?.trim()) { args.push(`%${opts.search.trim()}%`); where.push(`(u.full_name ILIKE $${args.length} OR u.phone ILIKE $${args.length} OR v.plate ILIKE $${args.length})`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await this.pool.query(`SELECT count(*)::int AS n ${this.FROM} ${w}`, args)).rows[0].n;
    const { rows } = await this.pool.query(
      `SELECT ${FIELDS} ${this.FROM} ${w} ORDER BY (pl.status = 'defaulted') DESC, GREATEST(pl.expected_kobo - pl.paid_kobo, 0) DESC, pl.created_at DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      args,
    );
    const sums = (await this.pool.query(
      `SELECT count(*) FILTER (WHERE pl.status IN ('active','defaulted'))::int AS live,
              COALESCE(sum(pl.outstanding_kobo) FILTER (WHERE pl.status IN ('active','defaulted')), 0)::bigint AS outstanding,
              COALESCE(sum(pl.paid_kobo), 0)::bigint AS paid,
              count(*) FILTER (WHERE pl.status IN ('active','defaulted') AND pl.expected_kobo > pl.paid_kobo)::int AS behind
         ${this.FROM}`,
    )).rows[0];
    return {
      total, page, pageSize: 25,
      counts: { live: sums.live, outstandingKobo: Number(sums.outstanding), paidKobo: Number(sums.paid), behind: sums.behind },
      items: rows.map((r) => this.present(r)),
    };
  }

  async get(id: string) {
    const { rows } = await this.pool.query(`SELECT ${FIELDS} ${this.FROM} WHERE pl.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('payment plan not found');
    return { ...this.present(rows[0]), payments: await this.payments(id) };
  }

  private async payments(planId: string) {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.kind, p.amount_kobo, p.method, p.reference, p.note, p.paid_on, p.created_at, s.full_name AS recorded_by
         FROM vehicle_plan_payments p LEFT JOIN staff_users s ON s.id = p.recorded_by WHERE p.plan_id = $1 ORDER BY p.id DESC`,
      [planId],
    );
    return rows.map((p) => ({ id: Number(p.id), kind: p.kind, amountKobo: Number(p.amount_kobo), method: p.method, reference: p.reference, note: p.note, paidOn: p.paid_on, recordedAt: p.created_at, recordedBy: p.recorded_by }));
  }

  /** The driver's running plan, or the latest finished one; null if they have never had one. */
  async forDriver(driverId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${FIELDS} ${this.FROM} WHERE pl.driver_id = $1 ORDER BY (pl.status IN ('active','defaulted')) DESC, pl.created_at DESC LIMIT 1`,
      [driverId],
    );
    return rows[0] ? { ...this.present(rows[0]), payments: await this.payments(rows[0].id) } : null;
  }

  async forVehicle(vehicleId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${FIELDS} ${this.FROM} WHERE pl.vehicle_id = $1 ORDER BY (pl.status IN ('active','defaulted')) DESC, pl.created_at DESC LIMIT 1`,
      [vehicleId],
    );
    return rows[0] ? this.present(rows[0]) : null;
  }

  // ------------------------------------------------------------------ changing

  /**
   * Record money the driver paid (or take a wrong entry back with a reversal). The history is append-only, and the plan
   * row is locked so two people recording at once cannot together pay more than the price.
   */
  async recordPayment(planId: string, staffId: string, input: { kind: 'deposit' | 'instalment' | 'reversal'; amountKobo: number; method: string; reference?: string; note?: string; paidOn?: string }) {
    if (!Number.isInteger(input.amountKobo) || input.amountKobo <= 0) throw new BadRequestException('enter an amount more than zero');
    if (input.kind === 'reversal' && !input.note?.trim()) throw new BadRequestException('say why this entry is being reversed');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const plan = (await client.query(`SELECT id, status, total_kobo FROM vehicle_plans WHERE id = $1 FOR UPDATE`, [planId])).rows[0];
      if (!plan) throw new NotFoundException('payment plan not found');
      if (!['active', 'defaulted'].includes(plan.status)) throw new ConflictException({ code: 'plan_closed', message: `this plan is ${plan.status}` });
      const paid = Number((await client.query(
        `SELECT COALESCE(sum(CASE WHEN kind = 'reversal' THEN -amount_kobo ELSE amount_kobo END), 0) AS n FROM vehicle_plan_payments WHERE plan_id = $1`, [planId],
      )).rows[0].n);
      if (input.kind === 'reversal' && input.amountKobo > paid) throw new ConflictException({ code: 'too_much', message: 'that is more than has been paid so far' });
      if (input.kind !== 'reversal' && paid + input.amountKobo > Number(plan.total_kobo)) {
        throw new ConflictException({ code: 'too_much', message: `that is more than is still owed (${Number(plan.total_kobo) - paid} kobo left)` });
      }
      try {
        await client.query(
          `INSERT INTO vehicle_plan_payments (plan_id, kind, amount_kobo, method, reference, note, paid_on, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, current_date), $8)`,
          [planId, input.kind, input.amountKobo, input.method, input.reference?.trim() || null, input.note?.trim() || null, input.paidOn ?? null, staffId],
        );
      } catch (e: any) {
        if (e?.code === '23505') throw new ConflictException({ code: 'duplicate_reference', message: 'a payment with that reference is already recorded' });
        throw e;
      }
      const after = paid + (input.kind === 'reversal' ? -input.amountKobo : input.amountKobo);
      // fully paid closes the plan; a payment that brings a defaulted plan back to date is the admin's call, so it stays defaulted
      if (after >= Number(plan.total_kobo)) await client.query(`UPDATE vehicle_plans SET status = 'completed', updated_at = now() WHERE id = $1`, [planId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return this.get(planId);
  }

  /** Mark a plan defaulted, back to active, or cancelled. Cancelling frees the car and the driver for a new plan. */
  async setStatus(planId: string, status: 'active' | 'defaulted' | 'cancelled', note: string) {
    const res = await this.pool.query(
      `UPDATE vehicle_plans SET status = $2, notes = trim(both E'\\n' from COALESCE(notes, '') || E'\\n' || $3), updated_at = now()
        WHERE id = $1 AND status IN ('active', 'defaulted') AND status <> $2`,
      [planId, status, `${new Date().toISOString().slice(0, 10)}: ${status} - ${note}`],
    );
    if (res.rowCount) return this.get(planId);
    const { rows } = await this.pool.query(`SELECT status FROM vehicle_plans WHERE id = $1`, [planId]);
    if (!rows[0]) throw new NotFoundException('payment plan not found');
    throw new ConflictException({ code: 'wrong_state', message: `this plan is already ${rows[0].status}` });
  }
}
