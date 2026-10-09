import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { assertKobo } from '../common/money';
import {Posting, assertBalanced, planBonus, planCashTrip, planTopUp, planWalletTrip, walletCode, OwnerDeduction} from './postings';

/** The revenue rules in force when the trip began. Left out, the long-standing defaults apply. */
export interface TripRules { commissionBps?: number; taxCommissionable?: boolean; discountKobo?: number; deduction?: OwnerDeduction }

export class InsufficientFundsError extends Error {
  constructor(public readonly account: string, public readonly availableKobo: number, public readonly neededKobo: number) {
    super(`insufficient funds in ${account}: available ${availableKobo}, needed ${neededKobo} kobo`);
  }
}

export interface PostInput {
  kind: string;
  reference: string;
  idempotencyKey: string;
  postings: Posting[];
  memo?: string;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Run work in one DB transaction. Ledger entry + payment/ride updates must commit together. */
  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async ensureWallet(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `INSERT INTO ledger_accounts (code, kind, owner_id) VALUES ($1, 'wallet', $2) ON CONFLICT (code) DO NOTHING`,
      [walletCode(userId), userId],
    );
  }

  /** Balance less active holds: what the user can actually spend. */
  async availableKobo(client: PoolClient, accountCode: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT COALESCE((SELECT SUM(e.amount_kobo) FROM ledger_entries e WHERE e.account_id = a.id), 0)::bigint AS balance,
              COALESCE((SELECT SUM(h.amount_kobo) FROM wallet_holds h WHERE h.account_id = a.id AND h.status = 'ACTIVE'), 0)::bigint AS held
         FROM ledger_accounts a WHERE a.code = $1`,
      [accountCode],
    );
    if (!rows[0]) return 0;
    return Number(rows[0].balance) - Number(rows[0].held);
  }

  /**
   * Post one balanced transaction, idempotently.
   * Returns false when the idempotency key was already used (a retried webhook or request is a no-op).
   * Must be called inside withTransaction so it commits with the caller's own writes.
   */
  async post(
    client: PoolClient,
    input: PostInput,
    opts: { ignoreHolds?: boolean; allowNegative?: string[] } = {},
  ): Promise<boolean> {
    assertBalanced(input.postings);

    // Lock the accounts in a fixed order so concurrent postings cannot deadlock, and so two
    // debits against one wallet are serialised before the balance check.
    const codes = [...new Set(input.postings.map((p) => p.account))].sort();
    const { rows: accounts } = await client.query(
      `SELECT id, code, allow_negative FROM ledger_accounts WHERE code = ANY($1) ORDER BY code FOR UPDATE`,
      [codes],
    );
    if (accounts.length !== codes.length) {
      const known = new Set(accounts.map((a) => a.code));
      throw new Error(`unknown ledger account(s): ${codes.filter((c) => !known.has(c)).join(', ')}`);
    }
    const byCode = new Map(accounts.map((a) => [a.code as string, a]));

    const inserted = await client.query(
      `INSERT INTO ledger_transactions (kind, reference, idempotency_key, memo)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [input.kind, input.reference, input.idempotencyKey, input.memo ?? null],
    );
    if (inserted.rowCount === 0) return false;
    const txId = inserted.rows[0].id as string;

    for (const p of input.postings) {
      const account = byCode.get(p.account)!;
      if (p.amountKobo < 0 && !account.allow_negative && !opts.allowNegative?.includes(p.account)) {
        const available = opts.ignoreHolds
          ? await this.balanceKobo(client, p.account)
          : await this.availableKobo(client, p.account);
        if (available < -p.amountKobo) throw new InsufficientFundsError(p.account, available, -p.amountKobo);
      }
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, amount_kobo) VALUES ($1, $2, $3)`,
        [txId, account.id, p.amountKobo],
      );
    }
    return true;
  }

  async balanceKobo(client: PoolClient, accountCode: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(e.amount_kobo), 0)::bigint AS balance
         FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id WHERE a.code = $1`,
      [accountCode],
    );
    return Number(rows[0]?.balance ?? 0);
  }

  // ---------------------------------------------------------------- business events

  /** Credit only after a verified webhook. `providerReference` is unique, so duplicate webhooks are harmless. */
  async topUp(client: PoolClient, userId: string, amount: number, providerReference: string): Promise<boolean> {
    await this.ensureWallet(client, userId);
    return this.post(client, {
      kind: 'topup',
      reference: providerReference,
      idempotencyKey: `topup:${providerReference}`,
      postings: planTopUp(userId, amount),
    });
  }

  /** Reserve the fare when the driver is assigned, so a balance spent in between cannot fail the trip. */
  async holdForRide(client: PoolClient, riderId: string, rideId: string, amount: number): Promise<void> {
    assertKobo(amount, 'hold');
    const code = walletCode(riderId);
    await this.ensureWallet(client, riderId);
    // Serialise against other postings on this wallet before checking what is available.
    await client.query(`SELECT 1 FROM ledger_accounts WHERE code = $1 FOR UPDATE`, [code]);
    const available = await this.availableKobo(client, code);
    if (available < amount) throw new InsufficientFundsError(code, available, amount);
    await client.query(
      `INSERT INTO wallet_holds (account_id, ride_id, amount_kobo)
       SELECT id, $2, $3 FROM ledger_accounts WHERE code = $1
       ON CONFLICT (ride_id) DO NOTHING`,
      [code, rideId, amount],
    );
    await client.query(`UPDATE rides SET payment_status = 'HELD', updated_at = now() WHERE id = $1`, [rideId]);
  }

  /**
   * Raises the money held for a trip by [extra] (the trip was extended). Fails with InsufficientFundsError when the wallet cannot
   * cover it, in which case nothing changes. A ride that has no active hold (paid in cash) is left alone.
   */
  async extendHold(client: PoolClient, riderId: string, rideId: string, extra: number): Promise<void> {
    assertKobo(extra, 'hold');
    const code = walletCode(riderId);
    await client.query(`SELECT 1 FROM ledger_accounts WHERE code = $1 FOR UPDATE`, [code]);
    const available = await this.availableKobo(client, code);
    if (available < extra) throw new InsufficientFundsError(code, available, extra);
    await client.query(`UPDATE wallet_holds SET amount_kobo = amount_kobo + $2 WHERE ride_id = $1 AND status = 'ACTIVE'`, [rideId, extra]);
  }

  async releaseHold(client: PoolClient, rideId: string): Promise<void> {
    await client.query(`UPDATE wallet_holds SET status = 'RELEASED' WHERE ride_id = $1 AND status = 'ACTIVE'`, [rideId]);
  }

  /** Complete a wallet trip: capture the hold and post the split in the same transaction. */
  async completeWalletTrip(client: PoolClient, rideId: string, riderId: string, driverId: string, fare: number, tax = 0, rules: TripRules = {}) {
    // A driver whose first trip is paid from a wallet has no wallet yet: make it, in the same transaction, or the trip could never complete.
    await this.ensureWallet(client, driverId);
    // The hold already reserved this money, so check against the raw balance, not balance minus holds.
    const posted = await this.post(
      client,
      {
        kind: 'trip_wallet',
        reference: rideId,
        idempotencyKey: `trip:${rideId}`,
        postings: planWalletTrip(riderId, driverId, fare, tax, rules.commissionBps, rules.taxCommissionable, rules.discountKobo, rules.deduction),
      },
      { ignoreHolds: true },
    );
    if (posted) {
      await client.query(`UPDATE wallet_holds SET status = 'CAPTURED' WHERE ride_id = $1`, [rideId]);
      await client.query(`UPDATE rides SET payment_status = 'PAID', updated_at = now() WHERE id = $1`, [rideId]);
    }
    return posted;
  }

  /** Complete a cash trip: the driver owes the commission. The driver wallet may go negative. */
  async completeCashTrip(client: PoolClient, rideId: string, driverId: string, fare: number, tax = 0, rules: TripRules = {}) {
    await this.ensureWallet(client, driverId);
    // Commission debt may take this wallet negative; allow it for this posting only.
    const posted = await this.post(
      client,
      {
        kind: 'trip_cash',
        reference: rideId,
        idempotencyKey: `trip:${rideId}`,
        postings: planCashTrip(driverId, fare, tax, rules.commissionBps, rules.taxCommissionable, rules.discountKobo, rules.deduction),
      },
      { allowNegative: [walletCode(driverId)] },
    );
    if (posted) await client.query(`UPDATE rides SET payment_status = 'PAID', updated_at = now() WHERE id = $1`, [rideId]);
    return posted;
  }

  async awardBonus(client: PoolClient, driverId: string, amount: number, awardKey: string) {
    await this.ensureWallet(client, driverId);
    return this.post(client, {
      kind: 'bonus',
      reference: awardKey,
      idempotencyKey: `bonus:${awardKey}`,
      postings: planBonus(driverId, amount),
    });
  }

  /** Health check for the "ledger imbalance" alert: must always be 0. */
  async totalImbalanceKobo(): Promise<number> {
    const { rows } = await this.pool.query(`SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS total FROM ledger_entries`);
    return Number(rows[0].total);
  }
}
