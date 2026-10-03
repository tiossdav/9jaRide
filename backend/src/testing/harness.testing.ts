import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { AuthService } from '../auth/auth.service';
import { OTP_SENDER } from '../auth/auth.types';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { PaystackClient } from '../payments/paystack.client';
import { FakeProvider } from '../payments/testing/fake-provider.testing';

/** The real app on a real port, with only SMS and Paystack faked. Shared by the HTTP integration specs. */
export async function bootApp() {
  process.env.JWT_SECRET = 'test-secret-' + 'x'.repeat(40);
  const provider = new FakeProvider();
  const codes = new Map<string, string>();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_SENDER)
    .useValue({ send: async (phone: string, code: string) => void codes.set(phone, code) })
    .overrideProvider(PaystackClient)
    .useValue(provider)
    .compile();
  const app: INestApplication = mod.createNestApplication({ rawBody: true });
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
  configureApp(app);
  await app.listen(0);
  const baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');

  const pool: Pool = app.get(PG_POOL);
  const ledger = app.get(LedgerService);
  const authService = app.get(AuthService);
  const http = () => request(baseUrl);
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

  const wallet = (id: string) => ledger.withTransaction((c) => ledger.balanceKobo(c, `wallet:${id}`));
  const platform = (code: string) => ledger.withTransaction((c) => ledger.balanceKobo(c, code));
  const fund = (id: string, kobo: number) => ledger.withTransaction((c) => ledger.awardBonus(c, id, kobo, `fund-${randomUUID()}`));

  /** A finished, priced ride, written directly so tests of refunds do not depend on the dispatch flow. */
  async function completedRide(riderId: string, driverId: string, totalKobo: number): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pv = await client.query(
        `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, created_by, approved_by, approved_at)
         VALUES ('regular', now() - interval '2 years' - (random() * 1000000 || ' microseconds')::interval, 0, 0, 0, $1, $2, now()) RETURNING id`,
        [randomUUID(), randomUUID()],
      );
      const ride = await client.query(
        `INSERT INTO rides (short_code, rider_id, driver_id, category, status, payment_status, payment_method, pickup, dropoff, idempotency_key)
         VALUES ($1, $2, $3, 'regular', 'TRIP_COMPLETED', 'PAID', 'cash',
                 ST_SetSRID(ST_MakePoint(3.3, 6.5), 4326)::geography, ST_SetSRID(ST_MakePoint(3.4, 6.4), 4326)::geography, $4) RETURNING id`,
        [randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(), riderId, driverId, randomUUID()],
      );
      const id = ride.rows[0].id as string;
      await client.query(
        `INSERT INTO ride_fares (ride_id, pricing_version_id, distance_m, duration_s, waiting_s, subtotal_kobo, rounding_kobo, tax_kobo, total_kobo)
         VALUES ($1, $2, 1000, 100, 0, $3, 0, 0, $3)`,
        [id, pv.rows[0].id, totalKobo],
      );
      await client.query(`INSERT INTO ride_fare_lines (ride_id, position, kind, label, amount_kobo) VALUES ($1, 0, 'service', 'Service', $2)`, [id, totalKobo]);
      await client.query('COMMIT');
      return id;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  return { app, pool, ledger, provider, codes, http, auth, key, freshIp, newPhone, login, staff, wallet, platform, fund, completedRide, close: () => app.close() };
}
