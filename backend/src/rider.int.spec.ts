import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from './common/infra.module';
import { keys } from './dispatch/dispatch.types';
import { bootApp } from './testing/harness.testing';

// What the rider app relies on: profile, addresses, trip list, active ride, ratings. Real HTTP, Postgres and Valkey.
// Skipped unless INTEGRATION=1 (writes rows to DATABASE_URL).
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const pickup = { lat: 6.5244, lng: 3.3792 };
const dropoff = { lat: 6.45, lng: 3.4 };

suite('rider app endpoints', () => {
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

  it('tells the app who is signed in', async () => {
    const rider = await h.login('rider', 'Olaoluwa Taiwo');
    const me = await h.http().get('/me').set(h.auth(rider.token)).expect(200);
    expect(me.body).toMatchObject({ id: rider.id, role: 'rider', name: 'Olaoluwa Taiwo', phone: rider.phone });
  });

  it('keeps the addresses a rider typed, and shows the estimate on the ride', async () => {
    const rider = await h.login('rider');
    const q = await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 4000, durationS: 700 }).expect(200);
    const made = await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key())
      .send({ quoteId: q.body.quoteId, category: 'package', paymentMethod: 'cash', pickup, dropoff, pickupAddress: 'CXX4+65G, Akobo, Ibadan', dropoffAddress: 'Iwo Road, Ibadan' })
      .expect(200);
    const ride = await h.http().get(`/rides/${made.body.rideId}`).set(h.auth(rider.token)).expect(200);
    expect(ride.body).toMatchObject({
      pickupAddress: 'CXX4+65G, Akobo, Ibadan',
      dropoffAddress: 'Iwo Road, Ibadan',
      fareKobo: null,
      myRating: null,
    });
    expect(ride.body.estimate.lowKobo).toBeLessThanOrEqual(ride.body.estimate.highKobo);

    // It is the rider's active ride until it ends, and is not in the history yet.
    expect((await h.http().get('/rides/active').set(h.auth(rider.token)).expect(200)).body).toEqual({ rideId: made.body.rideId });
    expect((await h.http().get('/rides?scope=active').set(h.auth(rider.token)).expect(200)).body.map((r: { id: string }) => r.id)).toContain(made.body.rideId);
    expect((await h.http().get('/rides').set(h.auth(rider.token)).expect(200)).body).toEqual([]);

    await h.http().post(`/rides/${made.body.rideId}/cancel`).set(h.auth(rider.token)).send({ reason: 'Booked by mistake' }).expect(200);
    expect((await h.http().get('/rides/active').set(h.auth(rider.token)).expect(200)).body).toEqual({ rideId: null });
    const history = (await h.http().get('/rides').set(h.auth(rider.token)).expect(200)).body;
    expect(history[0]).toMatchObject({ id: made.body.rideId, status: 'CANCELLED_BY_RIDER', pickupAddress: 'CXX4+65G, Akobo, Ibadan' });
  });

  it('lists finished trips with what was charged, only to their rider', async () => {
    const rider = await h.login('rider');
    const other = await h.login('rider');
    const driver = await h.login('driver');
    const rideId = await h.completedRide(rider.id, driver.id, 226_000);
    const history = (await h.http().get('/rides').set(h.auth(rider.token)).expect(200)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: rideId, status: 'TRIP_COMPLETED', fareKobo: 226_000 });
    expect((await h.http().get('/rides').set(h.auth(other.token)).expect(200)).body).toEqual([]);
    await h.http().get('/rides').set(h.auth(driver.token)).expect(403);
  });

  it('takes one rating per finished trip, from its rider', async () => {
    const rider = await h.login('rider');
    const other = await h.login('rider');
    const driver = await h.login('driver');
    const rideId = await h.completedRide(rider.id, driver.id, 100_000);
    const rate = (token: string, body: object) => h.http().post(`/rides/${rideId}/rating`).set(h.auth(token)).send(body);

    await rate(rider.token, { stars: 6 }).expect(400);
    await rate(rider.token, { stars: 0 }).expect(400);
    await rate(other.token, { stars: 5 }).expect(404); // not their ride
    await rate(rider.token, { stars: 5, tags: ['Polite', 'On time'] }).expect(200, { saved: true });
    await rate(rider.token, { stars: 1 }).expect(200, { saved: false }); // the first rating stands
    expect((await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200)).body).toMatchObject({ myRating: 5, fareKobo: 100_000 });

    // the driver rates the rider on the same ride, separately, with a written comment
    await rate(driver.token, { stars: 4, tags: ['Polite'], comment: '  Waited at the gate  ' }).expect(200, { saved: true });
    await rate(driver.token, { stars: 1 }).expect(200, { saved: false });
    const rows = (await h.pool.query(`SELECT direction, ratee_id, comment, tags FROM ride_ratings WHERE ride_id = $1 ORDER BY direction`, [rideId])).rows;
    expect(rows).toEqual([
      { direction: 'driver_to_rider', ratee_id: rider.id, comment: 'Waited at the gate', tags: ['Polite'] },
      { direction: 'rider_to_driver', ratee_id: driver.id, comment: null, tags: ['Polite', 'On time'] },
    ]);
    const staff = await h.staff('admin');
    const analysis = (await h.http().get('/admin/console/ratings').query({ direction: 'driver_to_rider' }).set(h.auth(staff.token)).expect(200)).body;
    expect(analysis.direction).toBe('driver_to_rider'); // the database is shared with other suites, so only presence is checked
    expect(analysis.withComment).toBeGreaterThanOrEqual(1);
    expect(analysis.topComments.find((t: { tag: string }) => t.tag === 'Polite').count).toBeGreaterThanOrEqual(1);

    const unfinished = (await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 2000, durationS: 300 }).expect(200)).body;
    const live = await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key())
      .send({ quoteId: unfinished.quoteId, category: 'package', paymentMethod: 'cash', pickup, dropoff }).expect(200);
    const res = await h.http().post(`/rides/${live.body.rideId}/rating`).set(h.auth(rider.token)).send({ stars: 4 }).expect(409);
    expect(res.body.code).toBe('wrong_state');
  });

  it('keeps the addresses on a scheduled ride, and lists them', async () => {
    const rider = await h.login('rider');
    const res = await h.http().post('/ride-schedules').set(h.auth(rider.token)).set('Idempotency-Key', h.key()).send({
      category: 'package', paymentMethod: 'cash', pickup, dropoff, distanceM: 3000, durationS: 600,
      firstPickupAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), repeat: 'none',
      pickupAddress: 'Home, Ibadan', dropoffAddress: 'Office, Ibadan',
    }).expect(200);
    expect(res.body).toMatchObject({ pickupAddress: 'Home, Ibadan', dropoffAddress: 'Office, Ibadan', distanceM: 3000 });
    const ride = await h.http().get(`/rides/${res.body.rides[0].rideId}`).set(h.auth(rider.token)).expect(200);
    expect(ride.body).toMatchObject({ status: 'SCHEDULED', pickupAddress: 'Home, Ibadan' });
    // A ride that is only booked for later is not "active": the rider is not in a car.
    expect((await h.http().get('/rides/active').set(h.auth(rider.token)).expect(200)).body).toEqual({ rideId: null });
  });
  it('shows the rider where the driver is, their number and rating, only while the trip is live', async () => {
    const rider = await h.login('rider');
    const other = await h.login('rider');
    const driver = await h.login('driver', 'Victor');
    await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Toyota', 'Blue', $2)`, [driver.id, `Z${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`]);
    const q = await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 3000, durationS: 500 }).expect(200);
    const made = await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key())
      .send({ quoteId: q.body.quoteId, category: 'package', paymentMethod: 'cash', pickup, dropoff }).expect(200);
    const id = made.body.rideId as string;

    await h.http().get(`/rides/${id}/driver-location`).set(h.auth(rider.token)).expect(200, { lat: null, lng: null, at: null }); // nobody yet
    await h.pool.query(`UPDATE rides SET status = 'DRIVER_ASSIGNED', driver_id = $2 WHERE id = $1`, [id, driver.id]);
    await h.pool.query(`INSERT INTO ride_status_history (ride_id, from_status, to_status) VALUES ($1, 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED')`, [id]);
    const redis: Redis = h.app.get(REDIS);
    await redis.hset(keys.driverState(driver.id), { status: 'on_trip', lat: '6.5301', lng: '3.3811', at: String(Date.now()) });
    await redis.expire(keys.driverState(driver.id), 30);

    const pos = await h.http().get(`/rides/${id}/driver-location`).set(h.auth(rider.token)).expect(200);
    expect(pos.body).toMatchObject({ lat: 6.5301, lng: 3.3811 });
    await h.http().get(`/rides/${id}/driver-location`).set(h.auth(other.token)).expect(404); // someone else's ride

    const ride = (await h.http().get(`/rides/${id}`).set(h.auth(rider.token)).expect(200)).body;
    expect(ride.driver).toMatchObject({ name: 'Victor', phone: driver.phone, rating: null });
    expect(typeof ride.statusChangedAt).toBe('string');

    await h.pool.query(`UPDATE rides SET status = 'CANCELLED_BY_SYSTEM' WHERE id = $1`, [id]);
    expect((await h.http().get(`/rides/${id}`).set(h.auth(rider.token)).expect(200)).body.driver.phone).toBeNull(); // trip over: number withheld
    await h.http().get(`/rides/${id}/driver-location`).set(h.auth(rider.token)).expect(200, { lat: null, lng: null, at: null });
    await redis.del(keys.driverState(driver.id));
  });

  it('lists wallet activity, newest first', async () => {
    const rider = await h.login('rider');
    await h.fund(rider.id, 120_000);
    await h.fund(rider.id, 50_000);
    const tx = (await h.http().get('/wallet/transactions').set(h.auth(rider.token)).expect(200)).body;
    expect(tx.map((t: { amountKobo: number }) => t.amountKobo)).toEqual([50_000, 120_000]);
    expect(tx[0]).toMatchObject({ kind: 'bonus' });
    const driver = await h.login('driver');
    expect((await h.http().get('/wallet/transactions').set(h.auth(driver.token)).expect(200)).body).toEqual([]);
  });
});
