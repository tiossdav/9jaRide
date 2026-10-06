import { randomUUID } from 'crypto';
import { bootApp } from './testing/harness.testing';

// Going further than the booked destination: who may ask, who must answer, what changes only on a yes, what a no leaves alone, the
// money held for a wallet trip, and the fare check at the end. Real HTTP, Postgres and Valkey.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('trip extension', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  // about 5 km further east than the booked drop-off at (6.4, 3.4)
  const FURTHER = { lat: 6.4, lng: 3.445, address: 'Ikeja City Mall, Ikeja, Lagos', distanceM: 5800, durationS: 900 };

  /** A trip under way, priced at ₦100 a km and ₦20 a minute (no booking fee), with a quote of ₦1,000 to ₦1,400. */
  async function trip(riderId: string, driverId: string, opts: { method?: 'cash' | 'wallet'; status?: string } = {}) {
    const pv = await h.pool.query(
      `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, created_by, approved_by, approved_at)
       VALUES ('regular', now() - interval '3 years' - (random() * 1000000 || ' microseconds')::interval, 0, 10000, 2000, $1, $2, now()) RETURNING id`, [randomUUID(), randomUUID()]);
    const q = await h.pool.query(
      `INSERT INTO fare_quotes (rider_id, category, pricing_version_id, distance_m, duration_s, expected_kobo, low_kobo, high_kobo, expires_at)
       VALUES ($1, 'regular', $2, 10000, 1200, 100000, 90000, 140000, now() + interval '1 hour') RETURNING id`, [riderId, pv.rows[0].id]);
    const r = await h.pool.query(
      `INSERT INTO rides (short_code, rider_id, driver_id, category, status, payment_status, payment_method, pickup, dropoff, dropoff_address, idempotency_key, fare_quote_id, pricing_version_id)
       VALUES ($1, $2, $3, 'regular', $4, 'UNPAID', $5, ST_SetSRID(ST_MakePoint(3.3, 6.5), 4326)::geography, ST_SetSRID(ST_MakePoint(3.4, 6.4), 4326)::geography, 'Original Place, Lagos', $6, $7, $8) RETURNING id`,
      [randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(), riderId, driverId, opts.status ?? 'TRIP_STARTED', opts.method ?? 'cash', randomUUID(), q.rows[0].id, pv.rows[0].id]);
    return r.rows[0].id as string;
  }

  const ask = (who: { token: string }, id: string, body: object = FURTHER) => h.http().post(`/rides/${id}/extension`).set(h.auth(who.token)).send(body);
  const answer = (who: { token: string }, id: string, ext: string, what: 'accept' | 'decline' | 'withdraw', body: object = {}) =>
    h.http().post(`/rides/${id}/extension/${ext}/${what}`).set(h.auth(who.token)).send(body);
  const seen = async (who: { token: string }, id: string) => (await h.http().get(`/rides/${id}`).set(h.auth(who.token)).expect(200)).body;
  const dropoff = async (id: string) => (await h.pool.query(`SELECT ST_X(dropoff::geometry) AS lng, dropoff_address AS a FROM rides WHERE id = $1`, [id])).rows[0];

  it('prices the extra stretch, asks the rider, and changes nothing until they accept', async () => {
    const rider = await h.login('rider', 'Ext Rider');
    const driver = await h.login('driver', 'Ext Driver');
    const id = await trip(rider.id, driver.id);

    const e = (await ask(driver, id).expect(200)).body;
    // 5.8 km at ₦100 + 15 min at ₦20 = ₦880, rounded to the step
    expect(e).toMatchObject({ requestedBy: 'driver', mine: true, status: 'PENDING', extraDistanceM: 5800, extraDurationS: 900 });
    expect(e.extraKobo).toBeGreaterThanOrEqual(88_000);
    expect(e.extraKobo).toBeLessThan(90_000);
    expect(e.newTotalKobo).toBe(100_000 + e.extraKobo);

    // the rider sees the question from their side, and the trip is still as booked
    const r1 = await seen(rider, id);
    expect(r1.extension).toMatchObject({ id: e.id, mine: false, status: 'PENDING', newDropoff: { address: 'Ikeja City Mall, Ikeja, Lagos' } });
    expect(r1.extensionVersion).toContain(e.id);
    expect((await dropoff(id)).a).toBe('Original Place, Lagos');
    expect(r1.estimate).toMatchObject({ lowKobo: 90_000, highKobo: 140_000 });

    // the one who asked cannot answer for the other, and a second question waits for the first
    await answer(driver, id, e.id, 'accept').expect(403);
    await ask(driver, id).expect(409);
    await ask(rider, id).expect(409);

    const accepted = (await answer(rider, id, e.id, 'accept').expect(200)).body;
    expect(accepted.status).toBe('ACCEPTED');
    const after = await dropoff(id);
    expect(after.a).toBe('Ikeja City Mall, Ikeja, Lagos');
    expect(after.lng).toBeCloseTo(3.445, 3);
    // both see the new place and the new expected total; the quoted range is widened by the extension
    const r2 = await seen(rider, id);
    expect(r2.dropoffAddress).toBe('Ikeja City Mall, Ikeja, Lagos');
    expect(r2.estimate.expectedKobo).toBe(100_000 + e.extraKobo);
    expect(r2.estimate.highKobo).toBe(140_000 + e.highKobo);
    const active = (await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride;
    expect(active.expectedKobo).toBe(100_000 + e.extraKobo);
    expect(active.dropoff.lng).toBeCloseTo(3.445, 3);
    // an accepted answer repeated by a retried tap is harmless
    await answer(rider, id, e.id, 'accept').expect(200);
    // and it is in the trip's history
    const history = await h.pool.query(`SELECT reason FROM ride_status_history WHERE ride_id = $1 AND reason LIKE 'Trip extended%'`, [id]);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].reason).toContain('Ikeja City Mall');
  });

  it('leaves the trip exactly as booked when the rider declines, and the driver can ask again or carry on', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id);
    const e = (await ask(driver, id).expect(200)).body;
    const declined = (await answer(rider, id, e.id, 'decline', { reason: 'Too expensive' }).expect(200)).body;
    expect(declined).toMatchObject({ status: 'DECLINED', declineReason: 'Too expensive' });
    expect((await dropoff(id)).a).toBe('Original Place, Lagos');
    const forDriver = (await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride;
    expect(forDriver.extension).toMatchObject({ status: 'DECLINED', declineReason: 'Too expensive', mine: true });
    expect(forDriver.expectedKobo).toBe(100_000);
    // it cannot be accepted afterwards, but a different suggestion can be made
    await answer(rider, id, e.id, 'accept').expect(409);
    const again = (await ask(driver, id, { ...FURTHER, lng: 3.43, distanceM: 3000, address: 'Nearer Place' }).expect(200)).body;
    expect(again.status).toBe('PENDING');
    // the rider can also turn it round: withdraw nothing of theirs, decline, and the original trip still completes on its own terms
    await answer(rider, id, again.id, 'decline').expect(200);
    const done = await h.http().post(`/driver/rides/${id}/complete`).set(h.auth(driver.token)).send({ distanceM: 10_000, durationS: 1200, waitingS: 0 }).expect(200);
    expect(done.body.totalKobo).toBe(140_000); // 10 km at ₦100 + 20 min at ₦20, unaffected by the declined asks
    expect(done.body.outsideQuoteRange).toBe(false);
  });

  it('lets the rider ask too, and then it is the driver who answers', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id);
    const e = (await ask(rider, id).expect(200)).body;
    expect(e).toMatchObject({ requestedBy: 'rider', mine: true });
    await answer(rider, id, e.id, 'accept').expect(403);
    const forDriver = (await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride.extension;
    expect(forDriver).toMatchObject({ id: e.id, requestedBy: 'rider', mine: false, status: 'PENDING' });
    // the driver says no: the rider is told and the trip goes on to the booked place
    await answer(driver, id, e.id, 'decline', { reason: 'Cannot go that far' }).expect(200);
    expect((await seen(rider, id)).extension).toMatchObject({ status: 'DECLINED', declineReason: 'Cannot go that far' });
    expect((await dropoff(id)).a).toBe('Original Place, Lagos');
    // a request can be taken back by whoever made it
    const e2 = (await ask(rider, id).expect(200)).body;
    await answer(driver, id, e2.id, 'withdraw').expect(403);
    expect((await answer(rider, id, e2.id, 'withdraw').expect(200)).body.status).toBe('CANCELLED');
    await answer(driver, id, e2.id, 'accept').expect(409);
  });

  it('only works on a trip under way, between its own two people, with a sensible place', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const stranger = await h.login('rider');
    const waiting = await trip(rider.id, driver.id, { status: 'DRIVER_ASSIGNED' });
    await ask(driver, waiting).expect(409);
    const id = await trip(rider.id, (await h.login('driver')).id);
    await ask(stranger, id).expect(404);
    await ask(rider, id, { ...FURTHER, lng: 3.4001, distanceM: 50 }).expect(400); // that is where they are already going
    await ask(rider, id, { ...FURTHER, distanceM: 800 }).expect(400); // shorter than the straight line
    await ask(rider, id, { ...FURTHER, distanceM: 90_000 }).expect(400); // absurdly long
    await h.http().post(`/rides/${id}/extension`).send(FURTHER).expect(401);
  });

  it('lapses when nobody answers, so the trip simply goes on to the booked place', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id);
    const e = (await ask(driver, id).expect(200)).body;
    await h.pool.query(`UPDATE ride_extensions SET created_at = now() - interval '5 minutes' WHERE id = $1`, [e.id]);
    expect((await seen(rider, id)).extension.status).toBe('EXPIRED');
    await answer(rider, id, e.id, 'accept').expect(409);
    expect((await dropoff(id)).a).toBe('Original Place, Lagos');
    await ask(driver, id).expect(200); // a lapsed question does not block a new one
  });

  it('holds more of a wallet for the extra, refuses what the wallet cannot cover, and releases it all on completion', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    await h.fund(rider.id, 150_000);
    const id = await trip(rider.id, driver.id, { method: 'wallet' });
    await h.pool.query(`UPDATE rides SET payment_status = 'HELD' WHERE id = $1`, [id]);
    await h.pool.query(`INSERT INTO wallet_holds (account_id, ride_id, amount_kobo) SELECT id, $1, 140000 FROM ledger_accounts WHERE code = $2`, [id, `wallet:${rider.id}`]);
    // ₦1,500 in the wallet, ₦1,400 already held: not enough for the extra
    const e = (await ask(driver, id).expect(409)).body;
    expect(e.code).toBe('insufficient_funds');
    await h.fund(rider.id, 200_000);
    const ok = (await ask(driver, id).expect(200)).body;
    await answer(rider, id, ok.id, 'accept').expect(200);
    const hold = await h.pool.query(`SELECT amount_kobo FROM wallet_holds WHERE ride_id = $1`, [id]);
    expect(Number(hold.rows[0].amount_kobo)).toBe(140_000 + ok.highKobo);
  });

  it('lets the held request notice a question being asked, and a completed fare for the extended trip is not flagged', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await trip(rider.id, driver.id);
    const version = (await seen(rider, id)).extensionVersion;
    expect(version).toBe('');
    const started = Date.now();
    const held = h.http().get(`/rides/${id}?waitFor=TRIP_STARTED&wait=10&ext=`).set(h.auth(rider.token)).then((r) => r);
    await new Promise((r) => setTimeout(r, 800));
    const e = (await ask(driver, id).expect(200)).body;
    const res = await held;
    expect(res.body.extension.id).toBe(e.id);
    expect(Date.now() - started).toBeLessThan(6000);

    await answer(rider, id, e.id, 'accept').expect(200);
    // 10 km + 5.8 km and 20 + 15 minutes: ₦1,000 + ₦880, inside the quoted range widened by the extension
    const done = await h.http().post(`/driver/rides/${id}/complete`).set(h.auth(driver.token)).send({ distanceM: 15_800, durationS: 2100, waitingS: 0 }).expect(200);
    expect(done.body.totalKobo).toBeGreaterThanOrEqual(180_000);
    expect(done.body.outsideQuoteRange).toBe(false);
    const receipt = (await h.http().get(`/rides/${id}/receipt`).set(h.auth(rider.token)).expect(200)).body;
    expect(receipt.extensions).toHaveLength(1);
  });
});
