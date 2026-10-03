import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from './common/infra.module';
import { DispatchService } from './dispatch/dispatch.service';
import { keys } from './dispatch/dispatch.types';
import { ScheduledRidesService } from './rides/scheduled-rides.service';
import { bootApp } from './testing/harness.testing';

// Scheduled and weekly rides, rider cancellation, driver background location and app config, over real HTTP,
// Postgres and Valkey. Skipped unless INTEGRATION=1 (writes rows to DATABASE_URL).
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
const pickup = { lat: 6.5244, lng: 3.3792 };
const dropoff = { lat: 6.45, lng: 3.4 };
// Each test that needs a driver works somewhere of its own, so drivers left online by other tests are never nearer.
const randomSpot = () => ({ lat: 5 + Math.random() * 4, lng: 3 + Math.random() * 1.5 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite('scheduled rides, cancellation, background location, app config', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  let scheduled: ScheduledRidesService;
  let dispatch: DispatchService;
  let redis: Redis;

  beforeAll(async () => {
    h = await bootApp();
    scheduled = h.app.get(ScheduledRidesService);
    dispatch = h.app.get(DispatchService);
    redis = h.app.get(REDIS);
    // Test-only pricing for the 'package' category so this file does not depend on seed data.
    await h.pool.query(
      `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, tax_kobo, created_by, approved_by, approved_at)
       VALUES ('package', now() - interval '1 day' - (random() * 1000000 || ' microseconds')::interval, 20000, 12000, 1500, 3000, $1, $2, now())`,
      [randomUUID(), randomUUID()],
    );
  }, 60_000);
  afterAll(async () => {
    // Rides this file started searching must not stay open for 10 minutes and offer themselves to other suites' drivers.
    await h.pool.query(`UPDATE rides SET status = 'CANCELLED_BY_SYSTEM', cancel_reason = 'test cleanup' WHERE status = 'SEARCHING_DRIVER' AND search_window_seconds = 600`);
    await h.pool.query(`DELETE FROM app_config WHERE key = 'client'`);
    await h.close();
  });

  const body = (over: object = {}) => ({
    category: 'package', paymentMethod: 'cash', pickup: randomSpot(), dropoff, distanceM: 5000, durationS: 900,
    firstPickupAt: inMinutes(120).toISOString(), repeat: 'none', ...over,
  });
  const book = (token: string, over: object = {}, key = h.key()) =>
    h.http().post('/ride-schedules').set(h.auth(token)).set('Idempotency-Key', key).send(body(over));
  const makeDue = (rideId: string, minutesAhead = 10) =>
    h.pool.query(`UPDATE rides SET scheduled_for = now() + make_interval(mins => $2) WHERE id = $1`, [rideId, minutesAhead]);
  const status = async (rideId: string) => (await h.pool.query(`SELECT * FROM rides WHERE id = $1`, [rideId])).rows[0];

  async function onlineDriver(at = pickup) {
    const d = await h.login('driver', 'Driver Dee');
    await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Toyota', 'Silver', $2)`, [
      d.id, `T${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`,
    ]);
    const ping = () => h.http().post('/driver/location').set(h.auth(d.token)).send({ ...at, accuracyM: 8 }).expect(204);
    await ping();
    return { ...d, ping, at };
  }
  async function acceptWhenOffered(driver: { token: string; ping: () => Promise<unknown> }, rideId: string) {
    for (let i = 0; i < 60; i++) {
      await driver.ping();
      const r = await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
      if (r.body.ok) return;
      await sleep(250);
    }
    throw new Error('driver never received the offer');
  }

  describe('booking', () => {
    it('enforces the lead time, the horizon and the number of weeks', async () => {
      const rider = await h.login('rider');
      const soon = await book(rider.token, { firstPickupAt: inMinutes(10).toISOString() }).expect(400);
      expect(soon.body.code).toBe('too_soon');
      const far = await book(rider.token, { firstPickupAt: inMinutes(60 * 24 * 40).toISOString() }).expect(400);
      expect(far.body.code).toBe('too_far');
      await book(rider.token, { firstPickupAt: 'not a date' }).expect(400);
      await book(rider.token, { repeat: 'weekly', weeks: 1 }).expect(400);
      await book(rider.token, { repeat: 'weekly' }).expect(400);
      const many = await book(rider.token, { repeat: 'weekly', weeks: 13 }).expect(400);
      expect(many.body.code).toBe('bad_weeks');
      await book(rider.token, { category: 'limousine' }).expect(400);
      await h.http().post('/ride-schedules').set(h.auth(rider.token)).send(body()).expect(400); // Idempotency-Key required
      const driver = await h.login('driver');
      await book(driver.token).expect(403);
    });

    it('books a weekly series as real rides, a week apart, and a retry books nothing new', async () => {
      const rider = await h.login('rider');
      const key = h.key();
      const first = inMinutes(120);
      const made = await book(rider.token, { repeat: 'weekly', weeks: 3, firstPickupAt: first.toISOString() }, key).expect(200);
      expect(made.body.duplicate).toBe(false);
      expect(made.body.estimate.expectedKobo).toBeGreaterThan(0); // indicative price, nothing charged or held
      expect(made.body.rides).toHaveLength(3);
      const times = made.body.rides.map((r: { scheduledFor: string }) => new Date(r.scheduledFor).getTime());
      expect(times[1] - times[0]).toBe(7 * 86_400_000);
      expect(times[2] - times[1]).toBe(7 * 86_400_000);
      expect(made.body.rides.every((r: { status: string }) => r.status === 'SCHEDULED')).toBe(true);

      const retry = await book(rider.token, { repeat: 'weekly', weeks: 3, firstPickupAt: first.toISOString() }, key).expect(200);
      expect(retry.body.duplicate).toBe(true);
      expect(retry.body.rides.map((r: { rideId: string }) => r.rideId)).toEqual(made.body.rides.map((r: { rideId: string }) => r.rideId));
      const count = await h.pool.query(`SELECT count(*)::int AS n FROM rides WHERE rider_id = $1`, [rider.id]);
      expect(count.rows[0].n).toBe(3);

      const mine = await h.http().get('/ride-schedules').set(h.auth(rider.token)).expect(200);
      expect(mine.body).toHaveLength(1);
      const other = await h.login('rider');
      expect((await h.http().get('/ride-schedules').set(h.auth(other.token)).expect(200)).body).toHaveLength(0);
      const one = await h.http().get(`/rides/${made.body.rides[0].rideId}`).set(h.auth(rider.token)).expect(200);
      expect(one.body).toMatchObject({ status: 'SCHEDULED', scheduleId: made.body.scheduleId });
      await h.http().get(`/rides/${made.body.rides[0].rideId}`).set(h.auth(other.token)).expect(404);
    });

    it('caps how many rides one rider can have waiting', async () => {
      const rider = await h.login('rider');
      await book(rider.token, { repeat: 'weekly', weeks: 12 }).expect(200);
      await book(rider.token, { repeat: 'weekly', weeks: 12 }).expect(200);
      await book(rider.token, { repeat: 'weekly', weeks: 12 }).expect(409); // 36 > 30
      const left = await h.pool.query(`SELECT count(*)::int AS n FROM rides WHERE rider_id = $1`, [rider.id]);
      expect(left.rows[0].n).toBe(24); // the refused booking left nothing behind
    });
  });

  describe('the delayed job', () => {
    it('leaves future rides alone and starts only the ones whose time has come, with today\'s price', async () => {
      const rider = await h.login('rider');
      const made = await book(rider.token, { repeat: 'weekly', weeks: 2, firstPickupAt: inMinutes(120).toISOString() }).expect(200);
      const [r1, r2] = made.body.rides.map((r: { rideId: string }) => r.rideId);
      await scheduled.activateDue();
      expect((await status(r1)).status).toBe('SCHEDULED'); // 2 hours away: not yet

      await makeDue(r1, 10);
      await scheduled.activateDue();
      const live = await status(r1);
      expect(live).toMatchObject({ status: 'SEARCHING_DRIVER', search_window_seconds: 600 });
      expect(live.pricing_version_id).not.toBeNull(); // priced at activation
      expect(live.fare_quote_id).not.toBeNull();
      expect((await status(r2)).status).toBe('SCHEDULED');
      await scheduled.activateDue(); // running it again starts nothing twice
      expect((await h.pool.query(`SELECT count(*)::int AS n FROM ride_status_history WHERE ride_id = $1 AND to_status = 'SEARCHING_DRIVER'`, [r1])).rows[0].n).toBe(1);
    });

    it('finds a driver for a scheduled ride and takes it through to assigned', async () => {
      const spot = randomSpot();
      const driver = await onlineDriver(spot);
      const rider = await h.login('rider');
      const made = await book(rider.token, { pickup: spot }).expect(200);
      const rideId = made.body.rides[0].rideId as string;
      await makeDue(rideId);
      await scheduled.activateDue();
      await acceptWhenOffered(driver, rideId);
      const seen = await h.http().get(`/rides/${rideId}`).set(h.auth(rider.token)).expect(200);
      expect(seen.body.status).toBe('DRIVER_ASSIGNED');
    }, 30_000);

    it('holds wallet money only when dispatch starts, and cancels cleanly if the wallet is short', async () => {
      const poor = await h.login('rider');
      const funded = await h.login('rider');
      await h.fund(funded.id, 1_000_000);

      const a = (await book(poor.token, { paymentMethod: 'wallet' }).expect(200)).body.rides[0].rideId as string;
      const b = (await book(funded.token, { paymentMethod: 'wallet' }).expect(200)).body.rides[0].rideId as string;
      expect((await h.pool.query(`SELECT count(*)::int AS n FROM wallet_holds WHERE ride_id = ANY($1)`, [[a, b]])).rows[0].n).toBe(0); // nothing held at booking

      await makeDue(a);
      await makeDue(b);
      await scheduled.activateDue();

      const ra = await status(a);
      expect(ra).toMatchObject({ status: 'CANCELLED_BY_SYSTEM', cancel_reason: 'your wallet balance is too low for this ride' });
      expect((await h.pool.query(`SELECT count(*)::int AS n FROM wallet_holds WHERE ride_id = $1`, [a])).rows[0].n).toBe(0);
      expect((await h.http().get(`/rides/${a}`).set(h.auth(poor.token)).expect(200)).body.cancelReason).toContain('wallet balance');

      const rb = await status(b);
      expect(rb).toMatchObject({ status: 'SEARCHING_DRIVER', payment_status: 'HELD' });
      const hold = await h.pool.query(`SELECT amount_kobo, status FROM wallet_holds WHERE ride_id = $1`, [b]);
      expect(hold.rows[0].status).toBe('ACTIVE');
      expect((await h.http().get('/wallet').set(h.auth(funded.token)).expect(200)).body.availableKobo).toBeLessThan(1_000_000);
    });

    it('does not start a ride long after its pickup time', async () => {
      const rider = await h.login('rider');
      const rideId = (await book(rider.token).expect(200)).body.rides[0].rideId as string;
      await makeDue(rideId, -20);
      await scheduled.activateDue();
      expect(await status(rideId)).toMatchObject({ status: 'CANCELLED_BY_SYSTEM', cancel_reason: 'we could not start this ride in time' });
    });

    it('searches for a scheduled ride longer than for an on-demand one', async () => {
      const rider = await h.login('rider');
      const rideId = (await book(rider.token).expect(200)).body.rides[0].rideId as string;
      await makeDue(rideId);
      await scheduled.activateDue();
      await h.pool.query(`UPDATE rides SET search_started_at = now() - interval '200 seconds' WHERE id = $1`, [rideId]);
      await dispatch.advance(rideId);
      expect((await status(rideId)).status).toBe('SEARCHING_DRIVER'); // still inside its 600 s window

      await h.pool.query(`UPDATE rides SET search_started_at = now() - interval '700 seconds' WHERE id = $1`, [rideId]);
      await dispatch.advance(rideId);
      expect((await status(rideId)).status).toBe('NO_DRIVER_FOUND');
    });
  });

  describe('cancelling', () => {
    it('cancels one ride or the rest of a series, and repeating changes nothing', async () => {
      const rider = await h.login('rider');
      const other = await h.login('rider');
      const made = await book(rider.token, { repeat: 'weekly', weeks: 3 }).expect(200);
      const [r1, r2, r3] = made.body.rides.map((r: { rideId: string }) => r.rideId);

      await h.http().post(`/rides/${r1}/cancel`).set(h.auth(other.token)).send({}).expect(404);
      await h.http().post(`/rides/${r1}/cancel`).set(h.auth(rider.token)).send({ reason: 'Plans changed' }).expect(200, { cancelled: true });
      await h.http().post(`/rides/${r1}/cancel`).set(h.auth(rider.token)).send({}).expect(200, { cancelled: false });
      expect(await status(r1)).toMatchObject({ status: 'CANCELLED_BY_RIDER', cancel_reason: 'Plans changed' });

      await makeDue(r2); // already started: the series cancel must not touch it
      await scheduled.activateDue();
      const res = await h.http().post(`/ride-schedules/${made.body.scheduleId}/cancel`).set(h.auth(rider.token)).expect(200);
      expect(res.body).toEqual({ cancelled: 1 }); // only r3 was still waiting
      expect((await status(r3)).status).toBe('CANCELLED_BY_RIDER');
      expect((await status(r2)).status).toBe('SEARCHING_DRIVER');
      await h.http().post(`/ride-schedules/${made.body.scheduleId}/cancel`).set(h.auth(other.token)).expect(404);
    });

    it('releases the wallet hold and frees the driver when a rider cancels an assigned ride', async () => {
      const spot = randomSpot();
      const driver = await onlineDriver(spot);
      const rider = await h.login('rider');
      await h.fund(rider.id, 1_000_000);
      const rideId = (await book(rider.token, { paymentMethod: 'wallet', pickup: spot }).expect(200)).body.rides[0].rideId as string;
      await makeDue(rideId);
      await scheduled.activateDue();
      await acceptWhenOffered(driver, rideId);
      expect(await redis.exists(keys.driverRide(driver.id))).toBe(1);
      const held = (await h.http().get('/wallet').set(h.auth(rider.token)).expect(200)).body;
      expect(held.availableKobo).toBeLessThan(held.balanceKobo);

      await h.http().post(`/rides/${rideId}/cancel`).set(h.auth(rider.token)).send({}).expect(200, { cancelled: true });
      const after = (await h.http().get('/wallet').set(h.auth(rider.token)).expect(200)).body;
      expect(after.availableKobo).toBe(after.balanceKobo); // hold released
      expect((await status(rideId)).payment_status).toBe('UNPAID');
      expect(await redis.exists(keys.driverRide(driver.id))).toBe(0);
      expect(await redis.hget(keys.driverState(driver.id), 'status')).toBeNull();
      await driver.ping();
      expect(await redis.hget(keys.driverState(driver.id), 'status')).toBe('available'); // back on the map
    }, 30_000);

    it('will not cancel a trip that has started or finished', async () => {
      const rider = await h.login('rider');
      const driver = await h.login('driver');
      const rideId = await h.completedRide(rider.id, driver.id, 300_000);
      const res = await h.http().post(`/rides/${rideId}/cancel`).set(h.auth(rider.token)).send({}).expect(409);
      expect(res.body.code).toBe('wrong_state');
    });
  });

  describe('driver background location', () => {
    const point = (ageSeconds: number, over: object = {}) => ({
      lat: 6.5244, lng: 3.3792, accuracyM: 10, speedKmh: 30, recordedAt: new Date(Date.now() - ageSeconds * 1000).toISOString(), ...over,
    });
    const upload = (token: string, points: object[]) => h.http().post('/driver/location/batch').set(h.auth(token)).send({ points });

    it('puts a driver on the map only for a fresh reading, not an old one from the offline queue', async () => {
      const d = await h.login('driver');
      await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Kia', 'Red', $2)`, [d.id, `K${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`]);

      const stale = await upload(d.token, [point(600), point(590)]).expect(200);
      expect(stale.body).toEqual({ accepted: 2, rejected: 0, live: false });
      expect(await redis.exists(keys.driverState(d.id))).toBe(0); // 10-minute-old positions are not presence

      const fresh = await upload(d.token, [point(120), point(5, { lat: 6.53 })]).expect(200);
      expect(fresh.body).toEqual({ accepted: 2, rejected: 0, live: true });
      expect(Number(await redis.hget(keys.driverState(d.id), 'lat'))).toBeCloseTo(6.53, 4); // the newest reading wins
    });

    it('drops spoofed, future and ancient readings, and accepts an upload sent twice', async () => {
      const d = await h.login('driver');
      await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'package', 'Kia', 'Red', $2)`, [d.id, `K${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`]);
      const res = await upload(d.token, [
        point(5),
        point(5, { mockLocation: true }),
        point(-600), // 10 minutes in the future: a wrong phone clock
        point(60 * 60 * 30), // 30 hours old
      ]).expect(200);
      expect(res.body).toEqual({ accepted: 1, rejected: 3, live: true });
      await upload(d.token, [point(5)]).expect(200);
    });

    it('rejects malformed batches and non-drivers', async () => {
      const d = await h.login('driver');
      const rider = await h.login('rider');
      await upload(d.token, []).expect(400);
      await upload(d.token, Array.from({ length: 101 }, () => point(5))).expect(400);
      await upload(d.token, [{ lat: 6.5, lng: 3.3 }]).expect(400); // no recordedAt
      await upload(d.token, [point(5, { lat: 200 })]).expect(400);
      await upload(rider.token, [point(5)]).expect(403);
      await upload(d.token, [point(5)]).expect(409); // no approved vehicle
    });

    async function runTrip(claimedM: number) {
      const spot = randomSpot();
      const driver = await onlineDriver(spot);
      const rider = await h.login('rider');
      const q = await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 3000, durationS: 600 }).expect(200);
      const ride = await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key())
        .send({ quoteId: q.body.quoteId, category: 'package', paymentMethod: 'cash', pickup: spot, dropoff }).expect(200);
      const rideId = ride.body.rideId as string;
      await acceptWhenOffered(driver, rideId);

      // The phone loses signal for longer than the 20 s presence window: the driver must stay "on a trip".
      await redis.del(keys.driverState(driver.id));
      await driver.ping();
      expect(await redis.hget(keys.driverState(driver.id), 'status')).toBe('on_trip');

      await h.http().post(`/driver/rides/${rideId}/arrive`).set(h.auth(driver.token)).expect(204);
      await h.http().post(`/driver/rides/${rideId}/start`).set(h.auth(driver.token)).expect(204);
      await sleep(1300);
      // The route actually driven: 12 readings about 3 km apart end to end, uploaded as one offline batch.
      const t0 = Date.now() - 1000;
      const points = Array.from({ length: 12 }, (_, i) => ({
        lat: spot.lat + i * 0.0025, lng: spot.lng, accuracyM: 8, recordedAt: new Date(t0 + i * 80).toISOString(),
      }));
      await upload(driver.token, points).expect(200);
      await upload(driver.token, points).expect(200); // resent after a timeout: stored once
      const stored = await h.pool.query(`SELECT count(*)::int AS n FROM driver_location_points WHERE driver_id = $1`, [driver.id]);
      expect(stored.rows[0].n).toBeGreaterThanOrEqual(12);
      expect(stored.rows[0].n).toBeLessThan(20);

      await h.http().post(`/driver/rides/${rideId}/complete`).set(h.auth(driver.token)).send({ distanceM: claimedM, durationS: 600, waitingS: 0 }).expect(200);
      expect(await redis.exists(keys.driverRide(driver.id))).toBe(0);
      return rideId;
    }

    it('flags a reported distance far above the recorded route, and not an honest one', async () => {
      const honest = await runTrip(3200);
      const padded = await runTrip(9000);
      const check = (id: string) => h.pool.query(`SELECT claimed_m, trail_m, trail_points, flagged FROM trip_distance_checks WHERE ride_id = $1`, [id]);
      const a = (await check(honest)).rows[0];
      expect(a.flagged).toBe(false);
      expect(a.trail_m).toBeGreaterThan(2500);
      expect(a.trail_m).toBeLessThan(3500);
      const b = (await check(padded)).rows[0];
      expect(b).toMatchObject({ claimed_m: 9000, flagged: true });

      const support = await h.staff('support');
      const list = await h.http().get('/admin/trip-checks').set(h.auth(support.token)).expect(200);
      const ids = list.body.map((t: { rideId: string }) => t.rideId);
      expect(ids).toContain(padded);
      expect(ids).not.toContain(honest);
      await h.http().post(`/admin/trip-checks/${padded}/review`).set(h.auth(support.token)).expect(200, { reviewed: true });
      await h.http().post(`/admin/trip-checks/${padded}/review`).set(h.auth(support.token)).expect(200, { reviewed: false });
      expect((await h.http().get('/admin/trip-checks').set(h.auth(support.token)).expect(200)).body.map((t: { rideId: string }) => t.rideId)).not.toContain(padded);
      const rider = await h.login('rider');
      await h.http().get('/admin/trip-checks').set(h.auth(rider.token)).expect(403);
    }, 60_000);
  });

  describe('app config', () => {
    const cfg = (platform?: string, version?: string) => {
      const r = h.http().get('/app/config');
      if (platform) r.set('X-App-Platform', platform);
      if (version) r.set('X-App-Version', version);
      return r;
    };

    it('tells old apps to update and leaves current ones alone', async () => {
      await h.pool.query(`DELETE FROM app_config WHERE key = 'client'`);
      const open = await cfg('android', '1.0.0').expect(200); // public: no sign-in
      expect(open.body).toMatchObject({ forceUpdate: false, updateAvailable: false });
      expect(open.body.driverLocation).toMatchObject({ batchMaxPoints: 100, liveMaxAgeSeconds: 30 });
      expect(open.body.batteryGuidance.length).toBeGreaterThan(1);
      expect(new Date(open.body.serverTime).getTime()).toBeGreaterThan(Date.now() - 5000);

      const admin = await h.staff('admin');
      const support = await h.staff('support');
      const put = (token: string, b: object) => h.http().put('/admin/app-config').set(h.auth(token)).send(b);
      await put(support.token, { platform: 'android', minVersion: '2.0.0', latestVersion: '2.1.0', updateUrl: 'https://example.test/app' }).expect(403);
      await put(admin.token, { platform: 'android', minVersion: '2.2.0', latestVersion: '2.1.0', updateUrl: 'https://example.test/app' }).expect(400); // min above latest
      await put(admin.token, { platform: 'android', minVersion: '2.0.0', latestVersion: '2.1.0', updateUrl: '' }).expect(400); // nowhere to update from
      await put(admin.token, { platform: 'android', minVersion: '2.0', latestVersion: '2.1.0', updateUrl: 'x' }).expect(400);
      await put(admin.token, { platform: 'android', minVersion: '2.0.0', latestVersion: '2.1.0', updateUrl: 'https://example.test/app' }).expect(200);

      expect((await cfg('android', '1.9.0')).body).toMatchObject({ forceUpdate: true, updateAvailable: true, updateUrl: 'https://example.test/app' });
      expect((await cfg('android', '2.0.0')).body).toMatchObject({ forceUpdate: false, updateAvailable: true });
      expect((await cfg('android', '2.1.0')).body).toMatchObject({ forceUpdate: false, updateAvailable: false });
      expect((await cfg('android', '10.0.0')).body.forceUpdate).toBe(false); // compared as numbers, not text
      expect((await cfg('ios', '1.0.0')).body.forceUpdate).toBe(false); // other platform untouched
      expect((await cfg('android', 'banana')).body.forceUpdate).toBe(false); // unreadable version never locks anyone out
      expect((await cfg()).body.forceUpdate).toBe(false);

      const audit = await h.pool.query(`SELECT path FROM staff_audit_log WHERE staff_id = $1`, [admin.id]);
      expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
