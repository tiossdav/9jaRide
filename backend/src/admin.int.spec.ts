import { randomUUID } from 'crypto';
import { paystackSignature } from './payments/paystack.client';
import { TEST_KEY } from './payments/testing/fake-provider.testing';
import { bootApp } from './testing/harness.testing';

// Admin essentials over real HTTP, Postgres and Valkey. Skipped unless INTEGRATION=1 (writes rows to DATABASE_URL).
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const inFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const plate = () => `T${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`;

suite('admin essentials', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    h = await bootApp();
  }, 60_000);
  afterAll(() => h.close());

  const application = async (token: string, over: object = {}) => ({
    vehicle: { category: 'comfort', make: 'Toyota', colour: 'Black', plate: plate() },
    personal: h.personal(),
    documents: await h.ownerDocs(token),
    ...over,
  });

  describe('driver onboarding', () => {
    it('keeps a driver off the map until staff approve, then lets them online', async () => {
      const driver = await h.login('driver');
      const ping = () => h.http().post('/driver/location').set(h.auth(driver.token)).send({ lat: 6.5, lng: 3.3 });
      await ping().expect(409); // no approved vehicle yet

      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await application(driver.token, )).expect(200);
      await h.http().post('/driver/application').set(h.auth(driver.token)).send(await application(driver.token, )).expect(409); // already pending
      expect((await h.http().get('/driver/application').set(h.auth(driver.token)).expect(200)).body.status).toBe('SUBMITTED');
      await ping().expect(409); // submitting is not approval

      const support = await h.staff('support');
      const queue = await h.http().get('/admin/driver-applications').set(h.auth(support.token)).expect(200);
      expect(queue.body.map((a: { id: string }) => a.id)).toContain(sub.body.id);
      const detail = await h.http().get(`/admin/driver-applications/${sub.body.id}`).set(h.auth(support.token)).expect(200);
      expect(detail.body).toMatchObject({ status: 'SUBMITTED', missingDocuments: [] });
      expect(detail.body.documents).toHaveLength(6);

      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(support.token)).expect(204);
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(support.token)).expect(409); // decided
      await ping().expect(204);
      const mine = await h.http().get('/driver/application').set(h.auth(driver.token)).expect(200);
      expect(mine.body.status).toBe('APPROVED');
    });

    it('will not approve with a missing or expired document, and says which', async () => {
      const driver = await h.login('driver');
      const support = await h.staff('support');
      const docs = (await h.ownerDocs(driver.token))
        .filter((d) => d.kind !== 'insurance') // insurance missing
        .map((d) => (d.kind === 'drivers_licence' ? { ...d, expiresOn: inFuture(-5) } : d)); // licence expired
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await application(driver.token, { documents: docs })).expect(200);
      const res = await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(support.token)).expect(409);
      expect(res.body.code).toBe('documents_not_ready');
      expect(res.body.message).toContain('insurance is missing');
      expect(res.body.message).toContain('drivers_licence has expired');
      const { rows } = await h.pool.query(`SELECT 1 FROM vehicles WHERE driver_id = $1`, [driver.id]);
      expect(rows).toHaveLength(0); // nothing half-created
    });

    it('lets staff ask for changes, takes the resubmission, and keeps rejections final', async () => {
      const driver = await h.login('driver');
      const support = await h.staff('support');
      const first = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await application(driver.token, )).expect(200);
      await h.http().post(`/admin/driver-applications/${first.body.id}/request-changes`).set(h.auth(support.token)).send({ note: 'Licence photo is blurry' }).expect(204);
      const seen = await h.http().get('/driver/application').set(h.auth(driver.token)).expect(200);
      expect(seen.body).toMatchObject({ status: 'CHANGES_REQUESTED', reviewNote: 'Licence photo is blurry' });

      const again = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await application(driver.token, )).expect(200);
      expect(again.body.id).toBe(first.body.id); // same application, back in the queue
      await h.http().post(`/admin/driver-applications/${first.body.id}/reject`).set(h.auth(support.token)).send({ reason: 'Licence is forged' }).expect(204);
      await h.http().post(`/admin/driver-applications/${first.body.id}/approve`).set(h.auth(support.token)).expect(409);
      await expect(h.pool.query(`UPDATE driver_applications SET status = 'APPROVED' WHERE id = $1`, [first.body.id])).rejects.toThrow(/cannot change/);

      // A rejected driver may apply again, as a new application.
      const fresh = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await application(driver.token, )).expect(200);
      expect(fresh.body.id).not.toBe(first.body.id);
    });

    it('refuses a plate that belongs to another driver, and bad input', async () => {
      const support = await h.staff('support');
      const shared = plate();
      const a = await h.login('driver');
      const b = await h.login('driver');
      const subA = await h.http().post('/driver/application').set(h.auth(a.token)).send(await application(a.token, { vehicle: { category: 'regular', make: 'Kia', colour: 'Red', plate: shared } })).expect(200);
      const subB = await h.http().post('/driver/application').set(h.auth(b.token)).send(await application(b.token, { vehicle: { category: 'regular', make: 'Kia', colour: 'Red', plate: shared.toLowerCase() } })).expect(200);
      await h.http().post(`/admin/driver-applications/${subA.body.id}/approve`).set(h.auth(support.token)).expect(204);
      const clash = await h.http().post(`/admin/driver-applications/${subB.body.id}/approve`).set(h.auth(support.token)).expect(409);
      expect(clash.body.code).toBe('plate_in_use');

      const c = await h.login('driver');
      await h.http().post('/driver/application').set(h.auth(c.token)).send(await application(c.token, { vehicle: { category: 'regular', make: 'Kia', colour: 'Red', plate: '!!' } })).expect(400);
      await h.http().post('/driver/application').set(h.auth(c.token)).send(await application(c.token, { documents: [{ kind: 'drivers_licence', number: 'L1', fileId: randomUUID() }] })).expect(400); // licence needs an expiry
      await h.http().post('/driver/application').set(h.auth(c.token)).send(await application(c.token, { documents: [{ kind: 'passport', fileId: randomUUID() }] })).expect(400);
    });

    it('keeps riders and finance out of driver review', async () => {
      const rider = await h.login('rider');
      const finance = await h.staff('finance');
      const someDriver = await h.login('driver');
      await h.http().post('/driver/application').set(h.auth(rider.token)).send(await application(someDriver.token)).expect(403);
      await h.http().get('/admin/driver-applications').set(h.auth(finance.token)).expect(403);
      await h.http().get('/admin/driver-applications').set(h.auth(rider.token)).expect(403);
    });

    it('suspends an account at once, and reinstates it', async () => {
      const driver = await h.login('driver');
      const support = await h.staff('support');
      await h.http().get('/me').set(h.auth(driver.token)).expect(200);

      await h.http().post(`/admin/users/${driver.id}/suspend`).set(h.auth(support.token)).send({ reason: 'x' }).expect(400);
      const res = await h.http().post(`/admin/users/${driver.id}/suspend`).set(h.auth(support.token)).send({ reason: 'Reported by three riders' }).expect(200);
      expect(res.body).toEqual({ changed: true });
      await h.http().post(`/admin/users/${driver.id}/suspend`).set(h.auth(support.token)).send({ reason: 'again' }).expect(200, { changed: false });

      // The access token is still unexpired, but it no longer works; refresh and sign-in are refused too.
      await h.http().get('/me').set(h.auth(driver.token)).expect(403);
      await h.http().post('/auth/refresh').send({ refreshToken: driver.refresh }).expect(401);
      await h.http().post('/auth/otp/request').set('X-Forwarded-For', h.freshIp()).send({ phone: driver.phone }).expect(200);
      await h.http().post('/auth/otp/verify').send({ phone: driver.phone, code: h.codes.get(driver.phone) }).expect(403);

      await h.http().post(`/admin/users/${driver.id}/reinstate`).set(h.auth(support.token)).send({ reason: 'Appeal upheld' }).expect(200, { changed: true });
      await h.http().post('/auth/otp/request').set('X-Forwarded-For', h.freshIp()).send({ phone: driver.phone }).expect(200);
      await h.http().post('/auth/otp/verify').send({ phone: driver.phone, code: h.codes.get(driver.phone) }).expect(200);

      const events = await h.pool.query(`SELECT status, reason, actor_id FROM user_status_events WHERE user_id = $1 ORDER BY id`, [driver.id]);
      expect(events.rows).toEqual([
        { status: 'suspended', reason: 'Reported by three riders', actor_id: support.id },
        { status: 'active', reason: 'Appeal upheld', actor_id: support.id },
      ]);
      await h.http().post(`/admin/users/${randomUUID()}/suspend`).set(h.auth(support.token)).send({ reason: 'no such user' }).expect(404);
    });
  });

  describe('refunds and adjustments', () => {
    const ask = (token: string, body: object, key = h.key()) =>
      h.http().post('/admin/adjustments').set(h.auth(token)).set('Idempotency-Key', key).send(body);

    it('refunds only after a different person approves, and the money moves exactly once', async () => {
      const rider = await h.login('rider');
      const driver = await h.login('driver');
      const rideId = await h.completedRide(rider.id, driver.id, 500_000);
      const support = await h.staff('support');
      const financeA = await h.staff('finance');
      const financeB = await h.staff('finance');
      const adjBefore = await h.platform('platform:adjustments');

      const req = await ask(support.token, { kind: 'refund', userId: rider.id, rideId, amountKobo: 300_000, reason: 'Driver took a longer route' }).expect(200);
      expect(await h.wallet(rider.id)).toBe(0); // asking moves nothing
      await h.http().post(`/admin/adjustments/${req.body.id}/approve`).set(h.auth(support.token)).expect(403); // support cannot approve

      const mine = await ask(financeA.token, { kind: 'refund', userId: rider.id, rideId, amountKobo: 100_000, reason: 'Goodwill' }).expect(200);
      const self = await h.http().post(`/admin/adjustments/${mine.body.id}/approve`).set(h.auth(financeA.token)).expect(403);
      expect(self.body.code).toBe('self_approval');
      await expect(
        h.pool.query(`UPDATE ledger_adjustments SET status = 'POSTED', approved_by = requested_by, approved_at = now() WHERE id = $1`, [mine.body.id]),
      ).rejects.toThrow(/check constraint/);

      await h.http().post(`/admin/adjustments/${req.body.id}/approve`).set(h.auth(financeB.token)).expect(200, { approved: true });
      await h.http().post(`/admin/adjustments/${req.body.id}/approve`).set(h.auth(financeB.token)).expect(200, { approved: false }); // repeat is a no-op
      expect(await h.wallet(rider.id)).toBe(300_000);
      expect(await h.platform('platform:adjustments')).toBe(adjBefore - 300_000);
      expect(await h.ledger.totalImbalanceKobo()).toBe(0);

      const row = (await h.http().get(`/admin/adjustments/${req.body.id}`).set(h.auth(support.token)).expect(200)).body;
      expect(row).toMatchObject({ status: 'POSTED', requestedBy: support.id, approvedBy: financeB.id });
      await expect(h.pool.query(`UPDATE ledger_adjustments SET amount_kobo = 1 WHERE id = $1`, [req.body.id])).rejects.toThrow(/immutable/);
    });

    it('cannot refund more than the fare in total, for the wrong rider, or on an unfinished ride', async () => {
      const rider = await h.login('rider');
      const other = await h.login('rider');
      const driver = await h.login('driver');
      const rideId = await h.completedRide(rider.id, driver.id, 500_000);
      const finance = await h.staff('finance');

      await ask(finance.token, { kind: 'refund', userId: rider.id, rideId, amountKobo: 300_000, reason: 'part one' }).expect(200);
      const over = await ask(finance.token, { kind: 'refund', userId: rider.id, rideId, amountKobo: 300_000, reason: 'part two' }).expect(409);
      expect(over.body).toMatchObject({ code: 'refund_exceeds_fare' });
      expect(over.body.message).toContain('200000');
      await ask(finance.token, { kind: 'refund', userId: rider.id, rideId, amountKobo: 200_000, reason: 'the rest' }).expect(200);

      await ask(finance.token, { kind: 'refund', userId: other.id, rideId, amountKobo: 1000, reason: 'wrong person' }).expect(400);
      await ask(finance.token, { kind: 'refund', userId: rider.id, amountKobo: 1000, reason: 'no ride' }).expect(400);
      await ask(finance.token, { kind: 'refund', userId: rider.id, rideId: randomUUID(), amountKobo: 1000, reason: 'no such ride' }).expect(400);
    });

    it('treats a retried request as the same request, and a reused key for something else as an error', async () => {
      const rider = await h.login('rider');
      const finance = await h.staff('finance');
      const k = h.key();
      const body = { kind: 'credit', userId: rider.id, amountKobo: 50_000, reason: 'Apology credit' };
      const first = await ask(finance.token, body, k).expect(200);
      const retry = await ask(finance.token, body, k).expect(200);
      expect(retry.body).toEqual({ id: first.body.id, duplicate: true });
      await ask(finance.token, { ...body, amountKobo: 60_000 }, k).expect(409);
      await h.http().post('/admin/adjustments').set(h.auth(finance.token)).send(body).expect(400); // Idempotency-Key required
    });

    it('needs an admin for large amounts', async () => {
      const rider = await h.login('rider');
      const financeA = await h.staff('finance');
      const financeB = await h.staff('finance');
      const admin = await h.staff('admin');
      const big = await ask(financeA.token, { kind: 'credit', userId: rider.id, amountKobo: 6_000_000, reason: 'Compensation' }).expect(200);
      const refused = await h.http().post(`/admin/adjustments/${big.body.id}/approve`).set(h.auth(financeB.token)).expect(403);
      expect(refused.body.code).toBe('admin_required');
      expect(await h.wallet(rider.id)).toBe(0);
      await h.http().post(`/admin/adjustments/${big.body.id}/approve`).set(h.auth(admin.token)).expect(200, { approved: true });
      expect(await h.wallet(rider.id)).toBe(6_000_000);
    });

    it('lets a driver wallet go negative on a debit, but never a rider wallet', async () => {
      const rider = await h.login('rider');
      const driver = await h.login('driver');
      const financeA = await h.staff('finance');
      const financeB = await h.staff('finance');

      const d1 = await ask(financeA.token, { kind: 'debit', userId: driver.id, amountKobo: 40_000, reason: 'Recover cash commission' }).expect(200);
      await h.http().post(`/admin/adjustments/${d1.body.id}/approve`).set(h.auth(financeB.token)).expect(200);
      expect(await h.wallet(driver.id)).toBe(-40_000);

      const d2 = await ask(financeA.token, { kind: 'debit', userId: rider.id, amountKobo: 40_000, reason: 'Chargeback' }).expect(200);
      const res = await h.http().post(`/admin/adjustments/${d2.body.id}/approve`).set(h.auth(financeB.token)).expect(402);
      expect(res.body.code).toBe('insufficient_funds');
      expect((await h.http().get(`/admin/adjustments/${d2.body.id}`).set(h.auth(financeA.token))).body.status).toBe('PENDING_APPROVAL'); // rolled back, still waiting
      expect(await h.wallet(rider.id)).toBe(0);
    });

    it('can be rejected, and then cannot be approved', async () => {
      const rider = await h.login('rider');
      const financeA = await h.staff('finance');
      const financeB = await h.staff('finance');
      const req = await ask(financeA.token, { kind: 'credit', userId: rider.id, amountKobo: 10_000, reason: 'Test' }).expect(200);
      await h.http().post(`/admin/adjustments/${req.body.id}/reject`).set(h.auth(financeB.token)).send({ reason: 'Not justified' }).expect(200, { rejected: true });
      await h.http().post(`/admin/adjustments/${req.body.id}/approve`).set(h.auth(financeB.token)).expect(409);
      await h.http().post(`/admin/adjustments/${req.body.id}/reject`).set(h.auth(financeB.token)).send({ reason: 'again' }).expect(200, { rejected: false });
      expect(await h.wallet(rider.id)).toBe(0);
    });
  });

  describe('payment exceptions', () => {
    it('queues a wrong-amount top-up, corrects it only against what Paystack really collected, and closes it', async () => {
      const rider = await h.login('rider');
      const finance = await h.staff('finance');
      const financeB = await h.staff('finance');
      const support = await h.staff('support');

      // The rider asked for ₦5,000 but Paystack collected ₦3,000: the webhook parks it instead of crediting.
      const t = await h.http().post('/wallet/topups').set(h.auth(rider.token)).send({ amountKobo: 500_000 }).expect(200);
      const reference = t.body.reference as string;
      h.provider.txs.set(reference, { reference, status: 'success', amountKobo: 300_000, currency: 'NGN' });
      const raw = JSON.stringify({ event: 'charge.success', data: { reference } });
      await h.http().post('/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', paystackSignature(raw, TEST_KEY)).send(raw).expect(200, { outcome: 'mismatch' });
      expect(await h.wallet(rider.id)).toBe(0);

      await h.http().get('/admin/payment-exceptions').set(h.auth(support.token)).expect(403);
      const queue = await h.http().get('/admin/payment-exceptions').set(h.auth(finance.token)).expect(200);
      const item = queue.body.find((e: { sourceId: string }) => e.sourceId === reference);
      expect(item).toMatchObject({ sourceKind: 'intent', kind: 'amount_mismatch', detail: { expectedKobo: 500_000, collectedKobo: 300_000 } });

      // Asking for a correction of the wrong size is caught when it is approved, against Paystack.
      const wrong = await h.http().post('/admin/adjustments').set(h.auth(finance.token)).set('Idempotency-Key', h.key())
        .send({ kind: 'topup_correction', userId: rider.id, providerReference: reference, amountKobo: 500_000, reason: 'Credit what they asked for' }).expect(200);
      const bad = await h.http().post(`/admin/adjustments/${wrong.body.id}/approve`).set(h.auth(financeB.token)).expect(409);
      expect(bad.body.code).toBe('provider_mismatch');
      await h.http().post(`/admin/adjustments/${wrong.body.id}/reject`).set(h.auth(financeB.token)).send({ reason: 'Wrong amount' }).expect(200);

      const right = await h.http().post('/admin/adjustments').set(h.auth(finance.token)).set('Idempotency-Key', h.key())
        .send({ kind: 'topup_correction', userId: rider.id, providerReference: reference, amountKobo: 300_000, reason: 'Credit what Paystack collected' }).expect(200);
      const resolveBody = { sourceKind: 'intent', sourceId: reference, resolution: 'corrected', note: 'Credited the collected amount', adjustmentId: right.body.id };
      await h.http().post('/admin/payment-exceptions/resolve').set(h.auth(finance.token)).send(resolveBody).expect(409); // not posted yet
      await h.http().post('/admin/adjustments').set(h.auth(finance.token)).set('Idempotency-Key', h.key())
        .send({ kind: 'topup_correction', userId: rider.id, providerReference: reference, amountKobo: 300_000, reason: 'duplicate ask' }).expect(409); // one correction per payment

      await h.http().post(`/admin/adjustments/${right.body.id}/approve`).set(h.auth(financeB.token)).expect(200, { approved: true });
      expect(await h.wallet(rider.id)).toBe(300_000);
      expect(await h.ledger.totalImbalanceKobo()).toBe(0);
      const intent = await h.pool.query(`SELECT status FROM payment_intents WHERE reference = $1`, [reference]);
      expect(intent.rows[0].status).toBe('SUCCESS');

      // Paystack re-sending the webhook now changes nothing: the same ledger key is already used.
      await h.http().post('/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', paystackSignature(raw, TEST_KEY)).send(raw).expect(200, { outcome: 'duplicate' });
      expect(await h.wallet(rider.id)).toBe(300_000);

      await h.http().post('/admin/payment-exceptions/resolve').set(h.auth(finance.token)).send(resolveBody).expect(204);
      await h.http().post('/admin/payment-exceptions/resolve').set(h.auth(finance.token)).send(resolveBody).expect(409); // already closed
      const after = await h.http().get('/admin/payment-exceptions').set(h.auth(finance.token)).expect(200);
      expect(after.body.map((e: { sourceId: string }) => e.sourceId)).not.toContain(reference);
    });

    it('will not correct a payment that was already credited normally', async () => {
      const rider = await h.login('rider');
      const financeA = await h.staff('finance');
      const financeB = await h.staff('finance');
      const t = await h.http().post('/wallet/topups').set(h.auth(rider.token)).send({ amountKobo: 200_000 }).expect(200);
      const reference = t.body.reference as string;
      h.provider.txs.set(reference, { reference, status: 'success', amountKobo: 200_000, currency: 'NGN' });
      const raw = JSON.stringify({ event: 'charge.success', data: { reference } });
      await h.http().post('/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', paystackSignature(raw, TEST_KEY)).send(raw).expect(200, { outcome: 'credited' });

      const req = await h.http().post('/admin/adjustments').set(h.auth(financeA.token)).set('Idempotency-Key', h.key())
        .send({ kind: 'topup_correction', userId: rider.id, providerReference: reference, amountKobo: 200_000, reason: 'Looks missing' }).expect(200);
      const res = await h.http().post(`/admin/adjustments/${req.body.id}/approve`).set(h.auth(financeB.token)).expect(409);
      expect(res.body.code).toBe('already_credited');
      expect(await h.wallet(rider.id)).toBe(200_000); // credited once, not twice
    });

    // Only one reconciliation runs at a time across the whole system; if another holds the lock, wait for it.
    async function reconcile(token: string) {
      for (let i = 0; i < 40; i++) {
        const r = await h.http().post('/admin/reconciliation/run').set(h.auth(token)).expect(200);
        if (r.body.runId) return;
        await new Promise((res) => setTimeout(res, 250));
      }
      throw new Error('reconciliation lock never freed');
    }

    it('lists a reconciliation finding once, and stops listing it when resolved', async () => {
      const finance = await h.staff('finance');
      const reference = `topup_${randomUUID()}`;
      h.provider.txs.set(reference, { reference, status: 'success', amountKobo: 123_000, currency: 'NGN' }); // paid at Paystack, unknown to us
      await reconcile(finance.token);
      await reconcile(finance.token); // the next hourly run sees it again

      const open = await h.http().get('/admin/payment-exceptions').set(h.auth(finance.token)).expect(200);
      const hits = open.body.filter((e: { sourceId: string }) => e.sourceId === `unknown_reference:${reference}`);
      expect(hits).toHaveLength(1);
      await h.http().post('/admin/payment-exceptions/resolve').set(h.auth(finance.token))
        .send({ sourceKind: 'finding', sourceId: `unknown_reference:${reference}`, resolution: 'dismissed', note: 'Test payment from the Paystack dashboard' }).expect(204);
      await reconcile(finance.token);
      const later = await h.http().get('/admin/payment-exceptions').set(h.auth(finance.token)).expect(200);
      expect(later.body.map((e: { sourceId: string }) => e.sourceId)).not.toContain(`unknown_reference:${reference}`);

      await h.http().post('/admin/payment-exceptions/resolve').set(h.auth(finance.token))
        .send({ sourceKind: 'finding', sourceId: 'unknown_reference:typo', resolution: 'dismissed', note: 'no such thing' }).expect(404);
      await h.http().post('/admin/payment-exceptions/resolve').set(h.auth(finance.token))
        .send({ sourceKind: 'finding', sourceId: `unknown_reference:${reference}`, resolution: 'corrected', note: 'missing adjustment' }).expect(400);
    }, 60_000);
  });
});
