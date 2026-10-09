import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { LedgerService } from '../ledger/ledger.service';
import { InvalidWebhookSignatureError, PaymentsService } from './payments.service';
import { PayoutsService, SelfApprovalError } from './payouts.service';
import { BankDestination } from './payments.types';
import { paystackSignature } from './paystack.client';
import { FakeProvider, TEST_KEY as KEY } from './testing/fake-provider.testing';
import { ReconciliationService } from './reconciliation.service';
import { DebtService } from './debt.service';
import { walletCode } from '../ledger/postings';

// Real Postgres, fake provider. Skipped unless INTEGRATION=1 (it writes rows to DATABASE_URL, and the ledger is
// append-only, so use a local dev database):  INTEGRATION=1 DATABASE_URL=... npm test -- payments.int
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const BANK: BankDestination = { bankCode: '058', accountNumber: '0123456789', accountName: 'Test Driver' };

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

    describe('asking after a top-up (what the app does when the person comes back from the payment page)', () => {
      it('credits a paid top-up once, even when the webhook never came, and keeps saying success', async () => {
        const rider = await user('rider');
        const { reference } = await payments.initiateTopUp(rider, 500_000);
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('pending'); // not paid yet: nothing credited
        expect(await balance(rider)).toBe(0);
        paid(reference, 500_000);
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('success');
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('success');
        expect(await balance(rider)).toBe(500_000); // credited once, not twice
      });

      it('tells a cancelled payment from a failed one, and credits neither', async () => {
        const rider = await user('rider');
        const a = (await payments.initiateTopUp(rider, 500_000)).reference;
        const b = (await payments.initiateTopUp(rider, 500_000)).reference;
        provider.txs.set(a, { reference: a, status: 'abandoned', amountKobo: 500_000, currency: 'NGN' });
        provider.txs.set(b, { reference: b, status: 'failed', amountKobo: 500_000, currency: 'NGN' });
        expect((await payments.topUpStatus(rider, a))?.state).toBe('cancelled');
        expect((await payments.topUpStatus(rider, b))?.state).toBe('failed');
        expect(await balance(rider)).toBe(0);
      });

      it('still credits a payment finished after the person had cancelled once', async () => {
        const rider = await user('rider');
        const { reference } = await payments.initiateTopUp(rider, 500_000);
        provider.txs.set(reference, { reference, status: 'abandoned', amountKobo: 500_000, currency: 'NGN' });
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('cancelled');
        paid(reference, 500_000);
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('success');
        expect(await balance(rider)).toBe(500_000);
      });

      it('reports a wrong amount as needing a person, and answers nothing about another person top-up', async () => {
        const rider = await user('rider');
        const other = await user('rider');
        const { reference } = await payments.initiateTopUp(rider, 500_000);
        paid(reference, 50_000);
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('mismatch');
        expect(await payments.topUpStatus(other, reference)).toBeNull();
        expect(await payments.topUpStatus(rider, 'topup_does-not-exist')).toBeNull();
        expect(await balance(rider)).toBe(0);
      });

      it('says pending, not an error, when Paystack cannot be reached', async () => {
        const rider = await user('rider');
        const { reference } = await payments.initiateTopUp(rider, 500_000);
        provider.verifyTransaction = async () => { throw new Error('network down'); };
        expect((await payments.topUpStatus(rider, reference))?.state).toBe('pending');
      });
    });

    it('credits the amount asked for when Paystack adds its fee for the customer', async () => {
      const rider = await user('rider');
      const { reference } = await payments.initiateTopUp(rider, 200_000);
      provider.txs.set(reference, { reference, status: 'success', amountKobo: 203_046, requestedAmountKobo: 200_000, currency: 'NGN' });
      expect((await payments.topUpStatus(rider, reference))?.state).toBe('success');
      expect(await balance(rider)).toBe(200_000); // the fee is the customer's, the wallet gets what they asked for, once
    });

    it('still refuses a payment that is for a different request or less than asked', async () => {
      const rider = await user('rider');
      const a = (await payments.initiateTopUp(rider, 200_000)).reference;
      const b = (await payments.initiateTopUp(rider, 200_000)).reference;
      provider.txs.set(a, { reference: a, status: 'success', amountKobo: 250_000, requestedAmountKobo: 250_000, currency: 'NGN' }); // asked for another amount
      provider.txs.set(b, { reference: b, status: 'success', amountKobo: 150_000, requestedAmountKobo: 200_000, currency: 'NGN' }); // paid less than asked
      expect((await payments.topUpStatus(rider, a))?.state).toBe('mismatch');
      expect((await payments.topUpStatus(rider, b))?.state).toBe('mismatch');
      expect(await balance(rider)).toBe(0);
    });

    it('refuses out-of-range top-ups', async () => {
      const rider = await user('rider');
      await expect(payments.initiateTopUp(rider, 5)).rejects.toThrow(RangeError);
      await expect(payments.initiateTopUp(rider, 1000.5)).rejects.toThrow(RangeError);
      await expect(payments.initiateTopUp(rider, 99_999)).rejects.toThrow(RangeError); // under 1,000 naira
      await expect(payments.initiateTopUp(rider, 100_000)).resolves.toMatchObject({ reference: expect.any(String) }); // exactly 1,000 naira is fine
    });
  });

  describe('driver debt', () => {
    /** A cash trip's commission: comes out of the driver's wallet and may take it below zero. */
    const owe = (driverId: string, kobo: number) =>
      ledger.withTransaction(async (c) => { await ledger.ensureWallet(c, driverId); return ledger.post(c, {
        kind: 'trip_cash', reference: randomUUID(), idempotencyKey: `debt-${randomUUID()}`,
        postings: [{ account: walletCode(driverId), amountKobo: -kobo }, { account: 'platform:commission', amountKobo: kobo }],
      }, { allowNegative: [walletCode(driverId)] }); });
    const award = (driverId: string, kobo: number, key = randomUUID()) => ledger.withTransaction((c) => ledger.awardBonus(c, driverId, kobo, key));
    const debts = () => new DebtService(pool);

    it('shows a driver what they owe, and later earnings pay it back automatically, partly then fully', async () => {
      const driver = await user('driver');
      await owe(driver, 100_000);
      expect(await debts().forDriver(driver)).toMatchObject({ outstandingKobo: 100_000, incurredKobo: 100_000, recoveredKobo: 0 });
      await award(driver, 40_000);
      expect(await debts().forDriver(driver)).toMatchObject({ outstandingKobo: 60_000, recoveredKobo: 40_000 });
      expect(await balance(driver)).toBe(-60_000);
      await award(driver, 100_000);
      const done = await debts().forDriver(driver);
      expect(done).toMatchObject({ outstandingKobo: 0, incurredKobo: 100_000, recoveredKobo: 100_000 });
      expect(await balance(driver)).toBe(40_000); // only what was left over after the debt is theirs to spend
      expect(done.history.map((h) => h.type)).toEqual(['debt_recovered', 'debt_recovered', 'debt_incurred']); // the record stays after it is repaid
    });

    it('does nothing for a driver with an empty wallet, and a repeated event never counts twice', async () => {
      const driver = await user('driver');
      expect(await debts().forDriver(driver)).toMatchObject({ outstandingKobo: 0, history: [] });
      await owe(driver, 50_000);
      const key = randomUUID();
      await award(driver, 20_000, key);
      await award(driver, 20_000, key); // the same award delivered again
      expect(await balance(driver)).toBe(-30_000);
      expect(await debts().forDriver(driver)).toMatchObject({ outstandingKobo: 30_000, recoveredKobo: 20_000 });
    });

    it('stays right when many payments arrive at the same moment', async () => {
      const driver = await user('driver');
      await owe(driver, 100_000);
      await Promise.all(Array.from({ length: 10 }, () => award(driver, 15_000)));
      expect(await balance(driver)).toBe(50_000);
      expect(await debts().forDriver(driver)).toMatchObject({ outstandingKobo: 0, incurredKobo: 100_000, recoveredKobo: 100_000 });
    });

    it('lists the drivers who owe, for staff, with the debt to the kobo', async () => {
      const driver = await user('driver');
      await owe(driver, 77_700);
      const listed = (await debts().owing(1000)).find((d) => d.driverId === driver);
      expect(listed?.owedKobo).toBe(77_700);
      expect((await debts().forDriverAsStaff(driver)).outstandingKobo).toBe(77_700);
      await award(driver, 80_000);
      expect((await debts().owing(1000)).find((d) => d.driverId === driver)).toBeUndefined();
    });

    it('never lets the books go out of balance', async () => {
      expect(await ledger.totalImbalanceKobo()).toBe(0);
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
      await payouts.sendApproved(50); // other suites may have approved payouts; this one must not be among those sent
      const state = await pool.query(`SELECT status FROM payout_requests WHERE id = $1`, [id]);
      expect(state.rows[0].status).toBe('PENDING_APPROVAL');
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
