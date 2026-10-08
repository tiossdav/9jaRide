import { randomUUID } from 'crypto';
import { planCashTrip, planWalletTrip } from './ledger/postings';
import { discountFor } from './promo/promo.service';
import { bootApp, uniquePlate } from './testing/harness.testing';

jest.setTimeout(60_000);

// Unit tests: how much a code takes off, and how the ledger pays for it.
describe('discountFor', () => {
  const base = { kind: 'percent' as const, value: 1000, max_discount_kobo: null, min_fare_kobo: 0 };
  it('takes a percentage of the fare', () => expect(discountFor(base, 226_000)).toBe(22_600));
  it('stops at the cap', () => expect(discountFor({ ...base, max_discount_kobo: 10_000 }, 226_000)).toBe(10_000));
  it('takes a fixed amount, but never more than the fare', () => {
    expect(discountFor({ ...base, kind: 'fixed', value: 50_000 }, 226_000)).toBe(50_000);
    expect(discountFor({ ...base, kind: 'fixed', value: 50_000 }, 30_000)).toBe(30_000);
  });
  it('gives nothing below the minimum fare', () => expect(discountFor({ ...base, min_fare_kobo: 300_000 }, 226_000)).toBe(0));
  it('gives nothing on a zero fare', () => expect(discountFor(base, 0)).toBe(0));
  it('can be the whole fare', () => expect(discountFor({ ...base, value: 10_000 }, 226_000)).toBe(226_000));
});

describe('who pays for a discount', () => {
  const sum = (ps: { amountKobo: number }[]) => ps.reduce((n, p) => n + p.amountKobo, 0);
  const of = (ps: { account: string; amountKobo: number }[], a: string) => ps.find((p) => p.account === a)?.amountKobo ?? 0;

  it('charges the rider less, keeps the driver whole, and bills the platform', () => {
    const plain = planWalletTrip('r', 'd', 226_000, 3_000);
    const promo = planWalletTrip('r', 'd', 226_000, 3_000, 1200, false, 50_000);
    expect(of(promo, 'wallet:r')).toBe(-176_000);
    expect(of(promo, 'wallet:d')).toBe(of(plain, 'wallet:d')); // the driver's share is untouched
    expect(of(promo, 'platform:commission')).toBe(of(plain, 'platform:commission'));
    expect(of(promo, 'platform:promo')).toBe(-50_000);
    expect(sum(promo)).toBe(0);
  });
  it('charges the rider nothing when the code covers the whole fare', () => {
    const p = planWalletTrip('r', 'd', 100_000, 0, 1200, false, 100_000);
    expect(of(p, 'wallet:r')).toBe(0);
    expect(sum(p)).toBe(0);
  });
  it('on a cash trip, pays the driver back the cash the rider did not hand over', () => {
    const plain = planCashTrip('d', 226_000, 3_000);
    const promo = planCashTrip('d', 226_000, 3_000, 1200, false, 50_000);
    expect(of(promo, 'wallet:d')).toBe(of(plain, 'wallet:d') + 50_000);
    expect(of(promo, 'platform:promo')).toBe(-50_000);
    expect(sum(promo)).toBe(0);
  });
  it('refuses a discount larger than the fare', () => expect(() => planWalletTrip('r', 'd', 10_000, 0, 1200, false, 10_001)).toThrow(RangeError));
});

const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;
const pickup = { lat: 6.5244, lng: 3.3792 };
const dropoff = { lat: 6.45, lng: 3.4 };

