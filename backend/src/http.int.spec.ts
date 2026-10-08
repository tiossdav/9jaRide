import { uniquePlate } from './testing/harness.testing';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { randomInt, randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AuthService } from './auth/auth.service';
import { OTP_SENDER } from './auth/auth.types';
import { PG_POOL } from './common/infra.module';
import { LedgerService } from './ledger/ledger.service';
import { PaystackClient, paystackSignature } from './payments/paystack.client';
import { FakeProvider, TEST_KEY } from './payments/testing/fake-provider.testing';

// The real app over real HTTP, Postgres and Valkey. Only the SMS sender and Paystack are faked.
// Skipped unless INTEGRATION=1 (writes rows to DATABASE_URL):  INTEGRATION=1 DATABASE_URL=... npm test -- http.int
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('HTTP API (auth, rides, wallet, payouts, SOS)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let pool: Pool;
  let ledger: LedgerService;
  let authService: AuthService;
  const provider = new FakeProvider();
  const codes = new Map<string, string>();
  const SECRET = 'test-secret-' + 'x'.repeat(40);

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.OTP_MODE = 'live'; // real random codes and request limits
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue({ send: async (phone: string, code: string) => void codes.set(phone, code) })
      .overrideProvider(PaystackClient)
      .useValue(provider)
      .compile();
    app = mod.createNestApplication({ rawBody: true });
    (app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
    configureApp(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
    pool = app.get(PG_POOL);
    ledger = app.get(LedgerService);
    authService = app.get(AuthService);
  }, 60_000);
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(baseUrl.replace('[::1]', 'localhost'));
  const freshIp = () => `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = () => `key-${randomUUID()}`;
  const newPhone = () => `+23480${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function login(role: 'rider' | 'driver', fullName = 'Test Person') {
    const phone = newPhone();
    await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone }).expect(200);
    const ticket = await http().post('/auth/otp/verify').send({ phone, code: codes.get(phone) }).expect(422);
    const res = await http().post('/auth/register').send({ registrationTicket: ticket.body.registrationTicket, role, fullName }).expect(200);
    const me = await http().get('/me').set(auth(res.body.accessToken)).expect(200);
    return { phone, id: me.body.id as string, token: res.body.accessToken as string, refresh: res.body.refreshToken as string };
  }

  async function staff(role: 'support' | 'finance' | 'admin') {
    const email = `${role}-${randomUUID()}@example.test`;
    const password = 'correct horse battery staple';
    const id = await authService.createStaff(email, 'Staff Person', role, password);
    const res = await http().post('/auth/staff/login').send({ email, password }).expect(200);
    return { id, email, password, token: res.body.accessToken as string };
  }

  describe('authentication', () => {
    it('is closed by default and open only where marked public', async () => {
      await http().get('/me').expect(401);
      await http().get(`/rides/${randomUUID()}`).expect(401);
      await http().get('/admin/payouts').expect(401);
      await http().get('/health').expect(200, { ok: true });
    });

    it('signs a new number up with a code, then back in without re-registering', async () => {
      const phone = newPhone();
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone }).expect(200);
      const first = await http().post('/auth/otp/verify').send({ phone, code: codes.get(phone) }).expect(422);
      expect(first.body.code).toBe('registration_required');
      const reg = { registrationTicket: first.body.registrationTicket, role: 'driver', fullName: 'Ada Driver' };
      const ok = await http().post('/auth/register').send(reg).expect(200);
      expect(ok.body).toMatchObject({ role: 'driver', isNewUser: true });
      // A double tap on "finish sign-up" signs into the same account; it cannot change the role.
      const dup = await http().post('/auth/register').send({ ...reg, role: 'rider' }).expect(200);
      expect(dup.body).toMatchObject({ role: 'driver', isNewUser: false });
      // A registration ticket is not an access token, and an access token is not a ticket.
      await http().get('/me').set(auth(first.body.registrationTicket)).expect(401);
      await http().post('/auth/register').send({ ...reg, registrationTicket: ok.body.accessToken }).expect(401);

      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone }).expect(200);
      const again = await http().post('/auth/otp/verify').send({ phone, code: codes.get(phone) }).expect(200);
      expect(again.body.isNewUser).toBe(false);
    });

    it('accepts a code once, and locks it after five wrong guesses', async () => {
      const phone = newPhone();
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone }).expect(200);
      const code = codes.get(phone)!;
      await http().post('/auth/otp/verify').send({ phone, code }).expect(422); // right code, new number
      await http().post('/auth/otp/verify').send({ phone, code }).expect(401); // replay

      const phone2 = newPhone();
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone: phone2 }).expect(200);
      const real = codes.get(phone2)!;
      const wrong = real === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await http().post('/auth/otp/verify').send({ phone: phone2, code: wrong }).expect(401);
      await http().post('/auth/otp/verify').send({ phone: phone2, code: real }).expect(401); // now locked
    });

    it('rate-limits code requests per number', async () => {
      const phone = newPhone();
      for (let i = 0; i < 3; i++) await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone }).expect(200);
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone }).expect(429);
    });

    it('rate-limits code requests per source address', async () => {
      const ip = freshIp();
      for (let i = 0; i < 20; i++) await http().post('/auth/otp/request').set('X-Forwarded-For', ip).send({ phone: newPhone() }).expect(200);
      await http().post('/auth/otp/request').set('X-Forwarded-For', ip).send({ phone: newPhone() }).expect(429);
    });

    it('rejects malformed numbers and unknown fields', async () => {
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone: '12345' }).expect(400);
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone: newPhone(), role: 'admin' }).expect(400);
    });

    it('rotates refresh tokens, and a replayed one kills the whole login', async () => {
      const u = await login('rider');
      const r1 = await http().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(200);
      expect(r1.body.refreshToken).not.toBe(u.refresh);
      await http().get('/me').set(auth(r1.body.accessToken)).expect(200);

      // the same phone asking twice at once (two parts of the app, or a retry) is not signed out
      const twin = await http().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(200);
      await http().get('/me').set(auth(twin.body.accessToken)).expect(200);
      // a replay after the grace window is theft: the whole login ends
      await pool.query(`UPDATE auth_sessions SET used_at = now() - interval '5 minutes' WHERE token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [u.refresh]);
      await http().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(401); // replay of the used token
      await http().post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401); // family revoked
    });

    it('logs out one device, and everywhere', async () => {
      const u = await login('rider');
      await http().post('/auth/logout').send({ refreshToken: u.refresh }).expect(204);
      await http().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(401);

      const v = await login('rider');
      await http().post('/auth/logout-all').set(auth(v.token)).expect(204);
      await http().post('/auth/refresh').send({ refreshToken: v.refresh }).expect(401);
    });

    it('stops a suspended user at the next refresh', async () => {
      const u = await login('driver');
      await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
      await http().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(401);
      await http().post('/auth/otp/request').set('X-Forwarded-For', freshIp()).send({ phone: u.phone }).expect(200);
      await http().post('/auth/otp/verify').send({ phone: u.phone, code: codes.get(u.phone) }).expect(403);
    });

    it('rejects forged, unsigned and expired tokens', async () => {
      const u = await login('rider');
      const claims = { kind: 'staff', role: 'admin' };
      const opts = { subject: u.id, issuer: '9jaride', audience: '9jaride-api' } as const;
      const wrongKey = jwt.sign(claims, 'some-other-secret-' + 'y'.repeat(30), { ...opts, expiresIn: 60 });
      const expired = jwt.sign(claims, SECRET, { ...opts, expiresIn: -10 });
      const unsigned = jwt.sign(claims, '', { ...opts, algorithm: 'none' as any });
      const wrongAudience = jwt.sign(claims, SECRET, { ...opts, audience: 'someone-else', expiresIn: 60 });
      for (const t of [wrongKey, expired, unsigned, wrongAudience, 'garbage']) {
        await http().get('/me').set(auth(t)).expect(401);
      }
    });

    it('keeps riders, drivers and staff in their own lanes', async () => {
      const rider = await login('rider');
      const driver = await login('driver');
      await http().post('/driver/location').set(auth(rider.token)).send({ lat: 6.5, lng: 3.3 }).expect(403);
      await http().post('/rides/quote').set(auth(driver.token)).send({ category: 'regular', distanceM: 1000, durationS: 100 }).expect(403);
      await http().get('/admin/payouts').set(auth(rider.token)).expect(403);
      await http().get('/admin/sos').set(auth(driver.token)).expect(403);
      await http().post('/payouts').set(auth(rider.token)).set('Idempotency-Key', key()).send({}).expect(403);
    });

    it('locks a staff account after repeated wrong passwords, and gives no hint which emails exist', async () => {
      const s = await staff('support');
      const unknown = await http().post('/auth/staff/login').send({ email: 'nobody@example.test', password: 'whatever-password' }).expect(401);
      const wrong = await http().post('/auth/staff/login').send({ email: s.email, password: 'not-the-password' }).expect(401);
      expect(unknown.body.message).toBe(wrong.body.message);
      for (let i = 0; i < 4; i++) await http().post('/auth/staff/login').send({ email: s.email, password: 'not-the-password' }).expect(401);
      await http().post('/auth/staff/login').send({ email: s.email, password: s.password }).expect(429); // locked, even for the right password
    });
  });

  describe('a trip, end to end', () => {
    let driverVehiclePlate: string;

    beforeAll(async () => {
      // Test-only category pricing so this file does not depend on seed data.
      await pool.query(
        `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, tax_kobo, created_by, approved_by, approved_at)
         VALUES ('package', now() - interval '1 day' - (random() * 1000000 || ' microseconds')::interval, 20000, 12000, 1500, 3000, $1, $2, now())`,
        [randomUUID(), randomUUID()],
      );
    });

    async function onlineDriver() {
      const d = await login('driver', 'Driver Dee');
      driverVehiclePlate = uniquePlate();
      await pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Toyota', 'Silver', $2)`, [d.id, driverVehiclePlate]);
      const ping = () => http().post('/driver/location').set(auth(d.token)).send({ lat: 6.5244, lng: 3.3792, accuracyM: 8 }).expect(204);
      await ping();
      return { ...d, ping };
    }

    const quote = (token: string) =>
      http().post('/rides/quote').set(auth(token)).send({ category: 'package', distanceM: 5000, durationS: 900 }).expect(200);

    const rideBody = (quoteId: string, paymentMethod: 'cash' | 'wallet') => ({
      quoteId,
      category: 'package',
      paymentMethod,
      pickup: { lat: 6.5244, lng: 3.3792 },
      dropoff: { lat: 6.45, lng: 3.4 },
    });

    async function acceptWhenOffered(driver: { token: string; ping: () => Promise<unknown> }, rideId: string) {
      for (let i = 0; i < 60; i++) {
        await driver.ping(); // keep presence alive while we wait for the offer
        const r = await http().post(`/driver/rides/${rideId}/accept`).set(auth(driver.token)).expect(200);
        if (r.body.ok) return;
        await new Promise((res) => setTimeout(res, 250));
      }
      throw new Error('driver never received the offer');
    }

    it('quotes, requests, dispatches, drives, completes and produces a receipt that adds up', async () => {
      const driver = await onlineDriver();
      const rider = await login('rider', 'Rider Ray');
      const stranger = await login('rider');

      const q = await quote(rider.token);
      expect(q.body.lowKobo).toBeLessThanOrEqual(q.body.expectedKobo);
      const k = key();
      const first = await http().post('/rides').set(auth(rider.token)).set('Idempotency-Key', k).send(rideBody(q.body.quoteId, 'cash')).expect(200);
      const retry = await http().post('/rides').set(auth(rider.token)).set('Idempotency-Key', k).send(rideBody(q.body.quoteId, 'cash')).expect(200);
      expect(retry.body).toEqual({ rideId: first.body.rideId, duplicate: true });
      const rideId = first.body.rideId as string;

      await acceptWhenOffered(driver, rideId);

      const seen = await http().get(`/rides/${rideId}`).set(auth(rider.token)).expect(200);
      expect(seen.body.status).toBe('DRIVER_ASSIGNED');
      expect(seen.body.driver).toEqual({ name: 'Driver Dee', phone: expect.any(String), rating: null, vehicle: { make: 'Toyota', colour: 'Silver', plate: driverVehiclePlate } });
      await http().get(`/rides/${rideId}`).set(auth(stranger.token)).expect(404); // not their ride
      await http().get(`/rides/${rideId}`).set(auth((await staff('support')).token)).expect(200); // staff can look

      const other = await onlineDriver();
      await http().post(`/driver/rides/${rideId}/arrive`).set(auth(other.token)).expect(404); // not their ride
      await http().post(`/driver/rides/${rideId}/start`).set(auth(driver.token)).expect(409); // must arrive first
      await http().post(`/driver/rides/${rideId}/arrive`).set(auth(driver.token)).expect(204);
      await http().post(`/driver/rides/${rideId}/arrive`).set(auth(driver.token)).expect(204); // retried tap
      await http().post(`/driver/rides/${rideId}/start`).set(auth(driver.token)).expect(204);

      const done = { distanceM: 5000, durationS: 900, waitingS: 0 };
      await http().post(`/driver/rides/${rideId}/complete`).set(auth(rider.token)).send(done).expect(403); // riders cannot
      await http().post(`/driver/rides/${rideId}/complete`).set(auth(other.token)).send(done).expect(404);
      await http().post(`/driver/rides/${rideId}/complete`).set(auth(driver.token)).send({ ...done, distanceM: 5000.5 }).expect(400);
      const fare = await http().post(`/driver/rides/${rideId}/complete`).set(auth(driver.token)).send(done).expect(200);
      const again = await http().post(`/driver/rides/${rideId}/complete`).set(auth(driver.token)).send({ ...done, distanceM: 9000 }).expect(200);
      expect(again.body.totalKobo).toBe(fare.body.totalKobo); // a retry cannot reprice the trip

      const receipt = await http().get(`/rides/${rideId}/receipt`).set(auth(rider.token)).expect(200);
      expect(receipt.body.lines.reduce((s: number, l: { amountKobo: number }) => s + l.amountKobo, 0)).toBe(receipt.body.totalKobo);
      expect(receipt.body.totalKobo % 1000).toBe(0); // rounded to ₦10, with the rounding shown as its own line
      await http().get(`/rides/${rideId}/receipt`).set(auth(stranger.token)).expect(404);

      const ride = await http().get(`/rides/${rideId}`).set(auth(rider.token)).expect(200);
      expect(ride.body).toMatchObject({ status: 'TRIP_COMPLETED', paymentStatus: 'PAID' });
      expect(await ledger.totalImbalanceKobo()).toBe(0);
    }, 60_000);

    it('refuses a stale or foreign quote and leaves no ride behind', async () => {
      const rider = await login('rider');
      const other = await login('rider');
      const theirs = await quote(other.token);
      await http().post('/rides').set(auth(rider.token)).set('Idempotency-Key', key()).send(rideBody(randomUUID(), 'cash')).expect(422);
      await http().post('/rides').set(auth(rider.token)).set('Idempotency-Key', key()).send(rideBody(theirs.body.quoteId, 'cash')).expect(422);
      await http().post('/rides').set(auth(rider.token)).send(rideBody(theirs.body.quoteId, 'cash')).expect(400); // no Idempotency-Key
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM rides WHERE rider_id = $1`, [rider.id]);
      expect(rows[0].n).toBe(0);
    });

    it('holds wallet money at request time, and refuses a ride the wallet cannot cover', async () => {
      const rider = await login('rider');
      const q = await quote(rider.token);
      await http().post('/rides').set(auth(rider.token)).set('Idempotency-Key', key()).send(rideBody(q.body.quoteId, 'wallet')).expect(402);
      expect((await pool.query(`SELECT count(*)::int AS n FROM rides WHERE rider_id = $1`, [rider.id])).rows[0].n).toBe(0);

      // Top up through the real flow: initiate, provider says paid, signed webhook arrives.
      const t = await http().post('/wallet/topups').set(auth(rider.token)).send({ amountKobo: 1_000_000 }).expect(200);
      provider.txs.set(t.body.reference, { reference: t.body.reference, status: 'success', amountKobo: 1_000_000, currency: 'NGN' });
      const raw = JSON.stringify({ event: 'charge.success', data: { reference: t.body.reference } });
      const hook = () => http().post('/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', paystackSignature(raw, TEST_KEY)).send(raw);
      await hook().expect(200, { outcome: 'credited' });
      await hook().expect(200, { outcome: 'duplicate' });
      const w1 = await http().get('/wallet').set(auth(rider.token)).expect(200);
      expect(w1.body).toEqual({ balanceKobo: 1_000_000, availableKobo: 1_000_000 });

      const q2 = await quote(rider.token);
      await http().post('/rides').set(auth(rider.token)).set('Idempotency-Key', key()).send(rideBody(q2.body.quoteId, 'wallet')).expect(200);
      const w2 = await http().get('/wallet').set(auth(rider.token)).expect(200);
      expect(w2.body.balanceKobo).toBe(1_000_000);
      expect(w2.body.availableKobo).toBeLessThan(1_000_000); // reserved for the trip
    });
  });

  describe('webhooks', () => {
    it('rejects a call that is not signed by Paystack', async () => {
      const raw = JSON.stringify({ event: 'charge.success', data: { reference: 'topup_x' } });
      await http().post('/webhooks/paystack').set('Content-Type', 'application/json').send(raw).expect(401);
      await http().post('/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', paystackSignature(raw, 'wrong')).send(raw).expect(401);
      // A valid signature over DIFFERENT bytes (re-serialised JSON) must fail too.
      const sig = paystackSignature(raw, TEST_KEY);
      await http().post('/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(JSON.stringify(JSON.parse(raw), null, 2)).expect(401);
    });
  });

  describe('payouts with a second approver', () => {
    it('lets a driver request, finance approve, and nobody else touch it', async () => {
      const driver = await login('driver');
      await ledger.withTransaction((c) => ledger.awardBonus(c, driver.id, 500_000, `http-test-${randomUUID()}`));
      const body = { amountKobo: 200_000, bankCode: '058', accountNumber: '0123456789', accountName: 'Driver Dee' };

      await http().post('/payouts').set(auth(driver.token)).send(body).expect(400); // Idempotency-Key required
      const k = key();
      const made = await http().post('/payouts').set(auth(driver.token)).set('Idempotency-Key', k).send(body).expect(200);
      const retry = await http().post('/payouts').set(auth(driver.token)).set('Idempotency-Key', k).send(body).expect(200);
      expect(retry.body).toEqual({ id: made.body.id, duplicate: true });
      expect((await http().get('/wallet').set(auth(driver.token)).expect(200)).body.balanceKobo).toBe(300_000);
      await http().post('/payouts').set(auth(driver.token)).set('Idempotency-Key', key()).send({ ...body, amountKobo: 9_000_000 }).expect(402);

      const support = await staff('support');
      const finance = await staff('finance');
      await http().post(`/admin/payouts/${made.body.id}/approve`).set(auth(driver.token)).expect(403);
      await http().post(`/admin/payouts/${made.body.id}/approve`).set(auth(support.token)).expect(403);

      const queue = await http().get('/admin/payouts?status=PENDING_APPROVAL').set(auth(finance.token)).expect(200);
      expect(queue.body.map((p: { id: string }) => p.id)).toContain(made.body.id);
      await http().get('/admin/payouts?status=NONSENSE').set(auth(finance.token)).expect(400);

      await http().post(`/admin/payouts/${made.body.id}/approve`).set(auth(finance.token)).expect(200, { approved: true });
      const mine = await http().get('/payouts').set(auth(driver.token)).expect(200);
      expect(mine.body.find((p: { id: string }) => p.id === made.body.id).status).toBe('APPROVED');

      const audit = await pool.query(`SELECT path, status_code FROM staff_audit_log WHERE staff_id = $1`, [finance.id]);
      expect(audit.rows).toEqual([{ path: '/admin/payouts/:id/approve', status_code: 200 }]);
      const refused = await pool.query(`SELECT 1 FROM staff_audit_log WHERE staff_id = $1`, [support.id]);
      expect(refused.rowCount).toBe(0); // a 403 stops before the handler, so there is nothing to audit
    });

    it('lets finance reject, which returns the money', async () => {
      const driver = await login('driver');
      await ledger.withTransaction((c) => ledger.awardBonus(c, driver.id, 500_000, `http-test-${randomUUID()}`));
      const made = await http()
        .post('/payouts').set(auth(driver.token)).set('Idempotency-Key', key())
        .send({ amountKobo: 200_000, bankCode: '058', accountNumber: '0123456789', accountName: 'Driver Dee' }).expect(200);
      const finance = await staff('finance');
      await http().post(`/admin/payouts/${made.body.id}/reject`).set(auth(finance.token)).send({ reason: 'x' }).expect(400);
      await http().post(`/admin/payouts/${made.body.id}/reject`).set(auth(finance.token)).send({ reason: 'name does not match BVN' }).expect(200, { rejected: true });
      expect((await http().get('/wallet').set(auth(driver.token)).expect(200)).body.balanceKobo).toBe(500_000);
    });
  });

  describe('SOS', () => {
    it('stores the alert, shows it to support, and keeps it away from other users', async () => {
      const rider = await login('rider');
      const sos = await http().post('/sos').set(auth(rider.token)).set('Idempotency-Key', key()).send({ location: { lat: 6.5, lng: 3.3, accuracyM: 12 } }).expect(200);
      expect(sos.body).toMatchObject({ stored: true, duplicate: false });

      const support = await staff('support');
      const list = await http().get('/admin/sos').set(auth(support.token)).expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).toContain(sos.body.id);
      await http().post(`/admin/sos/${sos.body.id}/acknowledge`).set(auth(support.token)).expect(200, { acknowledged: true });
      await http().post(`/admin/sos/${sos.body.id}/acknowledge`).set(auth(support.token)).expect(200, { acknowledged: false });

      const finance = await staff('finance');
      await http().get('/admin/sos').set(auth(finance.token)).expect(403); // finance is not safety staff
      const stranger = await login('rider');
      await http().post(`/sos/${sos.body.id}/location`).set(auth(stranger.token)).send({ lat: 1, lng: 1 }).expect(204);
      const timeline = await http().get(`/admin/sos/${sos.body.id}/timeline`).set(auth(support.token)).expect(200);
      expect(timeline.body.map((t: { kind: string }) => t.kind)).not.toContain('location'); // someone else's call changed nothing
    });
  });
});
