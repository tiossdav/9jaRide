import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { LedgerService } from '../ledger/ledger.service';
import { InvalidWebhookSignatureError, PaymentsService } from './payments.service';
import { PayoutsService, SelfApprovalError } from './payouts.service';
import { BankDestination, ProviderTransaction, TransferRejectedError, TransferStatus } from './payments.types';
import { PaystackClient, paystackSignature } from './paystack.client';
import { ReconciliationService } from './reconciliation.service';

// Real Postgres, fake provider. Skipped unless INTEGRATION=1 (it writes rows to DATABASE_URL, and the ledger is
// append-only, so use a local dev database):  INTEGRATION=1 DATABASE_URL=... npm test -- payments.int
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const KEY = 'sk_test_unit';
const BANK: BankDestination = { bankCode: '058', accountNumber: '0123456789', accountName: 'Test Driver' };

/** Real signature check, in-memory "network". */
class FakeProvider extends PaystackClient {
  txs = new Map<string, ProviderTransaction>();
  transfers = new Map<string, TransferStatus>();
  transferMode: 'ok' | 'reject' | 'unknown' = 'ok';
  constructor() {
    super(KEY);
  }
  async initialize(i: { reference: string }) {
    return { authorizationUrl: `https://pay.test/${i.reference}` };
  }
  async verifyTransaction(reference: string) {
    return this.txs.get(reference) ?? null;
  }
  async listSuccessful() {
    return [...this.txs.values()].filter((t) => t.status === 'success');
  }
  async transfer(i: { reference: string }) {
    if (this.transferMode === 'reject') throw new TransferRejectedError('bad account');
    if (this.transferMode === 'unknown') throw new Error('timeout');
    this.transfers.set(i.reference, 'SUCCESS');
    return { status: 'SUCCESS' as const };
  }
  async verifyTransfer(reference: string) {
    return this.transfers.get(reference) ?? 'NOT_FOUND';
  }
}

