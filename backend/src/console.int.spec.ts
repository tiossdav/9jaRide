import { bootApp, uniquePlate } from './testing/harness.testing';

// What the admin portal reads. Real HTTP, Postgres and Valkey. Skipped unless INTEGRATION=1.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('admin console endpoints', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  jest.setTimeout(30_000);
  afterAll(async () => { await h.close(); });

  it('keeps riders, drivers and finance staff out of the console', async () => {
    const rider = await h.login('rider');
    const finance = await h.staff('finance');
    await h.http().get('/admin/console/dashboard').expect(401);
    await h.http().get('/admin/console/dashboard').set(h.auth(rider.token)).expect(403);
    await h.http().get('/admin/console/dashboard').set(h.auth(finance.token)).expect(403);
  });

  it('answers the dashboard, live operations, customers, pricing and safety for support staff', async () => {
    const support = await h.staff('support');
    const get = (path: string) => h.http().get(`/admin/console/${path}`).set(h.auth(support.token)).expect(200);
    const dash = (await get('dashboard')).body;
    expect(dash.users.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(dash.tripsByMonth)).toBe(true);
    expect(typeof dash.finance.todayKobo).toBe('number');
    const live = (await get('live')).body;
    expect(Array.isArray(live.activeRides)).toBe(true);
    expect((await get('customers')).body.top).toBeInstanceOf(Array);
    expect((await get('safety')).body.items).toBeInstanceOf(Array);
    expect((await get('trips/overview')).body.revenueLast7Days).toHaveLength(7);
    const pricing = (await get('pricing')).body;
    expect(pricing.some((p: { state: string }) => p.state === 'live')).toBe(true);
  });

  it('counts today from the calendar day, so a trip finished yesterday is not in the numbers for today', async () => {
    const support = await h.staff('support');
    const dash = async () => (await h.http().get('/admin/console/dashboard').set(h.auth(support.token)).expect(200)).body;
    const before = await dash();
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const rideId = await h.completedRide(rider.id, driver.id, 123_400);
    const during = await dash();
    expect(during.finance.todayKobo - before.finance.todayKobo).toBe(123_400);
    expect(during.activity.completedToday - before.activity.completedToday).toBe(1);
    expect(during.newToday.riders - before.newToday.riders).toBe(1);
    // the same trip, finished two days ago: it is history now, still in the totals but not in today
    await h.pool.query(`ALTER TABLE ride_fares DISABLE TRIGGER USER`);
    await h.pool.query(`UPDATE ride_fares SET created_at = now() - interval '2 days' WHERE ride_id = $1`, [rideId]);
    await h.pool.query(`ALTER TABLE ride_fares ENABLE TRIGGER USER`);
    const after = await dash();
    expect(after.finance.todayKobo).toBe(before.finance.todayKobo);
    expect(after.activity.completedToday).toBe(before.activity.completedToday);
  });

  it('tells staff what just happened, and keeps an SOS on screen until someone takes it', async () => {
    const support = await h.staff('support');
    const admin = await h.staff('admin');
    const finance = await h.staff('finance');
    const since = new Date(Date.now() - 5_000).toISOString();
    const feed = async (who: { token: string }, from = since) => (await h.http().get('/admin/console/notifications').query({ since: from }).set(h.auth(who.token)).expect(200)).body;

    const rider = await h.login('rider', 'Notice Rider');
    const driver = await h.login('driver', 'Notice Driver');
    await h.http().post('/sos').set(h.auth(driver.token)).set('Idempotency-Key', h.key()).send({ location: { lat: 6.5, lng: 3.4 } }).expect(200);

    const seen = await feed(support);
    expect(seen.items.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['sos', 'rider', 'driver']));
    const sos = seen.items.find((n: { type: string }) => n.type === 'sos');
    expect(sos).toMatchObject({ severity: 'critical', title: 'SOS emergency alert' });
    expect(sos.text).toContain('Notice Driver');
    expect(seen.openSos.some((o: { person: string }) => o.person === 'Notice Driver')).toBe(true);

    // each team sees its own kinds of event
    expect((await feed(admin)).items.some((n: { type: string }) => n.type === 'sos')).toBe(true);
    const money = await feed(finance);
    expect(money.items.every((n: { type: string }) => n.type === 'payment')).toBe(true);
    expect(money.openSos).toEqual([]);

    // an alert older than the pop-up window is still listed while it is open (a reload must not lose it)
    const later = await feed(support, new Date(Date.now() + 60_000).toISOString());
    expect(later.items).toEqual([]);
    expect(later.openSos.some((o: { person: string }) => o.person === 'Notice Driver')).toBe(true);

    // the corner counter counts everything unresolved, and does not care how old it is
    const before = (await feed(support, later.now)).unresolvedSos;
    expect(before).toBeGreaterThanOrEqual(1);
    expect((await feed(finance)).unresolvedSos).toBe(0);
    // once somebody acknowledges it, it leaves the sticky list
    await h.http().post(`/admin/sos/${sos.link.split('/').pop()}/acknowledge`).set(h.auth(support.token)).expect(200);
    expect((await feed(support, later.now)).openSos.some((o: { person: string }) => o.person === 'Notice Driver')).toBe(false);
    expect((await feed(support, later.now)).unresolvedSos).toBe(before); // acknowledged is still unresolved
    expect(rider.id).toBeTruthy();
  });

  it('lists trips with search and shows the fare snapshot on one', async () => {
    const support = await h.staff('support');
    const rider = await h.login('rider', 'Consoletest Rider');
    const driver = await h.login('driver', 'Consoletest Driver');
    const rideId = await h.completedRide(rider.id, driver.id, 226_000);
    const list = (await h.http().get('/admin/console/trips').query({ search: 'Consoletest', status: 'completed' }).set(h.auth(support.token)).expect(200)).body;
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.items[0]).toMatchObject({ id: rideId, status: 'TRIP_COMPLETED', rider: 'Consoletest Rider', totalKobo: 226_000 });
    const detail = (await h.http().get(`/admin/console/trips/${rideId}`).set(h.auth(support.token)).expect(200)).body;
    expect(detail.fare.totalKobo).toBe(226_000);
    expect(detail.fare.lines.reduce((s: number, l: { amountKobo: number }) => s + l.amountKobo, 0)).toBe(226_000);
    await h.http().get('/admin/console/trips').query({ status: 'bogus' }).set(h.auth(support.token)).expect(400);
  });

  it('lists drivers and vehicles, shows one person with their history, and keeps the activity log to admins', async () => {
    const support = await h.staff('support');
    const admin = await h.staff('admin');
    const finance = await h.staff('finance');
    const rider = await h.login('rider', 'Profiletest Rider');
    const driver = await h.login('driver', 'Profiletest Driver');
    await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'regular', 'Toyota', 'Grey', $2)`, [driver.id, uniquePlate()]);
    await h.completedRide(rider.id, driver.id, 150_000);
    const get = (path: string, token = support.token) => h.http().get(`/admin/console/${path}`).set(h.auth(token));

    const drivers = (await get('drivers?search=Profiletest').expect(200)).body;
    expect(drivers.items[0]).toMatchObject({ name: 'Profiletest Driver', trips: 1 });
    expect(drivers.items[0].vehicle.make).toBe('Toyota');
    const person = (await get(`people/${driver.id}`).expect(200)).body;
    expect(person).toMatchObject({ role: 'driver', completedTrips: 1, totalKobo: 150_000, status: 'active' });
    expect(person.recentTrips).toHaveLength(1);
    expect((await get(`vehicles?search=Profiletest`).expect(200)).body.items.length).toBeGreaterThanOrEqual(1);
    await get('people/00000000-0000-4000-8000-000000000000').expect(404);

    // suspending shows up in the person's history
    await h.http().post(`/admin/users/${driver.id}/suspend`).set(h.auth(admin.token)).send({ reason: 'console test' }).expect(200);
    expect((await get(`people/${driver.id}`).expect(200)).body.statusHistory[0]).toMatchObject({ status: 'suspended', reason: 'console test' });

    await get('activity', support.token).expect(403);
    const log = (await get('activity?search=suspend', admin.token).expect(200)).body;
    expect(log.items.some((l: { path: string }) => l.path.includes('/suspend'))).toBe(true);
    await get('finance', support.token).expect(403);
    const fin = (await get('finance', finance.token).expect(200)).body;
    expect(typeof fin.walletsKobo).toBe('number');
  });

  it('shows revenue, the ledger, ratings and CSV exports to the people allowed to see them', async () => {
    const finance = await h.staff('finance');
    const support = await h.staff('support');
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const rideId = await h.completedRide(rider.id, driver.id, 120_000);
    await h.http().post(`/rides/${rideId}/rating`).set(h.auth(rider.token)).send({ stars: 4, tags: ['Polite'] }).expect(200);

    const rev = (await h.http().get('/admin/console/revenue?days=7').set(h.auth(finance.token)).expect(200)).body;
    expect(rev.byDay).toHaveLength(7);
    expect(rev.faresKobo).toBeGreaterThanOrEqual(120_000);
    await h.http().get('/admin/console/revenue').set(h.auth(support.token)).expect(403);

    const led = (await h.http().get('/admin/console/ledger?pageSize=5').set(h.auth(finance.token)).expect(200)).body;
    expect(led.items.length).toBeGreaterThan(0);
    const entries = (await h.http().get(`/admin/console/ledger/${led.items[0].id}`).set(h.auth(finance.token)).expect(200)).body;
    expect(entries.reduce((n: number, e: { amountKobo: number }) => n + e.amountKobo, 0)).toBe(0); // every transaction balances

    const ratings = (await h.http().get('/admin/console/ratings').set(h.auth(support.token)).expect(200)).body;
    expect(ratings.total).toBeGreaterThanOrEqual(1);
    expect(ratings.distribution).toHaveLength(5);

    const csv = await h.http().get('/admin/console/trips.csv?status=completed').set(h.auth(support.token)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split(/\r?\n/)[0]).toContain('Trip code');
    await h.http().get('/admin/console/activity.csv').set(h.auth(support.token)).expect(403);
  });

  it('proposes a fee change that only a different admin can approve, and lets a pending one be discarded', async () => {
    const a = await h.staff('admin');
    const b = await h.staff('admin');
    const support = await h.staff('support');
    // far in the future so the live prices other tests use are never touched
    const when = () => new Date(Date.UTC(2100, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), Math.floor(Math.random() * 24), Math.floor(Math.random() * 60))).toISOString();
    const body = { category: 'comfort', baseKobo: 120_000, perKmKobo: 20_000, perMinuteKobo: 13_000, waitingPerMinuteKobo: 5_000, freeWaitingSeconds: 300, taxKobo: 3_000, roundingStepKobo: 1_000, estimateLowBps: 8500, estimateHighBps: 11000 };
    await h.http().post('/admin/console/pricing').set(h.auth(support.token)).send({ ...body, effectiveFrom: when() }).expect(403);
    await h.http().post('/admin/console/pricing').set(h.auth(a.token)).send({ ...body, effectiveFrom: new Date(Date.now() + 60_000).toISOString() }).expect(400); // too soon
    await h.http().post('/admin/console/pricing').set(h.auth(a.token)).send({ ...body, baseKobo: -1, effectiveFrom: when() }).expect(400);

    const made = (await h.http().post('/admin/console/pricing').set(h.auth(a.token)).send({ ...body, effectiveFrom: when() }).expect(200)).body;
    const list = (await h.http().get('/admin/console/pricing').set(h.auth(a.token)).expect(200)).body;
    expect(list.find((v: { id: string }) => v.id === made.id).state).toBe('pending');
    await h.http().post(`/admin/console/pricing/${made.id}/approve`).set(h.auth(a.token)).expect(409); // not your own
    await h.http().post(`/admin/console/pricing/${made.id}/approve`).set(h.auth(b.token)).expect(204);
    await h.http().post(`/admin/console/pricing/${made.id}/approve`).set(h.auth(b.token)).expect(409); // already approved
    await h.http().delete(`/admin/console/pricing/${made.id}`).set(h.auth(b.token)).expect(409); // approved versions are permanent

    const other = (await h.http().post('/admin/console/pricing').set(h.auth(a.token)).send({ ...body, effectiveFrom: when() }).expect(200)).body;
    await h.http().delete(`/admin/console/pricing/${other.id}`).set(h.auth(b.token)).expect(204);
  });

  it('stops a driver going online while their vehicle is suspended, and records who did it', async () => {
    const admin = await h.staff('admin');
    const support = await h.staff('support');
    const driver = await h.login('driver', 'Vehicletest Driver');
    const plate = uniquePlate();
    const vehicleId = (await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, 'regular', 'Honda', 'Blue', $2) RETURNING id`, [driver.id, plate])).rows[0].id;
    const ping = () => h.http().post('/driver/location').set(h.auth(driver.token)).send({ lat: 6.52, lng: 3.37 });
    await ping().expect(204);

    await h.http().post(`/admin/console/vehicles/${vehicleId}/suspend`).set(h.auth(support.token)).send({ reason: 'x' }).expect(400); // a reason is required
    await h.http().post(`/admin/console/vehicles/${vehicleId}/suspend`).set(h.auth(support.token)).send({ reason: 'failed roadworthiness check' }).expect(204);
    const blocked = await ping().expect(409);
    expect(blocked.body.code).toBe('no_active_vehicle');
    await h.http().post(`/admin/console/vehicles/${vehicleId}/suspend`).set(h.auth(support.token)).send({ reason: 'again' }).expect(409);

    const detail = (await h.http().get(`/admin/console/vehicles/${vehicleId}`).set(h.auth(support.token)).expect(200)).body;
    expect(detail).toMatchObject({ plate, suspendedReason: 'failed roadworthiness check' });
    expect(detail.history[0]).toMatchObject({ status: 'suspended' });
    expect((await h.http().get(`/admin/console/vehicles?search=${plate}`).set(h.auth(support.token)).expect(200)).body.items[0].suspended).toBe(true);

    await h.http().post(`/admin/console/vehicles/${vehicleId}/reinstate`).set(h.auth(support.token)).send({ reason: 'passed the re-check' }).expect(204);
    await ping().expect(204);

    // adding a vehicle is for admins, and retires the old one
    const body = { driverId: driver.id, category: 'comfort', make: 'Toyota', colour: 'White', plate: uniquePlate() };
    await h.http().post('/admin/console/vehicles').set(h.auth(support.token)).send(body).expect(403);
    await h.http().post('/admin/console/vehicles').set(h.auth(admin.token)).send(body).expect(200);
    await h.http().post('/admin/console/vehicles').set(h.auth(admin.token)).send(body).expect(409); // plate already registered
    const after = (await h.http().get(`/admin/console/people/${driver.id}`).set(h.auth(support.token)).expect(200)).body;
    expect(after.vehicles.find((v: { plate: string }) => v.plate === plate).active).toBe(false);
  });
});
