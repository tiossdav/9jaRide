import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';

export type ExceptionSource = 'intent' | 'finding' | 'payout';
export type Resolution = 'corrected' | 'dismissed' | 'contacted_user';

export interface PaymentException {
  sourceKind: ExceptionSource;
  sourceId: string;
  kind: string;
  reference: string | null;
  detail: Record<string, unknown>;
  firstSeenAt: Date;
}

/**
 * One queue for everything money-related that needs a person: a top-up Paystack collected differently from what we
 * asked, anything the hourly reconciliation could not fix, and payouts that failed. An item leaves the queue only when
 * a person records what they decided. Resolving never moves money: corrections go through an approved adjustment.
 */
@Injectable()
export class PaymentExceptionsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listOpen(): Promise<PaymentException[]> {
    const intents = await this.pool.query(
      `SELECT i.reference, i.user_id, i.amount_kobo, i.provider_amount_kobo, i.updated_at
         FROM payment_intents i
        WHERE i.status = 'AMOUNT_MISMATCH'
          AND NOT EXISTS (SELECT 1 FROM exception_resolutions r WHERE r.source_kind = 'intent' AND r.source_id = i.reference)`,
    );
    // The same finding is written again by every hourly run until fixed: show it once, from its first sighting.
    const findings = await this.pool.query(
      `SELECT f.kind, f.reference, (array_agg(f.detail ORDER BY f.id DESC))[1] AS detail, min(f.created_at) AS first_seen
         FROM reconciliation_findings f
        WHERE NOT EXISTS (SELECT 1 FROM exception_resolutions r
                           WHERE r.source_kind = 'finding' AND r.source_id = f.kind || ':' || COALESCE(f.reference, ''))
        GROUP BY f.kind, f.reference`,
    );
    const payouts = await this.pool.query(
      `SELECT p.id, p.driver_id, p.amount_kobo, p.failure_reason, p.settled_at
         FROM payout_requests p
        WHERE p.status = 'FAILED'
          AND NOT EXISTS (SELECT 1 FROM exception_resolutions r WHERE r.source_kind = 'payout' AND r.source_id = p.id::text)`,
    );

    const out: PaymentException[] = [
      ...intents.rows.map((r) => ({
        sourceKind: 'intent' as const,
        sourceId: r.reference,
        kind: 'amount_mismatch',
        reference: r.reference,
        detail: { userId: r.user_id, expectedKobo: Number(r.amount_kobo), collectedKobo: Number(r.provider_amount_kobo) },
        firstSeenAt: r.updated_at,
      })),
      ...findings.rows.map((r) => ({
        sourceKind: 'finding' as const,
        sourceId: `${r.kind}:${r.reference ?? ''}`,
        kind: r.kind,
        reference: r.reference,
        detail: r.detail,
        firstSeenAt: r.first_seen,
      })),
      ...payouts.rows.map((r) => ({
        sourceKind: 'payout' as const,
        sourceId: r.id,
        kind: 'payout_failed',
        reference: r.id,
        detail: { driverId: r.driver_id, amountKobo: Number(r.amount_kobo), reason: r.failure_reason, refunded: true },
        firstSeenAt: r.settled_at,
      })),
    ];
    return out.sort((a, b) => new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime());
  }

  /** Record the decision. 'corrected' must point at an adjustment that has actually been posted. */
  async resolve(
    staffId: string,
    input: { sourceKind: ExceptionSource; sourceId: string; resolution: Resolution; note: string; adjustmentId?: string },
  ): Promise<void> {
    if (input.resolution === 'corrected') {
      if (!input.adjustmentId) throw new BadRequestException('"corrected" needs the adjustment that corrected it');
      const adj = await this.pool.query(`SELECT status FROM ledger_adjustments WHERE id = $1`, [input.adjustmentId]);
      if (!adj.rows[0]) throw new NotFoundException('adjustment not found');
      if (adj.rows[0].status !== 'POSTED') throw new ConflictException({ code: 'adjustment_not_posted', message: 'that adjustment has not been approved and posted yet' });
    }
    // The item must be one we know about, so a typo cannot silently "resolve" nothing.
    const known = await this.pool.query(
      input.sourceKind === 'intent'
        ? `SELECT 1 FROM payment_intents WHERE reference = $1`
        : input.sourceKind === 'payout'
          ? `SELECT 1 FROM payout_requests WHERE id::text = $1`
          : `SELECT 1 FROM reconciliation_findings WHERE kind || ':' || COALESCE(reference, '') = $1 LIMIT 1`,
      [input.sourceId],
    );
    if (!known.rowCount) throw new NotFoundException('no such exception');

    try {
      await this.pool.query(
        `INSERT INTO exception_resolutions (source_kind, source_id, resolution, note, adjustment_id, resolved_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.sourceKind, input.sourceId, input.resolution, input.note, input.adjustmentId ?? null, staffId],
      );
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException({ code: 'already_resolved', message: 'someone already resolved this' });
      throw e;
    }
  }
}
