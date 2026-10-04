import { randomUUID } from 'crypto';
import { DispatchService } from './dispatch/dispatch.service';
import { bootApp } from './testing/harness.testing';

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
    await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Toyota', 'Blue', $2)`, [driver.id, `F${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`]);
    const ping = () => h.http().post('/driver/location').set(h.auth(driver.token)).send({ lat: pickup.lat + 0.002, lng: pickup.lng + 0.002, accuracyM: 8 }).expect(204);
    const book = async () => {
      const q = (await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 6000, durationS: 900 }).expect(200)).body;
      return (await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key()).send({ quoteId: q.quoteId, category: 'package', paymentMethod: 'cash', pickup, dropoff, pickupAddress: 'Marina', dropoffAddress: 'Lekki' }).expect(200)).body.rideId as string;
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

  it('drives a trip to the end and tells the driver what they earned', async () => {
    const { rider, driver, ping, book, offered } = await setup();
    await ping();
    const rideId = await book();
    await offered(rideId);
    await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
    await h.http().post(`/driver/rides/${rideId}/arrive`).set(h.auth(driver.token)).expect(204);
    expect((await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200)).body.status).toBe('DRIVER_ARRIVED');
    await h.http().post(`/driver/rides/${rideId}/start`).set(h.auth(driver.token)).expect(204);
    expect((await h.http().get('/driver/rides/active').set(h.auth(driver.token)).expect(200)).body.ride.status).toBe('TRIP_STARTED');

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
});
