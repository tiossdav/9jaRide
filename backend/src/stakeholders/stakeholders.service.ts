import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { RevenueRules } from '../settings/settings.types';

export interface Ownership { name: string; accruedKobo: number; paidKobo: number; pendingKobo: number; availableKobo: number }

/**
 * Who is owed what from the platform's commission. Each trip's commission is shared using the Revenue Setup that was in
 * force when the trip was booked; what has been paid or is waiting is taken off. Paying out moves the money in the ledger.
 */
@Injectable()
export class StakeholdersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly ledger: LedgerService) {}

  /** Commission earned per revenue-rules version, so each trip is shared by the rule that applied to it. */
  private async accrual(): Promise<Map<string, number>> {
    const { rows: versions } = await this.pool.query(
      `SELECT value, effective_from FROM setting_versions WHERE key = 'revenue' AND approved_at IS NOT NULL ORDER BY effective_from`,
    );
    const owed = new Map<string, number>();
    for (let i = 0; i < versions.length; i++) {
      const from = versions[i].effective_from;
      const to = versions[i + 1]?.effective_from ?? null;
      // Commission is credited to platform:commission by each completed trip; the trip's booking time picks the version.
      const { rows } = await this.pool.query(
        `SELECT COALESCE(SUM(e.amount_kobo), 0)::bigint AS kobo
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id AND a.code = 'platform:commission'
           JOIN ledger_transactions t ON t.id = e.transaction_id AND t.kind IN ('trip_wallet', 'trip_cash')
           JOIN rides r ON r.id::text = t.reference
          WHERE e.amount_kobo > 0 AND r.created_at >= $1 AND ($2::timestamptz IS NULL OR r.created_at < $2)`,
        [from, to],
      );
      const commission = Number(rows[0].kobo);
      const shares = (versions[i].value as RevenueRules).shares;
      let given = 0;
      shares.forEach((s, n) => {
        // the last party takes what is left, so rounding never loses or invents a kobo
        const part = n === shares.length - 1 ? commission - given : Math.floor((commission * s.bps) / 10_000);
        given += part;
        const key = s.name.toLowerCase();
        owed.set(key, (owed.get(key) ?? 0) + part);
      });
    }
    return owed;
  }

  async overview(): Promise<Ownership[]> {
    const accrual = await this.accrual();
    const { rows: pays } = await this.pool.query(
      `SELECT lower(stakeholder) AS who, status, COALESCE(sum(amount_kobo), 0)::bigint AS kobo FROM stakeholder_payouts WHERE status <> 'REJECTED' GROUP BY 1, 2`,
    );
    const { rows: ver } = await this.pool.query(
      `SELECT value FROM setting_versions WHERE key = 'revenue' AND approved_at IS NOT NULL AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1`,
    );
    const display = new Map<string, string>();
    (ver[0]?.value as RevenueRules | undefined)?.shares.forEach((s) => display.set(s.name.toLowerCase(), s.name));
    const names = new Set<string>([...accrual.keys(), ...pays.map((p) => p.who)]);
    const { rows: labels } = await this.pool.query(`SELECT DISTINCT ON (lower(stakeholder)) lower(stakeholder) AS who, stakeholder FROM stakeholder_payouts ORDER BY lower(stakeholder), created_at DESC`);
    labels.forEach((l) => { if (!display.has(l.who)) display.set(l.who, l.stakeholder); });
    // ones that have only ever appeared in older rules keep a readable name too
    const { rows: allVersions } = await this.pool.query(`SELECT value FROM setting_versions WHERE key = 'revenue' AND approved_at IS NOT NULL`);
    allVersions.forEach((v) => (v.value as RevenueRules).shares.forEach((s) => { if (!display.has(s.name.toLowerCase())) display.set(s.name.toLowerCase(), s.name); }));

    return [...names].map((who) => {
      const accrued = accrual.get(who) ?? 0;
      const paid = Number(pays.find((p) => p.who === who && p.status === 'PAID')?.kobo ?? 0);
      const pending = Number(pays.find((p) => p.who === who && p.status === 'PENDING_APPROVAL')?.kobo ?? 0);
      return { name: display.get(who) ?? who, accruedKobo: accrued, paidKobo: paid, pendingKobo: pending, availableKobo: accrued - paid - pending };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(status?: string) {
    const { rows } = await this.pool.query(
      `SELECT p.*, r.full_name AS requested_name, a.full_name AS approved_name FROM stakeholder_payouts p
         LEFT JOIN staff_users r ON r.id = p.requested_by LEFT JOIN staff_users a ON a.id = p.approved_by
        WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT 200`,
      [status ?? null],
    );
    return rows.map((p) => ({
      id: p.id, stakeholder: p.stakeholder, amountKobo: Number(p.amount_kobo), reference: p.reference, note: p.note, status: p.status,
      requestedBy: p.requested_name, approvedBy: p.approved_name, createdAt: p.created_at, approvedAt: p.approved_at, rejectedReason: p.rejected_reason,
    }));
  }

  async request(staffId: string, input: { stakeholder: string; amountKobo: number; reference?: string; note?: string }): Promise<{ id: string }> {
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) throw new BadRequestException('the amount must be a positive whole number of kobo');
    const who = (await this.overview()).find((o) => o.name.toLowerCase() === input.stakeholder.trim().toLowerCase());
    if (!who) throw new NotFoundException('that party does not share the commission');
    if (input.amountKobo > who.availableKobo) throw new ConflictException({ code: 'more_than_owed', message: `${who.name} is owed ₦${(who.availableKobo / 100).toLocaleString('en-NG')} at most, less what is already paid or waiting` });
    const { rows } = await this.pool.query(
      `INSERT INTO stakeholder_payouts (stakeholder, amount_kobo, reference, note, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [who.name, input.amountKobo, input.reference?.trim() || null, input.note?.trim() || null, staffId],
    );
    return { id: rows[0].id };
  }

  /** A different person approves; the money moves out of the commission account to the bank in the same step. */
  async approve(staffId: string, id: string): Promise<void> {
    await this.ledger.withTransaction(async (client) => {
      const p = (await client.query(`SELECT * FROM stakeholder_payouts WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!p) throw new NotFoundException('payout not found');
      if (p.status !== 'PENDING_APPROVAL') throw new ConflictException({ code: 'wrong_state', message: `that payout is already ${p.status.toLowerCase()}` });
      if (p.requested_by === staffId) throw new ConflictException({ code: 'same_person', message: 'a different person must approve your request' });
      await this.ledger.post(client, {
        kind: 'stakeholder_payout', reference: id, idempotencyKey: `stakeholder-payout:${id}`, memo: `Commission share paid to ${p.stakeholder}`,
        postings: [{ account: 'platform:commission', amountKobo: -Number(p.amount_kobo) }, { account: 'platform:cash', amountKobo: Number(p.amount_kobo) }],
      });
      await client.query(`UPDATE stakeholder_payouts SET status = 'PAID', approved_by = $2, approved_at = now() WHERE id = $1`, [id, staffId]);
    });
  }

  async reject(staffId: string, id: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE stakeholder_payouts SET status = 'REJECTED', rejected_by = $2, rejected_reason = $3 WHERE id = $1 AND status = 'PENDING_APPROVAL'`, [id, staffId, reason],
    );
    if (!rowCount) throw new ConflictException({ code: 'wrong_state', message: 'only a payout waiting for approval can be rejected' });
  }
}
