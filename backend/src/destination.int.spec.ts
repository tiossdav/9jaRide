import { randomUUID } from 'crypto';
import { bootApp } from './testing/harness.testing';

// Changing the drop-off during a trip: who may do it, when, what it changes and what it leaves alone, the money held for a wallet trip,
// and the nationwide operating area. Real HTTP, Postgres and Valkey. No Google key is set in tests, so routes come back as marked estimates.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('changing the drop-off during a trip', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  // about 5 km east of the booked drop-off at (6.4, 3.4)
  const NEW_PLACE = { lat: 6.4, lng: 3.445, address: 'Ikeja Computer Village, Lagos' };

  /** A trip, priced at ₦100 a km and ₦20 a minute (no booking fee), with a quote of ₦1,000 to ₦1,400. The driver is last seen near the pickup. */
  async function trip(riderId: string, driverId: string, opts: { method?: 'cash' | 'wallet'; status?: string; fix?: boolean } = {}) {
    const pv = await h.pool.query(
      `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, created_by, approved_by, approved_at)
       VALUES ('regular', now() - interval '3 years' - (random() * 1000000 || ' microseconds')::interval, 0, 10000, 2000, $1, $2, now()) RETURNING id`, [randomUUID(), randomUUID()]);
    const q = await h.pool.query(
      `INSERT INTO fare_quotes (rider_id, category, pricing_version_id, distance_m, duration_s, expected_kobo, low_kobo, high_kobo, expires_at)
       VALUES ($1, 'regular', $2, 10000, 1200, 100000, 90000, 140000, now() + interval '1 hour') RETURNING id`, [riderId, pv.rows[0].id]);
    const r = await h.pool.query(
      `INSERT INTO rides (short_code, rider_id, driver_id, category, status, payment_status, payment_method, pickup, pickup_address, dropoff, dropoff_address, idempotency_key, fare_quote_id, pricing_version_id)
       VALUES ($1, $2, $3, 'regular', $4, 'UNPAID', $5, ST_SetSRID(ST_MakePoint(3.3, 6.5), 4326)::geography, 'Original Pickup, Lagos', ST_SetSRID(ST_MakePoint(3.4, 6.4), 4326)::geography, 'Original Place, Lagos', $6, $7, $8) RETURNING id`,
      [randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(), riderId, driverId, opts.status ?? 'IN_TRANSIT', opts.method ?? 'cash', randomUUID(), q.rows[0].id, pv.rows[0].id]);
    if (opts.fix !== false) {
      await h.pool.query(`INSERT INTO driver_location_points (driver_id, recorded_at, location) VALUES ($1, now(), ST_SetSRID(ST_MakePoint(3.31, 6.49), 4326)::geography)`, [driverId]);
    }
    return r.rows[0].id as string;
  }

  const change = (who: { token: string }, id: string, body: object = NEW_PLACE) => h.http().put(`/rides/${id}/destination`).set(h.auth(who.token)).send(body);
  const seen = async (who: { token: string }, id: string) => (await h.http().get(`/rides/${id}`).set(h.auth(who.token)).expect(200)).body;
  const row = async (id: string) => (await h.pool.query(
    `SELECT ST_X(dropoff::geometry) AS lng, dropoff_address AS a, pickup_address AS p, ST_X(pickup::geometry) AS plng, status FROM rides WHERE id = $1`, [id])).rows[0];

  it('is refused before the driver arrives, and the button is off', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id, { status: 'DRIVER_ASSIGNED' });
    const refused = (await change(rider, id).expect(409)).body;
    expect(refused.code).toBe('destination_locked');
    expect((await seen(rider, id)).canEditDestination).toBe(false);
    expect((await row(id)).a).toBe('Original Place, Lagos');
  });

  it('works once the driver has arrived, keeps the pickup, and tells both sides', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id, { status: 'DRIVER_ARRIVED' });
    expect((await seen(rider, id)).canEditDestination).toBe(true);

    const res = (await change(rider, id).expect(200)).body;
    expect(res.changed).toBe(true);
    // routed from the driver (6.49, 3.31), not from the pickup, and the distance still to go is recorded
    expect(res.change.routeSource).toBe('estimate');
    expect(res.change.remainingDistanceM).toBeGreaterThan(14_000);
    expect(res.change.remainingDistanceM).toBeLessThan(25_000);
    const after = await row(id);
    expect(after).toMatchObject({ a: 'Ikeja Computer Village, Lagos', p: 'Original Pickup, Lagos', status: 'DRIVER_ARRIVED' });
    expect(after.lng).toBeCloseTo(3.445, 3);
    expect(after.plng).toBeCloseTo(3.3, 3);

    const r = await seen(rider, id);
    expect(r.dropoffAddress).toBe('Ikeja Computer Village, Lagos');
    expect(r.destinationChanges).toHaveLength(1);
    expect(r.destinationVersion).toBe(res.change.id);
    const active = (await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride;
    expect(active.dropoff).toMatchObject({ address: 'Ikeja Computer Village, Lagos' });
    expect(active.destinationVersion).toBe(res.change.id);
    expect(active.destinationChange).toMatchObject({ id: res.change.id, newDropoff: { address: 'Ikeja Computer Village, Lagos' } });
    // the status did not move and the change is noted in the trip history
    const history = await h.pool.query(`SELECT from_status, to_status, reason FROM ride_status_history WHERE ride_id = $1 AND reason LIKE 'Drop-off changed%'`, [id]);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({ from_status: 'DRIVER_ARRIVED', to_status: 'DRIVER_ARRIVED' });
  });

  it('can be done again while in transit, and choosing the same place again changes nothing', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id);
    await change(rider, id).expect(200);
    const again = (await change(rider, id).expect(200)).body;
    expect(again.changed).toBe(false);
    const other = (await change(rider, id, { lat: 6.45, lng: 3.5, address: 'Lekki Phase 1' }).expect(200)).body;
    expect(other.changed).toBe(true);
    expect((await seen(rider, id)).destinationChanges).toHaveLength(2);
  });

  it('is only for the rider on that ride, and only for a place in Nigeria', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const stranger = await h.login('rider');
    const id = await trip(rider.id, driver.id);
    await change(driver, id).expect(403);
    await change(stranger, id).expect(404);
    const abroad = (await change(rider, id, { lat: 5.6, lng: -0.19 }).expect(400)).body;
    expect(abroad.code).toBe('bad_location');
    await change(rider, id, { lat: 99, lng: 3 }).expect(400);
    expect((await row(id)).a).toBe('Original Place, Lagos');
  });

  it('waits for the driver position rather than guess the route', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id, { fix: false });
    expect((await change(rider, id).expect(409)).body.code).toBe('driver_location_unavailable');
    expect((await row(id)).a).toBe('Original Place, Lagos');
  });

  it('raises the money held on a wallet trip, and refuses what the wallet cannot cover', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    await h.fund(rider.id, 150_000);
    const id = await trip(rider.id, driver.id, { method: 'wallet' });
    await h.pool.query(`UPDATE rides SET payment_status = 'HELD' WHERE id = $1`, [id]);
    await h.pool.query(`INSERT INTO wallet_holds (account_id, ride_id, amount_kobo) SELECT id, $1, 140000 FROM ledger_accounts WHERE code = $2`, [id, `wallet:${rider.id}`]);
    // a place far further on: the extra high estimate is more than the ₦100 left in the wallet
    const far = { lat: 6.9, lng: 3.9, address: 'Far Place' };
    expect((await change(rider, id, far).expect(409)).body.code).toBe('insufficient_funds');
    expect((await row(id)).a).toBe('Original Place, Lagos');
    await h.fund(rider.id, 2_000_000);
    await change(rider, id, far).expect(200);
    const hold = await h.pool.query(`SELECT amount_kobo FROM wallet_holds WHERE ride_id = $1`, [id]);
    expect(Number(hold.rows[0].amount_kobo)).toBeGreaterThan(140_000);
  });

  it('releases a held request, and the fare range follows the new drop-off', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id);
    expect((await seen(rider, id)).destinationVersion).toBe('');
    const started = Date.now();
    const held = h.http().get(`/rides/${id}?waitFor=IN_TRANSIT&wait=10&dest=`).set(h.auth(driver.token)).then((r) => r);
    await new Promise((r) => setTimeout(r, 800));
    const res = (await change(rider, id).expect(200)).body;
    const heldRes = await held;
    expect(heldRes.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(6000);
    const r = await seen(rider, id);
    expect(r.estimate.expectedKobo).toBe(100_000 + res.change.deltaExpectedKobo);
    const done = await h.http().post(`/driver/rides/${id}/complete`).set(h.auth(driver.token)).send({ distanceM: 15_800, durationS: 2100, waitingS: 0 }).expect(200);
    expect(done.body.totalKobo).toBeGreaterThan(100_000);
    const receipt = (await h.http().get(`/rides/${id}/receipt`).set(h.auth(rider.token)).expect(200)).body;
    expect(receipt.destinationChanges).toHaveLength(1);
  });
});

suite('operating area', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  it('covers the whole of Nigeria by default, and refuses a pickup outside the country', async () => {
    const rider = await h.login('rider');
    const body = (pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) =>
      ({ quoteId: randomUUID(), category: 'regular', paymentMethod: 'cash', pickup, dropoff });
    const book = (b: object) => h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', randomUUID()).send(b);
    const ibadan = { lat: 7.3775, lng: 3.947 }, abuja = { lat: 9.0765, lng: 7.3986 }, portHarcourt = { lat: 4.8156, lng: 7.0498 }, kano = { lat: 12.0022, lng: 8.592 };
    const accra = { lat: 5.6037, lng: -0.187 };
    // each of these passes the area check (and then fails on the made-up quote, a different, later refusal)
    for (const from of [ibadan, abuja, portHarcourt, kano]) expect((await book(body(from, ibadan))).body.code).not.toBe('outside_service_area');
    expect((await book(body(accra, ibadan)).expect(409)).body.code).toBe('outside_service_area');
  });
});
