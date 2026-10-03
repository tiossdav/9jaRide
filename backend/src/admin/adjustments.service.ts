import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { Pool } from 'pg';
import { Role } from '../auth/auth.types';
import { Posting, planAdjustmentCredit, planAdjustmentDebit, planTopUp } from '../ledger/postings';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payments.types';
import { SelfApprovalError } from '../payments/payouts.service';

export type AdjustmentKind = 'refund' | 'credit' | 'debit' | 'topup_correction';

/** Above this, the approver must be an admin, not just finance. Placeholder until finance sets a limit. */
export const ADJUSTMENT_ADMIN_THRESHOLD_KOBO = Number(process.env.ADJUSTMENT_ADMIN_THRESHOLD_KOBO ?? 5_000_000); // ₦50,000

export interface AdjustmentRequest {
  kind: AdjustmentKind;
  userId: string;
  amountKobo: number;
  reason: string;
  idempotencyKey: string;
  requestedBy: string;
  rideId?: string;
  providerReference?: string;
}

const COLUMNS = `id, kind, user_id, ride_id, provider_reference, amount_kobo, reason, status, requested_by, approved_by,
  approved_at, rejected_by, rejected_reason, created_at, settled_at`;

@Injectable()
export class AdjustmentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
  ) {}

  private present(r: any) {
    return {
      id: r.id,
      kind: r.kind,
      userId: r.user_id,
      rideId: r.ride_id,
      providerReference: r.provider_reference,
      amountKobo: Number(r.amount_kobo),
      reason: r.reason,
      status: r.status,
      requestedBy: r.requested_by,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      rejectedBy: r.rejected_by,
      rejectedReason: r.rejected_reason,
      createdAt: r.created_at,
      settledAt: r.settled_at,
    };
  }

  /**
   * Ask for a manual money movement. Nothing moves until a different person approves. The checks that can be made now
   * are made now (a refund cannot exceed the fare; a correction cannot repeat), so a bad request fails early.
   */
  async request(input: AdjustmentRequest): Promise<{ id: string; duplicate: boolean }> {
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) throw new RangeError('amount must be a positive whole number of kobo');
    if (input.kind === 'refund' && !input.rideId) throw new BadRequestException('a refund needs the ride it is for');
    if (input.kind === 'topup_correction' && !input.providerReference) throw new BadRequestException('a top-up correction needs the Paystack reference');

    return this.ledger.withTransaction(async (client) => {
      const user = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
      if (!user.rowCount) throw new NotFoundException('user not found');

      if (input.kind === 'refund') {
        // Lock the ride so two simultaneous refunds cannot together exceed what the rider paid.
        const ride = await client.query(
          `SELECT r.rider_id, f.total_kobo FROM rides r JOIN ride_fares f ON f.ride_id = r.id
            WHERE r.id = $1 AND r.status = 'TRIP_COMPLETED' FOR UPDATE OF r`,
          [input.rideId],
        );
        if (!ride.rows[0]) throw new BadRequestException('that ride is not a completed, priced ride');
        if (ride.rows[0].rider_id !== input.userId) throw new BadRequestException('that ride belongs to a different rider');
        const already = await client.query(
          `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS n FROM ledger_adjustments
            WHERE ride_id = $1 AND kind = 'refund' AND status <> 'REJECTED' AND idempotency_key <> $2`,
          [input.rideId, input.idempotencyKey],
        );
        const room = Number(ride.rows[0].total_kobo) - Number(already.rows[0].n);
        if (input.amountKobo > room) throw new ConflictException({ code: 'refund_exceeds_fare', message: `at most ${room} kobo can still be refunded for this ride` });
      }

      const inserted = await client.query(
        `INSERT INTO ledger_adjustments (kind, user_id, ride_id, provider_reference, amount_kobo, reason, idempotency_key, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [input.kind, input.userId, input.rideId ?? null, input.providerReference ?? null, input.amountKobo, input.reason, input.idempotencyKey, input.requestedBy],
      ).catch((e: any) => {
        if (e?.code === '23505') throw new ConflictException({ code: 'already_requested', message: 'that Paystack payment already has a correction' });
        throw e;
      });
      if (inserted.rowCount) return { id: inserted.rows[0].id as string, duplicate: false };

      const existing = await client.query(`SELECT id, user_id, amount_kobo, kind FROM ledger_adjustments WHERE idempotency_key = $1`, [input.idempotencyKey]);
      const row = existing.rows[0];
      if (row.user_id !== input.userId || Number(row.amount_kobo) !== input.amountKobo || row.kind !== input.kind) {
        throw new ConflictException('idempotency key was already used for a different adjustment');
      }
      return { id: row.id as string, duplicate: true };
    });
  }

  /**
   * Approve and post, in one transaction. The approver must be a different person; large amounts need an admin.
   * A top-up correction is checked against Paystack at this moment: the payment must really have succeeded for
   * exactly this amount, and its ledger key is the normal top-up key, so the same payment can never be credited twice.
   */
  async approve(id: string, approverId: string, approverRole: Role): Promise<boolean> {
    const peek = await this.pool.query(`SELECT * FROM ledger_adjustments WHERE id = $1`, [id]);
    const a = peek.rows[0];
    if (!a) throw new NotFoundException('adjustment not found');
    if (a.requested_by === approverId) throw new SelfApprovalError('manual adjustment');
    if (Number(a.amount_kobo) > ADJUSTMENT_ADMIN_THRESHOLD_KOBO && approverRole !== 'admin') {
      throw new ForbiddenException({ code: 'admin_required', message: 'an admin must approve amounts this large' });
    }
    if (a.status === 'POSTED') return false;
    if (a.status !== 'PENDING_APPROVAL') throw new ConflictException(`adjustment is ${a.status}`);

    if (a.kind === 'topup_correction') {
      const tx = await this.provider.verifyTransaction(a.provider_reference); // network call, kept outside the DB transaction
      if (!tx || tx.status !== 'success' || tx.currency !== 'NGN' || tx.amountKobo !== Number(a.amount_kobo)) {
        throw new ConflictException({ code: 'provider_mismatch', message: 'Paystack does not show a successful payment for exactly this amount' });
      }
    }

    return this.ledger.withTransaction(async (client) => {
      const locked = await client.query(
        `UPDATE ledger_adjustments SET status = 'POSTED', approved_by = $2, approved_at = now(), settled_at = now()
          WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING *`,
        [id, approverId],
      );
      if (!locked.rowCount) return false; // someone else decided it first
      const row = locked.rows[0];
      await this.ledger.ensureWallet(client, row.user_id);

      const amount = Number(row.amount_kobo);
      let postings: Posting[];
      let idempotencyKey = `adjustment:${row.id}`;
      let allowNegative: string[] = [];
      switch (row.kind as AdjustmentKind) {
        case 'refund':
        case 'credit':
          postings = planAdjustmentCredit(row.user_id, amount);
          break;
        case 'debit': {
          postings = planAdjustmentDebit(row.user_id, amount);
          // A driver's wallet can hold commission debt; recovering it may take the balance below zero. Riders cannot go negative.
          const role = (await client.query(`SELECT role FROM users WHERE id = $1`, [row.user_id])).rows[0].role;
          if (role === 'driver') allowNegative = [postings[0].account];
          break;
        }
        case 'topup_correction':
          postings = planTopUp(row.user_id, amount);
          idempotencyKey = `topup:${row.provider_reference}`;
          break;
      }
      const posted = await this.ledger.post(
        client,
        { kind: `adjustment_${row.kind}`, reference: row.provider_reference ?? row.ride_id ?? row.id, idempotencyKey, postings, memo: row.reason },
        { allowNegative },
      );
      if (!posted) {
        // Only a top-up correction can land here: the payment was already credited by the normal flow.
        throw new ConflictException({ code: 'already_credited', message: 'that payment has already been credited to a wallet' });
      }
      if (row.kind === 'topup_correction') {
        await client.query(
          `UPDATE payment_intents SET status = 'SUCCESS', credited_at = now(), updated_at = now()
            WHERE reference = $1 AND status <> 'SUCCESS'`,
          [row.provider_reference],
        );
      }
      return true;
    });
  }

  async reject(id: string, staffId: string, reason: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE ledger_adjustments SET status = 'REJECTED', rejected_by = $2, rejected_reason = $3, settled_at = now()
        WHERE id = $1 AND status = 'PENDING_APPROVAL'`,
      [id, staffId, reason],
    );
    if (res.rowCount) return true;
    const { rows } = await this.pool.query(`SELECT 1 FROM ledger_adjustments WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('adjustment not found');
    return false;
  }

  async get(id: string) {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM ledger_adjustments WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('adjustment not found');
    return this.present(rows[0]);
  }

  async list(status?: string) {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM ledger_adjustments WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 200`,
      [status ?? null],
    );
    return rows.map((r) => this.present(r));
  }
}
