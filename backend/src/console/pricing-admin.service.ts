import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';

export interface PricingProposal {
  category: string;
  effectiveFrom: Date;
  baseKobo: number; perKmKobo: number; perMinuteKobo: number; waitingPerMinuteKobo: number; freeWaitingSeconds: number;
  taxKobo: number; roundingStepKobo: number; estimateLowBps: number; estimateHighBps: number;
}

/**
 * Fee changes: one admin proposes a new version with a start time, a different admin approves it. An approved version
 * can never be edited (the database enforces that), and rides already in progress keep the version they started with.
 */
@Injectable()
export class PricingAdminService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async propose(staffId: string, p: PricingProposal): Promise<{ id: string }> {
    // Far enough ahead that nobody is quoted a price that then changes under them, and never in the past.
    if (p.effectiveFrom.getTime() < Date.now() + 10 * 60_000) throw new BadRequestException('the new fees must start at least 10 minutes from now');
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, waiting_per_minute_kobo, free_waiting_seconds,
                                       tax_kobo, rounding_step_kobo, estimate_low_bps, estimate_high_bps, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [p.category, p.effectiveFrom, p.baseKobo, p.perKmKobo, p.perMinuteKobo, p.waitingPerMinuteKobo, p.freeWaitingSeconds, p.taxKobo, p.roundingStepKobo, p.estimateLowBps, p.estimateHighBps, staffId],
      );
      return { id: rows[0].id };
    } catch (e: any) {
      if (e?.code === '23503') throw new BadRequestException('unknown category');
      if (e?.code === '23505') throw new ConflictException('fees for that category already start at that exact time');
      throw e;
    }
  }

  async approve(staffId: string, id: string): Promise<void> {
    const { rows } = await this.pool.query(`SELECT created_by, approved_at, effective_from FROM pricing_versions WHERE id = $1`, [id]);
    const v = rows[0];
    if (!v) throw new NotFoundException('fee version not found');
    if (v.approved_at) throw new ConflictException({ code: 'wrong_state', message: 'that version is already approved' });
    if (v.created_by === staffId) throw new ConflictException({ code: 'same_person', message: 'a different admin must approve your change' });
    if (new Date(v.effective_from).getTime() < Date.now() + 60_000) throw new ConflictException({ code: 'too_late', message: 'its start time has passed or is about to: discard it and propose a new one' });
    await this.pool.query(`UPDATE pricing_versions SET approved_by = $2, approved_at = now() WHERE id = $1 AND approved_at IS NULL`, [id, staffId]);
  }

  async discard(id: string): Promise<void> {
    const { rowCount } = await this.pool.query(`DELETE FROM pricing_versions WHERE id = $1 AND approved_at IS NULL`, [id]);
    if (!rowCount) throw new ConflictException({ code: 'wrong_state', message: 'only a version waiting for approval can be discarded' });
  }
}