suite('promo codes, end to end', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    h = await bootApp();
    await h.pool.query(
      `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, tax_kobo, created_by, approved_by, approved_at)
       VALUES ('package', now() - interval '1 day' - (random() * 1000000 || ' microseconds')::interval, 20000, 12000, 1500, 3000, $1, $2, now())`,
      [randomUUID(), randomUUID()],
    );
  }, 60_000);
  afterAll(async () => {
    await h.pool.query(`UPDATE rides SET status = 'CANCELLED_BY_SYSTEM', cancel_reason = 'test cleanup' WHERE status = 'SEARCHING_DRIVER'`);
    await h.close();
  });

  const newCode = () => `T${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  it('is managed by finance and admin only, with sensible checks', async () => {
    const finance = await h.staff('finance');
    const support = await h.staff('support');
    const rider = await h.login('rider');
    await h.http().get('/admin/promos').set(h.auth(support.token)).expect(403);
    await h.http().get('/admin/promos').set(h.auth(rider.token)).expect(403);
    const code = newCode();
    await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code: 'no', kind: 'percent', value: 1000 }).expect(400);
    await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code, kind: 'percent', value: 10_001 }).expect(400); // over 100%
    await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code, kind: 'percent', value: 1000, startsAt: '2026-01-02T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' }).expect(400);
    const made = (await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code: code.toLowerCase(), kind: 'percent', value: 1000, maxDiscountKobo: 20_000, description: 'Test' }).expect(200)).body;
    await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code, kind: 'fixed', value: 5000 }).expect(409); // same code
    const row = (await h.http().get('/admin/promos').set(h.auth(finance.token)).expect(200)).body.find((p: { id: string }) => p.id === made.id);
    expect(row).toMatchObject({ code, kind: 'percent', value: 1000, state: 'live', uses: 0 });
    await h.http().patch(`/admin/promos/${made.id}`).set(h.auth(finance.token)).send({ value: 1500, maxUses: 5, description: 'Changed' }).expect(204);
    expect((await h.http().get('/admin/promos').set(h.auth(finance.token)).expect(200)).body.find((p: { id: string }) => p.id === made.id)).toMatchObject({ value: 1500, maxUses: 5 });
  });

  it('tells a rider plainly why a code does not work', async () => {
    const finance = await h.staff('finance');
    const rider = await h.login('rider');
    const check = (code: string, category = 'package') => h.http().post('/rides/promo/check').set(h.auth(rider.token)).send({ code, category, distanceM: 4000, durationS: 700 });
    const msg = async (code: string, category?: string) => (await check(code, category).expect(422)).body.message as string;

    expect(await msg('NOSUCHCODE')).toBe('That code is not valid.');
    const make = async (extra: object) => { const code = newCode(); await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code, kind: 'fixed', value: 5000, ...extra }).expect(200); return code; };
    expect(await msg(await make({ active: false }))).toBe('That code is not valid.');
    expect(await msg(await make({ startsAt: new Date(Date.now() + 86_400_000).toISOString() }))).toBe('That code is not active yet.');
    expect(await msg(await make({ startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), endsAt: new Date(Date.now() - 86_400_000).toISOString() }))).toBe('That code has expired.');
    expect(await msg(await make({ categories: ['comfort'] }))).toBe('That code does not apply to this kind of ride.');
    expect(await msg(await make({ minFareKobo: 100_000_000 }))).toMatch(/needs a fare of at least/);

    const ok = (await check((await make({})).toLowerCase()).expect(200)).body; // not case sensitive
    expect(ok.discountKobo).toBe(5000);
    expect(ok.payKobo).toBe(ok.expectedKobo - 5000);
  });

  it('applies a code to a trip: the rider pays less, the driver is paid in full, the platform bears the cost', async () => {
    const finance = await h.staff('finance');
    const rider = await h.login('rider', 'Promo Rider');
    const driver = await h.login('driver', 'Promo Driver');
    await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Honda', 'Red', $2)`, [driver.id, uniquePlate()]);
    const code = newCode();
    await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code, kind: 'percent', value: 2000, perRiderLimit: 1 }).expect(200);

    const book = async (promoCode: string | undefined, status: number) => {
      const q = (await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 4000, durationS: 700 }).expect(200)).body;
      return h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key())
        .send({ quoteId: q.quoteId, category: 'package', paymentMethod: 'cash', pickup, dropoff, ...(promoCode ? { promoCode } : {}) }).expect(status);
    };

    const first = (await book(code, 200)).body.rideId as string;
    expect((await book(code, 422)).body.message).toBe('You have already used that code.'); // once per rider

    // cancelling frees the code again
    await h.http().post(`/rides/${first}/cancel`).set(h.auth(rider.token)).send({}).expect(200);
    const ride = (await book(code, 200)).body.rideId as string;

    // drive it to completion
    await h.pool.query(`UPDATE rides SET status = 'IN_TRANSIT', driver_id = $2 WHERE id = $1`, [ride, driver.id]);
    await h.pool.query(`INSERT INTO ride_status_history (ride_id, from_status, to_status) VALUES ($1, 'DRIVER_ARRIVED', 'IN_TRANSIT')`, [ride]);
    const promoBefore = await h.platform('platform:promo');
    const done = (await h.http().post(`/driver/rides/${ride}/complete`).set(h.auth(driver.token)).send({ distanceM: 4000, durationS: 700, waitingS: 0 }).expect(200)).body;

    const seen = (await h.http().get(`/rides/${ride}`).set(h.auth(rider.token)).expect(200)).body;
    expect(seen.promoCode).toBe(code);
    expect(seen.discountKobo).toBe(Math.floor((done.totalKobo * 2000 + 5000) / 10000));
    expect(seen.payableKobo).toBe(done.totalKobo - seen.discountKobo);
    expect(await h.platform('platform:promo')).toBe(promoBefore - seen.discountKobo);

    const receipt = (await h.http().get(`/rides/${ride}/receipt`).set(h.auth(rider.token)).expect(200)).body;
    expect(receipt).toMatchObject({ totalKobo: done.totalKobo, discountKobo: seen.discountKobo, payableKobo: seen.payableKobo, promoCode: code });
    expect(receipt.lines.reduce((n: number, l: { amountKobo: number }) => n + l.amountKobo, 0)).toBe(done.totalKobo); // the fare lines are untouched

    const uses = (await h.http().get('/admin/promos').set(h.auth(finance.token)).expect(200)).body.find((p: { code: string }) => p.code === code);
    expect(uses).toMatchObject({ uses: 1, givenKobo: seen.discountKobo });
    const log = (await h.http().get(`/admin/promos/${uses.id}/uses`).set(h.auth(finance.token)).expect(200)).body;
    expect(log.find((u: { rideId: string }) => u.rideId === ride)).toMatchObject({ discountKobo: seen.discountKobo });
  });

  it('stops a code that has been used up', async () => {
    const finance = await h.staff('finance');
    const a = await h.login('rider');
    const b = await h.login('rider');
    const code = newCode();
    await h.http().post('/admin/promos').set(h.auth(finance.token)).send({ code, kind: 'fixed', value: 1000, maxUses: 1, perRiderLimit: 5 }).expect(200);
    const book = async (who: { token: string }, status: number) => {
      const q = (await h.http().post('/rides/quote').set(h.auth(who.token)).send({ category: 'package', distanceM: 3000, durationS: 500 }).expect(200)).body;
      return h.http().post('/rides').set(h.auth(who.token)).set('Idempotency-Key', h.key()).send({ quoteId: q.quoteId, category: 'package', paymentMethod: 'cash', pickup, dropoff, promoCode: code }).expect(status);
    };
    await book(a, 200);
    expect((await book(b, 422)).body.message).toBe('That code has been used up.');
  });
});
