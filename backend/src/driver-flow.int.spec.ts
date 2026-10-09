import { randomUUID } from 'crypto';
import { DispatchService } from './dispatch/dispatch.service';
import { bootApp, uniquePlate } from './testing/harness.testing';

// What the driver app uses to take a real order: see the offer, accept it, drive it, finish it, or give it up.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;
const pickup = { lat: 6.5244, lng: 3.3792 };
const dropoff = { lat: 6.45, lng: 3.4 };

suite('the driver side of a real order', () => {
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

  async function setup() {
    const rider = await h.login('rider', 'Flow Rider');
    const driver = await h.login('driver', 'Flow Driver');
    await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Toyota', 'Blue', $2)`, [driver.id, uniquePlate()]);
    const ping = () => h.http().post('/driver/location').set(h.auth(driver.token)).send({ lat: pickup.lat + 0.002, lng: pickup.lng + 0.002, accuracyM: 8 }).expect(204);
    const book = async (method: 'cash' | 'wallet' = 'cash') => {
      const q = (await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 6000, durationS: 900 }).expect(200)).body;
      return (await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key()).send({ quoteId: q.quoteId, category: 'package', paymentMethod: method, pickup, dropoff, pickupAddress: 'Marina', dropoffAddress: 'Lekki' }).expect(200)).body.rideId as string;
    };
    /** Matching starts on its own the moment a ride is requested; wait until it has offered the ride to someone. */
    const offered = async (rideId: string) => {
      for (let i = 0; i < 40; i++) {
        await h.app.get(DispatchService).advance(rideId);
        if ((await h.pool.query(`SELECT 1 FROM ride_offers WHERE ride_id = $1`, [rideId])).rowCount) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('the ride was never offered to a driver');
    };
    return { rider, driver, ping, book, offered };
  }

  it('shows the driver the offer, lets them accept, and tells the rider who is coming', async () => {
    const { rider, driver, ping, book, offered } = await setup();
    await ping();
    expect((await h.http().get('/driver/offer').set(h.auth(driver.token)).expect(200)).body.offer).toBeNull(); // nothing yet
    const rideId = await book();
    await offered(rideId);

    const offer = (await h.http().get('/driver/offer').set(h.auth(driver.token)).expect(200)).body.offer;
    expect(offer).toMatchObject({ rideId, paymentMethod: 'cash', rider: { name: 'Flow' } });
    expect(offer.pickup).toMatchObject({ address: 'Marina' });
    expect(offer.secondsLeft).toBeGreaterThan(0);
    expect(offer.pickupKm).toBeLessThan(2);
    expect(offer.estimate.expectedKobo).toBeGreaterThan(0);
    await h.http().get('/driver/offer').set(h.auth(rider.token)).expect(403); // only drivers

    // a different driver never sees someone else's offer
    const other = await h.login('driver');
    expect((await h.http().get('/driver/offer').set(h.auth(other.token)).expect(200)).body.offer).toBeNull();

    expect((await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200)).body).toEqual({ ok: true, rideId });
    expect((await h.http().get('/driver/offer').set(h.auth(driver.token)).expect(200)).body.offer).toBeNull(); // taken

    const active = (await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride;
    expect(active).toMatchObject({ rideId, status: 'DRIVER_ASSIGNED', rider: { name: 'Flow', phone: rider.phone } });

    // the rider's app, polling, now sees the driver
    const seen = (await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200)).body;
    expect(seen.status).toBe('DRIVER_ASSIGNED');
    expect(seen.driver).toMatchObject({ name: 'Flow Driver', phone: driver.phone });
  });

  it('tells the driver a wallet trip is Paid by the wallet, and a cash trip is paid in cash', async () => {
    for (const method of ['wallet', 'cash'] as const) {
      const { rider, driver, ping, book, offered } = await setup();
      if (method === 'wallet') await h.fund(rider.id, 5_000_000);
      await ping();
      const rideId = await book(method);
      await offered(rideId);
      await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
      await h.http().post(`/driver/rides/${rideId}/arrive`).set(h.auth(driver.token)).expect(204);
      await h.http().post(`/driver/rides/${rideId}/start`).set(h.auth(driver.token)).expect(204);
      const done = (await h.http().post(`/driver/rides/${rideId}/complete`).set(h.auth(driver.token)).send({ distanceM: 6000, durationS: 900, waitingS: 0 }).expect(200)).body;
      expect(done.paymentMethod).toBe(method);
      expect(done.paymentStatus).toBe('PAID');
      // the money really moved: the wallet fare left the rider's wallet exactly once, a cash trip left it untouched
      const spent = 5_000_000 - (await h.ledger.withTransaction((c) => h.ledger.balanceKobo(c, `wallet:${rider.id}`)));
      if (method === 'wallet') expect(spent).toBe(done.totalKobo); else expect(spent).not.toBe(done.totalKobo);
      // asking to complete again must not charge again
      await h.http().post(`/driver/rides/${rideId}/complete`).set(h.auth(driver.token)).send({ distanceM: 6000, durationS: 900, waitingS: 0 });
      if (method === 'wallet') {
        const after = 5_000_000 - (await h.ledger.withTransaction((c) => h.ledger.balanceKobo(c, `wallet:${rider.id}`)));
        expect(after).toBe(done.totalKobo);
      }
    }
  });

  it('drives a trip to the end and tells the driver what they earned', async () => {
    const { rider, driver, ping, book, offered } = await setup();
    await ping();
    const rideId = await book();
    await offered(rideId);
    await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
    await h.http().post(`/driver/rides/${rideId}/arrive`).set(h.auth(driver.token)).expect(204);
    expect((await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200)).body.status).toBe('DRIVER_ARRIVED');
    await h.http().post(`/driver/rides/${rideId}/start`).set(h.auth(driver.token)).expect(204);
    expect((await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride.status).toBe('IN_TRANSIT');

    const done = (await h.http().post(`/driver/rides/${rideId}/complete`).set(h.auth(driver.token)).send({ distanceM: 6000, durationS: 900, waitingS: 0 }).expect(200)).body;
    expect(done.totalKobo).toBeGreaterThan(0);
    expect(done.commissionKobo).toBeGreaterThan(0);
    expect(done.driverEarnKobo).toBe(done.totalKobo - done.taxKobo - done.commissionKobo); // what they keep adds up
    expect((await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride).toBeNull();
    // the trip shows in the driver's history with what they kept, and in today's totals
    const history = (await h.http().get('/driver/trips').set(h.auth(driver.token)).expect(200)).body;
    expect(history.items[0]).toMatchObject({ id: rideId, totalKobo: done.totalKobo, earnedKobo: done.driverEarnKobo, rider: 'Flow' });
    expect(history.today).toMatchObject({ trips: 1, earnedKobo: done.driverEarnKobo, distanceM: 6000 });
    expect((await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200)).body).toMatchObject({ status: 'TRIP_COMPLETED', fareKobo: done.totalKobo });
  });

  it('lets a driver give up an accepted ride, and tells the rider it was the driver', async () => {
    const { rider, driver, ping, book, offered } = await setup();
    await ping();
    const rideId = await book();
    await offered(rideId);
    await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
    const other = await h.login('driver');
    await h.http().post(`/driver/rides/${rideId}/cancel`).set(h.auth(other.token)).send({}).expect(404); // not their ride
    await h.http().post(`/driver/rides/${rideId}/cancel`).set(h.auth(driver.token)).send({ reason: 'Car trouble' }).expect(200, { cancelled: true });
    await h.http().post(`/driver/rides/${rideId}/cancel`).set(h.auth(driver.token)).send({}).expect(200, { cancelled: false }); // a retried tap
    expect((await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200)).body.status).toBe('CANCELLED_BY_DRIVER');
    expect((await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride).toBeNull();
    // a ride already under way cannot be dropped this way
    await ping(); // be on the map before the next ride is requested, so matching finds the driver straight away
    const second = await book();
    await offered(second);
    await h.http().post(`/driver/rides/${second}/accept`).set(h.auth(driver.token)).expect(200);
    await h.http().post(`/driver/rides/${second}/arrive`).set(h.auth(driver.token)).expect(204);
    await h.http().post(`/driver/rides/${second}/start`).set(h.auth(driver.token)).expect(204);
    await h.http().post(`/driver/rides/${second}/cancel`).set(h.auth(driver.token)).send({}).expect(409);
  });

  it('holds a request open until something happens, so phones need not ask every few seconds', async () => {
    const { rider, driver, ping, book, offered } = await setup();
    await ping();

    // a driver waiting for work: nothing arrives, the answer comes back empty after the wait
    const t0 = Date.now();
    expect((await h.http().get('/driver/offer').query({ wait: 2 }).set(h.auth(driver.token)).expect(200)).body.offer).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);

    // ...and when a booking arrives meanwhile, the held request is answered at once
    const waiting = h.http().get('/driver/offer').query({ wait: 20 }).set(h.auth(driver.token)).then((r) => ({ at: Date.now(), body: r.body }));
    await new Promise((r) => setTimeout(r, 400));
    const rideId = await book();
    const asked = Date.now();
    await offered(rideId);
    const got = await waiting;
    expect(got.body.offer).toMatchObject({ rideId });
    expect(got.at - asked).toBeLessThan(8000);

    // a rider watching the ride: held while nothing changes, answered when the driver moves it on
    await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
    const quiet = Date.now();
    expect((await h.http().get(`/rides/${rideId}`).query({ waitFor: 'DRIVER_ASSIGNED', wait: 2 }).set(h.auth(rider.token)).expect(200)).body.status).toBe('DRIVER_ASSIGNED');
    expect(Date.now() - quiet).toBeGreaterThanOrEqual(1500);
    const watching = h.http().get(`/rides/${rideId}`).query({ waitFor: 'DRIVER_ASSIGNED', wait: 20 }).set(h.auth(rider.token)).then((r) => ({ at: Date.now(), body: r.body }));
    await new Promise((r) => setTimeout(r, 500));
    const moved = Date.now();
    await h.http().post(`/driver/rides/${rideId}/arrive`).set(h.auth(driver.token)).expect(204);
    const seen = await watching;
    expect(seen.body.status).toBe('DRIVER_ARRIVED');
    expect(seen.at - moved).toBeLessThan(4000);
    // asking with a status the ride is not in answers straight away
    const now = Date.now();
    expect((await h.http().get(`/rides/${rideId}`).query({ waitFor: 'DRIVER_ASSIGNED', wait: 20 }).set(h.auth(rider.token)).expect(200)).body.status).toBe('DRIVER_ARRIVED');
    expect(Date.now() - now).toBeLessThan(1500);
    // nobody else can watch it, and the wait is capped
    await h.http().get(`/rides/${rideId}`).query({ waitFor: 'DRIVER_ARRIVED', wait: 2 }).set(h.auth((await h.login('rider')).token)).expect(404);
    await h.http().get('/driver/offer').query({ wait: 60 }).set(h.auth(driver.token)).expect(400);
  });

  it('keeps one phone online per driver account, and the newest to go online takes over', async () => {
    const { driver } = await setup();
    const A = 'phone-aaaaaaaa'; const B = 'phone-bbbbbbbb';
    const ping = (device?: string) => h.http().post('/driver/location').set(h.auth(driver.token)).set(...(device ? (['X-Device-Id', device] as [string, string]) : (['X-Nothing', '1'] as [string, string]))).send({ lat: pickup.lat, lng: pickup.lng, accuracyM: 8 });
    await ping(A).expect(204); // the first phone to report is the one the system sees
    const refused = await ping(B).expect(409); // a second phone is told why, instead of looking online here
    expect(refused.body.code).toBe('other_device');
    await h.http().post('/driver/online').set(h.auth(driver.token)).set('X-Device-Id', B).expect(204); // B goes online: it takes over
    await ping(B).expect(204);
    expect((await ping(A).expect(409)).body.code).toBe('other_device'); // and A is the one told
    // A cannot knock B off by saying it went offline
    await h.http().post('/driver/offline').set(h.auth(driver.token)).set('X-Device-Id', A).expect(204);
    await ping(B).expect(204);
    // B going offline frees the claim; an app that sends no id is not checked
    await h.http().post('/driver/offline').set(h.auth(driver.token)).set('X-Device-Id', B).expect(204);
    await ping(A).expect(204);
    await ping().expect(204);
    // the booking is only handed to the phone that holds the claim
    expect((await h.http().get('/driver/offer').set(h.auth(driver.token)).set('X-Device-Id', B).expect(200)).body.offer).toBeNull();
  });
});