suite('payments and payouts (real Postgres)', () => {
  let pool: Pool;
  let provider: FakeProvider;
  let ledger: LedgerService;
  let payouts: PayoutsService;
  let payments: PaymentsService;
  let recon: ReconciliationService;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  });
  afterAll(() => pool.end());
  beforeEach(() => {
    provider = new FakeProvider();
    ledger = new LedgerService(pool);
    payouts = new PayoutsService(pool, provider, ledger);
    payments = new PaymentsService(pool, provider, ledger, payouts);
    recon = new ReconciliationService(pool, provider, provider, payments, payouts, ledger);
  });

  async function user(role: 'rider' | 'driver'): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO users (phone, full_name, role) VALUES ($1, 'Test', $2) RETURNING id`,
      [`+234${Math.floor(Math.random() * 1e10)}`, role],
    );
    return rows[0].id;
  }
  const balance = async (id: string) => ledger.withTransaction((c) => ledger.balanceKobo(c, `wallet:${id}`));
  const webhook = (event: object, key = KEY) => {
    const raw = Buffer.from(JSON.stringify(event));
    return { raw, sig: paystackSignature(raw, key) };
  };
  const chargeSuccess = (reference: string) => webhook({ event: 'charge.success', data: { reference } });
  const paid = (reference: string, amountKobo: number, currency = 'NGN') =>
    provider.txs.set(reference, { reference, status: 'success', amountKobo, currency });

  async function fundedDriver(kobo: number): Promise<string> {
    const id = await user('driver');
    await ledger.withTransaction((c) => ledger.awardBonus(c, id, kobo, `test-${randomUUID()}`));
    return id;
  }

  describe('top-ups', () => {
    it('credits once, even when the webhook is delivered five times at the same moment', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 500_000);
      paid(reference, 500_000);
      const { raw, sig } = chargeSuccess(reference);
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => payments.handleWebhook(raw, sig)));
      expect(outcomes.filter((o) => o === 'credited')).toHaveLength(1);
      expect(await balance(rider)).toBe(500_000);
      const intent = await pool.query(`SELECT status FROM payment_intents WHERE reference = $1`, [reference]);
      expect(intent.rows[0].status).toBe('SUCCESS');
    });

    it('rejects a forged webhook and credits nothing', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 500_000);
      paid(reference, 500_000);
      const { raw } = chargeSuccess(reference);
      await expect(payments.handleWebhook(raw, paystackSignature(raw, 'wrong-key'))).rejects.toThrow(InvalidWebhookSignatureError);
      await expect(payments.handleWebhook(raw, undefined)).rejects.toThrow(InvalidWebhookSignatureError);
      expect(await balance(rider)).toBe(0);
    });

    it('does not trust the webhook body: a success webhook for an unpaid reference credits nothing', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 500_000);
      const { raw, sig } = chargeSuccess(reference); // provider has no such payment
      expect(await payments.handleWebhook(raw, sig)).toBe('pending');
      expect(await balance(rider)).toBe(0);
    });

    it('does not credit when the provider collected a different amount', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 500_000);
      paid(reference, 50_000);
      const { raw, sig } = chargeSuccess(reference);
      expect(await payments.handleWebhook(raw, sig)).toBe('mismatch');
      expect(await balance(rider)).toBe(0);
      const intent = await pool.query(`SELECT status, provider_amount_kobo FROM payment_intents WHERE reference = $1`, [reference]);
      expect(intent.rows[0].status).toBe('AMOUNT_MISMATCH');
      expect(Number(intent.rows[0].provider_amount_kobo)).toBe(50_000);
    });

    it('refuses out-of-range top-ups', async () => {
      const rider = await user('rider');
      await expect(payments.initiateTopUp(rider, 5)).rejects.toThrow(RangeError);
      await expect(payments.initiateTopUp(rider, 1000.5)).rejects.toThrow(RangeError);
    });
  });

  describe('reconciliation', () => {
    it('recovers a payment whose webhook never arrived, and flags a payment we do not know', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 700_000);
      paid(reference, 700_000); // paid at the provider; no webhook was ever delivered
      const stranger = `topup_${randomUUID()}`;
      paid(stranger, 123_000);

      // The grace period only applies to the pending sweep; the provider comparison catches it regardless.
      const result = await recon.run();
      expect(result.runId).not.toBeNull();
      expect(await balance(rider)).toBe(700_000);

      const f = await pool.query(`SELECT kind FROM reconciliation_findings WHERE run_id = $1 AND reference = $2`, [result.runId, stranger]);
      expect(f.rows.map((r) => r.kind)).toEqual(['unknown_reference']);

      const again = await recon.run();
      expect(await balance(rider)).toBe(700_000); // a second run credits nothing more
      expect(again.recovered).toBe(0);
    });

    it('flags a credit the provider cannot confirm', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 300_000);
      paid(reference, 300_000);
      await payments.settleIntent(reference);
      provider.txs.delete(reference); // the provider now denies it
      const result = await recon.run();
      const f = await pool.query(`SELECT kind FROM reconciliation_findings WHERE run_id = $1 AND reference = $2`, [result.runId, reference]);
      expect(f.rows.map((r) => r.kind)).toEqual(['credit_without_provider_success']);
    });

    it('keeps the ledger balanced', async () => {
      expect(await ledger.totalImbalanceKobo()).toBe(0);
    });
  });

  describe('payouts', () => {
    const req = (driverId: string, amountKobo: number, requestedBy = driverId, idempotencyKey = randomUUID()) =>
      payouts.request({ driverId, amountKobo, bank: BANK, idempotencyKey, requestedBy });

    it('takes the money out at once, and a retried request does not take it twice', async () => {
      const driver = await fundedDriver(1_000_000);
      const key = randomUUID();
      const first = await req(driver, 400_000, driver, key);
      const retry = await req(driver, 400_000, driver, key);
      expect(retry).toEqual({ id: first.id, duplicate: true });
      expect(await balance(driver)).toBe(600_000);
    });

    it('refuses more than the wallet holds, and below the minimum', async () => {
      const driver = await fundedDriver(200_000);
      await expect(req(driver, 300_000)).rejects.toThrow(/insufficient funds/);
      await expect(req(driver, 5_000)).rejects.toThrow(RangeError);
      expect(await balance(driver)).toBe(200_000);
      const rows = await pool.query(`SELECT 1 FROM payout_requests WHERE driver_id = $1`, [driver]);
      expect(rows.rowCount).toBe(0); // the failed request left nothing behind
    });

    it('needs a second person: self-approval is refused by the service and by the database', async () => {
      const driver = await fundedDriver(500_000);
      const staff = randomUUID();
      const { id } = await req(driver, 200_000, staff);
      await expect(payouts.approve(id, staff)).rejects.toThrow(SelfApprovalError);
      await expect(
        pool.query(`UPDATE payout_requests SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1`, [id, staff]),
      ).rejects.toThrow(/check constraint/);
      expect(await payouts.sendApproved(5)).toBe(0); // nothing approved, nothing sent
      expect(await payouts.approve(id, randomUUID())).toBe(true);
    });

    it('sends an approved payout once and settles the ledger', async () => {
      const driver = await fundedDriver(500_000);
      const { id } = await req(driver, 200_000);
      await payouts.approve(id, randomUUID());
      await Promise.all([payouts.sendApproved(5), payouts.sendApproved(5)]);
      const row = await pool.query(`SELECT status, provider_reference FROM payout_requests WHERE id = $1`, [id]);
      expect(row.rows[0].status).toBe('PAID');
      expect(provider.transfers.size).toBeGreaterThanOrEqual(1);
      expect([...provider.transfers.keys()].filter((k) => k === `payout_${id}`)).toHaveLength(1);
      expect(await balance(driver)).toBe(300_000);
      expect(await payouts.markPaid(id)).toBe(false); // replay is a no-op
      expect(await ledger.totalImbalanceKobo()).toBe(0);
    });

    it('refunds the wallet when the provider refuses the transfer', async () => {
      const driver = await fundedDriver(500_000);
      const { id } = await req(driver, 200_000);
      await payouts.approve(id, randomUUID());
      provider.transferMode = 'reject';
      await payouts.sendApproved(5);
      const row = await pool.query(`SELECT status, failure_reason FROM payout_requests WHERE id = $1`, [id]);
      expect(row.rows[0].status).toBe('FAILED');
      expect(await balance(driver)).toBe(500_000);
      expect(await payouts.fail(id, 'again')).toBe(false); // refund happens once
      expect(await balance(driver)).toBe(500_000);
    });

    it('does NOT refund when the outcome is unknown, then settles from the provider', async () => {
      const driver = await fundedDriver(500_000);
      const { id } = await req(driver, 200_000);
      await payouts.approve(id, randomUUID());
      provider.transferMode = 'unknown';
      await payouts.sendApproved(5);
      const row = await pool.query(`SELECT status FROM payout_requests WHERE id = $1`, [id]);
      expect(row.rows[0].status).toBe('PROCESSING');
      expect(await balance(driver)).toBe(300_000); // still held out

      provider.transfers.set(`payout_${id}`, 'SUCCESS'); // it had actually gone through
      await recon.run();
      const after = await pool.query(`SELECT status FROM payout_requests WHERE id = $1`, [id]);
      expect(after.rows[0].status).toBe('PAID');
      expect(await balance(driver)).toBe(300_000);
    });

    it('refunds a transfer the provider has never heard of once it is overdue, not before', async () => {
      const driver = await fundedDriver(500_000);
      const { id } = await req(driver, 200_000);
      await payouts.approve(id, randomUUID());
      provider.transferMode = 'unknown';
      await payouts.sendApproved(5);
      expect(await payouts.refreshFromProvider(`payout_${id}`)).toBe('pending');
      expect(await balance(driver)).toBe(300_000);

      await pool.query(`UPDATE payout_requests SET processing_at = now() - interval '2 hours' WHERE id = $1`, [id]);
      expect(await payouts.refreshFromProvider(`payout_${id}`)).toBe('failed');
      expect(await balance(driver)).toBe(500_000);
    });

    it('rejecting returns the money, and a paid payout cannot be changed', async () => {
      const driver = await fundedDriver(500_000);
      const { id } = await req(driver, 200_000);
      expect(await payouts.reject(id, randomUUID(), 'name mismatch')).toBe(true);
      expect(await balance(driver)).toBe(500_000);
      expect(await payouts.reject(id, randomUUID(), 'again')).toBe(false);

      const second = await req(driver, 100_000);
      await payouts.approve(second.id, randomUUID());
      await payouts.sendApproved(5);
      await expect(pool.query(`UPDATE payout_requests SET status = 'FAILED' WHERE id = $1`, [second.id])).rejects.toThrow(/cannot change/);
      await expect(pool.query(`UPDATE payout_requests SET amount_kobo = 1 WHERE id = $1`, [second.id])).rejects.toThrow(/immutable/);
    });
  });
});
