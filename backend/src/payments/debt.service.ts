import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { walletCode } from '../ledger/postings';

export interface DebtEntry {
  at: Date;
  /** The kind of ledger transaction behind it (trip_cash, trip_wallet, topup, ...). */
  kind: string;
  memo: string | null;
  /** The wallet movement, as the ledger recorded it. */
  amountKobo: number;
  /** How much this entry changed the debt: positive makes the driver owe more, negative is debt recovered. */
  debtChangeKobo: number;
  /** What the driver still owed straight after it. */
  debtAfterKobo: number;
  type: 'debt_incurred' | 'debt_recovered';
}

export interface DebtSummary {
  outstandingKobo: number;
  incurredKobo: number;
  recoveredKobo: number;
  /** Newest first. Only the entries that changed what the driver owes. */
  history: DebtEntry[];
}

/**
 * What a driver owes the platform, worked out from the wallet ledger.
 *
 * A driver's debt IS their negative wallet balance (the commission on a cash trip comes out of the wallet and may take it below zero). Money
 * that reaches the wallet (earnings from a wallet trip, a top-up, a bonus) lands on that same balance, so it pays the debt first,
 * automatically, in the same ledger transaction that brings the money in, and the same money can never be both spent and counted against the
 * debt. Nothing here moves money. It reads the ledger, which is append-only, so the figures cannot drift from the balance: debt incurred
 * and recovered are the rises and falls of max(0, -balance) after each entry, and outstanding is that figure now.
 */
export function summariseDebt(entries: { at: Date; kind: string; memo: string | null; amountKobo: number }[]): DebtSummary {
  let balance = 0;
  let incurred = 0;
  let recovered = 0;
  const history: DebtEntry[] = [];
  for (const e of entries) {
    const debtBefore = Math.max(0, -balance);
    balance += e.amountKobo;
    const debtAfter = Math.max(0, -balance);
    const change = debtAfter - debtBefore;
    if (change > 0) incurred += change;
    if (change < 0) recovered += -change;
    if (change !== 0) history.push({ at: e.at, kind: e.kind, memo: e.memo, amountKobo: e.amountKobo, debtChangeKobo: change, debtAfterKobo: debtAfter, type: change > 0 ? 'debt_incurred' : 'debt_recovered' });
  }
  return { outstandingKobo: Math.max(0, -balance), incurredKobo: incurred, recoveredKobo: recovered, history: history.reverse() };
}

@Injectable()
export class DebtService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async forDriver(driverId: string, limit = 100): Promise<DebtSummary> {
    const { rows } = await this.pool.query(
      `SELECT t.kind, t.memo, t.created_at, e.amount_kobo
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.id = e.account_id
         JOIN ledger_transactions t ON t.id = e.transaction_id
        WHERE a.code = $1 ORDER BY e.id`,
      [walletCode(driverId)],
    );
    const all = summariseDebt(rows.map((r) => ({ at: r.created_at as Date, kind: r.kind as string, memo: r.memo as string | null, amountKobo: Number(r.amount_kobo) })));
    return { ...all, history: all.history.slice(0, limit) };
  }

  /** Staff: the drivers who owe something right now, biggest debt first. */
  async owing(limit = 200) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.phone, (-SUM(e.amount_kobo))::bigint AS owed_kobo
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.id = e.account_id
         JOIN users u ON a.code = 'wallet:' || u.id::text
        WHERE u.role = 'driver'
        GROUP BY u.id, u.full_name, u.phone
       HAVING SUM(e.amount_kobo) < 0
        ORDER BY owed_kobo DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ driverId: r.id as string, name: r.full_name as string, phone: r.phone as string, owedKobo: Number(r.owed_kobo) }));
  }

  /** Staff: one driver's debt and how it has been recovered. */
  async forDriverAsStaff(driverId: string) {
    const u = await this.pool.query(`SELECT id, full_name, phone FROM users WHERE id = $1 AND role = 'driver'`, [driverId]);
    if (!u.rows[0]) throw new NotFoundException('driver not found');
    return { driver: { id: u.rows[0].id as string, name: u.rows[0].full_name as string, phone: u.rows[0].phone as string }, ...(await this.forDriver(driverId, 200)) };
  }
}
