import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { DispatchService } from './dispatch/dispatch.service';
import { bootApp } from './testing/harness.testing';

// Businesses and their vehicles: the list, importing it, giving a vehicle to a driver, and the share taken from a driver's trips.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;
const plate = () => `F${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`;
const pickup = { lat: 6.5244, lng: 3.3792 };
const dropoff = { lat: 6.45, lng: 3.4 };

suite('business vehicles and the share taken from drivers', () => {
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

  const csv = (lines: string[]) => Buffer.from(['plate,make model,colour,category,year', ...lines].join('\n'));

  /** An admin, a business, and an account that belongs to that business. */
  async function world() {
    const admin = await h.staff('admin');
    const name = `Fleet Co ${randomUUID().slice(0, 6)}`;
    const biz = (await h.http().post('/fleet/businesses').set(h.auth(admin.token)).send({ name, defaultDeductionBps: 2500 }).expect(200)).body.id as string;
    const email = `biz-${randomUUID()}@example.test`;
    const invite = await h.http().post('/admin/team').set(h.auth(admin.token)).send({ email, fullName: 'Fleet Manager', role: 'business', businessId: biz }).expect(200);
    // the invited person signs in with the temporary password
    const login = await h.http().post('/auth/staff/login').send({ email, password: invite.body.temporaryPassword }).expect(200);
    expect(login.body.role).toBe('business');
    return { admin, biz, business: { token: login.body.accessToken as string, email } };
  }

  it('imports a CSV after a dry run that explains every problem line', async () => {
    const { admin, biz, business } = await world();
    const existing = plate();
    await h.http().post('/fleet/vehicles').set(h.auth(business.token)).send({ plate: existing, makeModel: 'Toyota Corolla', colour: 'Silver', category: 'regular' }).expect(200);
    const good1 = plate(); const good2 = plate();
    const file = csv([
      `${good1.toLowerCase()},Toyota Camry,Black,Regular,2019`,
      `${good2.slice(0, 3)}-${good2.slice(3)},Honda Accord,Grey,comfort,`,
      `${existing},Kia Rio,Red,regular,2018`,           // already registered
      `${good1},Kia Rio,Red,regular,2018`,              // the same plate twice in the file
      `AB,Kia Rio,Red,regular,2018`,                    // not a plate
      `${plate()},Kia Rio,Red,limousine,2018`,          // unknown category
      `${plate()},,Red,regular,2018`,                   // no model
      `${plate()},Kia Rio,Red,regular,1850`,            // impossible year
    ]);

    const dry = (await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).field('dryRun', 'true').attach('file', file, 'vehicles.csv').expect(200)).body;
    expect(dry).toMatchObject({ dryRun: true, lines: 8, valid: 2, imported: 0, rejected: 6 });
    expect(dry.errors.map((e: { row: number }) => e.row)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(dry.errors[0].message).toContain('already registered');
    expect(dry.errors[1].message).toContain('line 2');
    expect((await h.http().get('/fleet/vehicles').query({ search: good1 }).set(h.auth(business.token)).expect(200)).body.total).toBe(0); // a dry run saves nothing

    const done = (await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).attach('file', file, 'vehicles.csv').expect(200)).body;
    expect(done).toMatchObject({ imported: 2, rejected: 6 });
    const list = (await h.http().get('/fleet/vehicles').query({ search: good2.toLowerCase() }).set(h.auth(business.token)).expect(200)).body; // found however it is typed
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ plate: good2, makeModel: 'Honda Accord', category: 'comfort', status: 'pending', available: false });
    // sending it again changes nothing
    expect((await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).attach('file', file, 'vehicles.csv').expect(200)).body.imported).toBe(0);
    expect(admin.token).toBeTruthy(); expect(biz).toBeTruthy();
  });

  it('imports an Excel file, and refuses a file that is not a list of vehicles', async () => {
    const { business } = await world();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vehicles');
    ws.addRow(['Plate Number', 'Make and Model', 'Color', 'Type']);
    const p1 = plate(); const p2 = plate();
    ws.addRow([p1, 'Toyota Hiace', 'White', 'Regular']);
    ws.addRow([p2, 'Toyota Sienna', 'Blue', 'Comfort']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const res = (await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).attach('file', xlsx, 'fleet.xlsx').expect(200)).body;
    expect(res).toMatchObject({ imported: 2, rejected: 0 });

    const wrong = await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).attach('file', Buffer.from('name,age\nAda,20\n'), 'people.csv').expect(400);
    expect(wrong.body.message).toContain('must name these columns');
    await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).attach('file', Buffer.from([1, 2, 3, 0, 4]), 'x.bin').expect(400);
    await h.http().post('/fleet/vehicles/import').set(h.auth(business.token)).expect(400); // no file
  });

  it('keeps each business to its own vehicles, and keeps drivers and riders out', async () => {
    const a = await world(); const b = await world();
    const mine = (await h.http().post('/fleet/vehicles').set(h.auth(a.business.token)).send({ plate: plate(), makeModel: 'Toyota Corolla', colour: 'Silver', category: 'regular' }).expect(200)).body.id;
    await h.http().get(`/fleet/vehicles/${mine}`).set(h.auth(a.business.token)).expect(200);
    await h.http().get(`/fleet/vehicles/${mine}`).set(h.auth(b.business.token)).expect(404); // not theirs
    await h.http().post(`/fleet/vehicles/${mine}/status`).set(h.auth(b.business.token)).send({ status: 'verified' }).expect(404);
    expect((await h.http().get('/fleet/vehicles').set(h.auth(b.business.token)).expect(200)).body.items.map((v: { id: string }) => v.id)).not.toContain(mine);
    expect((await h.http().get('/fleet/vehicles').set(h.auth(a.admin.token)).expect(200)).body.items.map((v: { id: string }) => v.id)).toContain(mine);
    await h.http().get('/admin/console/dashboard').set(h.auth(a.business.token)).expect(403); // a business sees no other part of the portal
    await h.http().post('/fleet/businesses').set(h.auth(a.business.token)).send({ name: 'Mine now' }).expect(403);
    await h.http().get('/fleet/vehicles').set(h.auth((await h.login('driver')).token)).expect(403);
    await h.http().get('/fleet/vehicles').set(h.auth((await h.login('rider')).token)).expect(403);
  });

  it('holds pictures with a vehicle, and only verified free vehicles can be given to approved drivers', async () => {
    const { admin, business } = await world();
    const id = (await h.http().post('/fleet/vehicles').set(h.auth(business.token)).send({ plate: plate(), makeModel: 'Toyota Corolla', colour: 'Silver', category: 'regular' }).expect(200)).body.id as string;
    const photo = (await h.http().post('/files').set(h.auth(business.token)).attach('file', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), 'car.png').expect(201)).body.id;
    await h.http().post(`/fleet/vehicles/${id}/images`).set(h.auth(business.token)).send({ fileId: photo }).expect(204);
    const detail = (await h.http().get(`/fleet/vehicles/${id}`).set(h.auth(business.token)).expect(200)).body;
    expect(detail.images).toHaveLength(1);
    await h.http().get(`/files/${photo}`).set(h.auth(business.token)).expect(200);
    await h.http().get(`/files/${photo}`).set(h.auth(admin.token)).expect(200);
    await h.http().post(`/fleet/vehicles/${id}/images`).set(h.auth(admin.token)).send({ fileId: photo }).expect(400); // not a file the admin uploaded

    // an approved driver, with their own car to begin with
    const driver = await h.login('driver', 'Fleet Driver');
    const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send({ arrangement: 'business_vehicle', vehicle: { category: 'regular' }, personal: h.personal(), documents: (await h.ownerDocs(driver.token)).filter((d) => d.kind !== 'nin' && ['selfie', 'drivers_licence', 'lassdri'].includes(d.kind)) }).expect(200);
    const assign = (body: object, who = business) => h.http().post(`/fleet/vehicles/${id}/assign`).set(h.auth(who.token)).send({ driverId: driver.id, deductionBps: 2000, ...body });

    await assign({}).expect(409); // not verified yet, and the driver is not approved
    await h.http().post(`/fleet/vehicles/${id}/status`).set(h.auth(business.token)).send({ status: 'verified' }).expect(204);
    expect((await assign({}).expect(409)).body.code).toBe('not_approved');
    await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(204); // the driver is verified; no vehicle yet

    expect((await h.http().get('/fleet/vehicles').query({ available: 'true' }).set(h.auth(business.token)).expect(200)).body.items.map((v: { id: string }) => v.id)).toContain(id);
    expect((await h.http().get('/fleet/drivers').query({ search: driver.phone }).set(h.auth(business.token)).expect(200)).body[0]).toMatchObject({ id: driver.id, hasVehicle: false });
    await assign({ deductionBps: 9500 }).expect(400); // more than 90%
    const done = (await assign({ deductionBps: 3000, targetKobo: 5_000_000 }).expect(200)).body;
    expect(done.assignmentId).toBeTruthy();

    // it is taken now: not offered again, and not given to a second driver
    expect((await h.http().get('/fleet/vehicles').query({ available: 'true' }).set(h.auth(business.token)).expect(200)).body.items.map((v: { id: string }) => v.id)).not.toContain(id);
    const other = await h.login('driver');
    const subB = await h.http().post('/driver/application').set(h.auth(other.token)).send({ arrangement: 'business_vehicle', vehicle: { category: 'regular' }, personal: h.personal(), documents: (await h.ownerDocs(other.token)).filter((d) => ['selfie', 'drivers_licence', 'lassdri'].includes(d.kind)) }).expect(200);
    await h.http().post(`/admin/driver-applications/${subB.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(204);
    expect((await h.http().post(`/fleet/vehicles/${id}/assign`).set(h.auth(business.token)).send({ driverId: other.id, deductionBps: 1000 }).expect(409)).body.code).toBe('already_assigned');
    await h.http().post(`/fleet/vehicles/${id}/status`).set(h.auth(business.token)).send({ status: 'retired' }).expect(409); // in use

    // the driver now has the vehicle, can see the terms, and cannot change what the business set
    const me = (await h.http().get('/driver/profile').set(h.auth(driver.token)).expect(200)).body;
    expect(me.vehicle).toMatchObject({ arrangement: 'business_vehicle', category: 'regular' });
    const terms = (await h.http().get('/driver/vehicle-terms').set(h.auth(driver.token)).expect(200)).body.terms;
    expect(terms).toMatchObject({ percent: 30, setBy: 'owner', canChange: false, targetKobo: 5_000_000, paidKobo: 0 });
    expect((await h.http().put('/driver/vehicle-terms').set(h.auth(driver.token)).send({ deductionBps: 100 }).expect(409)).body.code).toBe('set_by_owner');

    // handing it back ends the assignment; the history stays
    await h.http().post(`/fleet/assignments/${done.assignmentId}/end`).set(h.auth(business.token)).send({ reason: 'Driver left' }).expect(204);
    await h.http().post(`/fleet/assignments/${done.assignmentId}/end`).set(h.auth(business.token)).send({ reason: 'Again' }).expect(409);
    const after = (await h.http().get(`/fleet/vehicles/${id}`).set(h.auth(business.token)).expect(200)).body;
    expect(after.available).toBe(true);
    expect(after.history[0]).toMatchObject({ driver: { id: driver.id }, endedReason: 'Driver left', deductionBps: 3000 });
    await expect(h.pool.query(`UPDATE vehicle_assignments SET driver_id = $2 WHERE id = $1`, [done.assignmentId, other.id])).rejects.toThrow(); // history cannot be rewritten
    await expect(h.pool.query(`DELETE FROM vehicle_assignments WHERE id = $1`, [done.assignmentId])).rejects.toThrow();
    expect((await h.http().get('/driver/profile').set(h.auth(driver.token)).expect(200)).body.vehicle).toBeNull(); // no vehicle again

    // the same vehicle goes to the next driver, with its record reused
    expect((await h.http().post(`/fleet/vehicles/${id}/assign`).set(h.auth(business.token)).send({ driverId: other.id, deductionBps: 1000 }).expect(200)).body.assignmentId).toBeTruthy();
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM vehicles WHERE plate = $1`, [detail.plate])).rows[0].n).toBe(1);
  });

  it('takes the owner share from each trip, shows the driver what is left, and stops at the target', async () => {
    const rider = await h.login('rider', 'Share Rider');
    const driver = await h.login('driver', 'Share Driver');
    const plateNo = plate();
    const vehicleId = (await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate, arrangement) VALUES ($1, 'package', 'Toyota', 'Blue', $2, 'business_vehicle') RETURNING id`, [driver.id, plateNo])).rows[0].id;
    const ownerId = (await h.pool.query(`INSERT INTO vehicle_owners (kind, name) VALUES ('individual', 'Mr Owner') RETURNING id`)).rows[0].id;
    // 20% of what the driver earns, until 1,500 kobo have been paid (the driver has agreed to it)
    const assignmentId = (await h.pool.query(
      `INSERT INTO vehicle_assignments (driver_id, vehicle_id, owner_id, deduction_bps, target_kobo, deduction_set_by, agreement_accepted_at) VALUES ($1, $2, $3, 2000, 1500, 'owner', now()) RETURNING id`, [driver.id, vehicleId, ownerId])).rows[0].id;

    const trip = async (method: 'cash' | 'wallet') => {
      await h.http().post('/driver/location').set(h.auth(driver.token)).send({ lat: pickup.lat + 0.002, lng: pickup.lng + 0.002, accuracyM: 8 }).expect(204);
      const q = (await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: 'package', distanceM: 6000, durationS: 900 }).expect(200)).body;
      const rideId = (await h.http().post('/rides').set(h.auth(rider.token)).set('Idempotency-Key', h.key()).send({ quoteId: q.quoteId, category: 'package', paymentMethod: method, pickup, dropoff, pickupAddress: 'Marina', dropoffAddress: 'Lekki' }).expect(200)).body.rideId as string;
      for (let i = 0; i < 40; i++) {
        await h.app.get(DispatchService).advance(rideId);
        if ((await h.pool.query(`SELECT 1 FROM ride_offers WHERE ride_id = $1`, [rideId])).rowCount) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await h.http().post(`/driver/rides/${rideId}/accept`).set(h.auth(driver.token)).expect(200);
      await h.http().post(`/driver/rides/${rideId}/arrive`).set(h.auth(driver.token)).expect(204);
      await h.http().post(`/driver/rides/${rideId}/start`).set(h.auth(driver.token)).expect(204);
      return { rideId, done: (await h.http().post(`/driver/rides/${rideId}/complete`).set(h.auth(driver.token)).send({ distanceM: 6000, durationS: 900, waitingS: 0 }).expect(200)).body };
    };
    await h.fund(rider.id, 5_000_000);
    const ownerBalance = async () => h.platform(`owner:${ownerId}`);

    // trip 1 (cash): 20% of the driver share goes to the owner, taken from the driver's wallet because the driver holds the cash
    const walletBefore = await h.wallet(driver.id);
    const first = await trip('cash');
    const share = first.done.driverEarnKobo;
    const cut = Math.floor((share * 2000) / 10_000);
    expect(cut).toBeGreaterThan(0);
    expect(first.done).toMatchObject({ vehicleDeductionKobo: Math.min(cut, 1500), driverKeepsKobo: share - Math.min(cut, 1500) });
    expect(await ownerBalance()).toBe(Math.min(cut, 1500));
    const walletAfterFirst = await h.wallet(driver.id);
    expect(walletAfterFirst - walletBefore).toBe(-(first.done.commissionKobo + first.done.taxKobo + Math.min(cut, 1500)));

    // trip 2 (wallet): paid into the wallet minus the owner share, and the target (1,500) is reached, so the deduction is capped
    const second = await trip('wallet');
    const left = 1500 - Math.min(cut, 1500);
    const cut2 = Math.min(Math.floor((second.done.driverEarnKobo * 2000) / 10_000), left);
    expect(second.done.vehicleDeductionKobo).toBe(cut2);
    expect(await ownerBalance()).toBe(Math.min(cut, 1500) + cut2);
    expect(await h.wallet(driver.id)).toBe(walletAfterFirst + second.done.driverEarnKobo - cut2);

    // trip 3: the vehicle is paid for, so nothing more is taken
    const third = await trip('wallet');
    expect(third.done.vehicleDeductionKobo).toBe(0);
    expect(third.done.driverKeepsKobo).toBe(third.done.driverEarnKobo);
    expect(await ownerBalance()).toBe(1500);

    // the records and what the driver sees
    expect((await h.pool.query(`SELECT count(*)::int AS n, sum(amount_kobo)::int AS total FROM vehicle_deductions WHERE assignment_id = $1`, [assignmentId])).rows[0].total).toBe(1500);
    const trips = (await h.http().get('/driver/trips').set(h.auth(driver.token)).expect(200)).body;
    expect(trips.items.find((t: { id: string }) => t.id === first.rideId)).toMatchObject({ earnedKobo: share, vehicleDeductionKobo: Math.min(cut, 1500), keptKobo: share - Math.min(cut, 1500) });
    expect(trips.today.vehicleDeductionKobo).toBe(1500);
    expect((await h.http().get('/driver/vehicle-terms').set(h.auth(driver.token)).expect(200)).body.terms).toMatchObject({ paidKobo: 1500, remainingKobo: 0, canChange: false });
    expect(await h.ledger.totalImbalanceKobo()).toBe(0); // every kobo still adds up
    await expect(h.pool.query(`UPDATE vehicle_deductions SET amount_kobo = 1 WHERE assignment_id = $1`, [assignmentId])).rejects.toThrow(); // append-only
  });

  it('lets a driver change a share they chose themselves, but not one set by the owner', async () => {
    const driver = await h.login('driver');
    const vehicleId = (await h.pool.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate, arrangement) VALUES ($1, 'regular', 'Honda', 'Grey', $2, 'third_party') RETURNING id`, [driver.id, plate()])).rows[0].id;
    const ownerId = (await h.pool.query(`INSERT INTO vehicle_owners (kind, name) VALUES ('individual', 'Aunty') RETURNING id`)).rows[0].id;
    await h.pool.query(`INSERT INTO vehicle_assignments (driver_id, vehicle_id, owner_id, deduction_bps, deduction_set_by, agreement_accepted_at) VALUES ($1, $2, $3, 1500, 'driver', now())`, [driver.id, vehicleId, ownerId]);
    expect((await h.http().get('/driver/vehicle-terms').set(h.auth(driver.token)).expect(200)).body.terms).toMatchObject({ percent: 15, setBy: 'driver', canChange: true });
    await h.http().put('/driver/vehicle-terms').set(h.auth(driver.token)).send({ deductionBps: 2500 }).expect(204);
    expect((await h.http().get('/driver/vehicle-terms').set(h.auth(driver.token)).expect(200)).body.terms.percent).toBe(25);
    await h.http().put('/driver/vehicle-terms').set(h.auth(driver.token)).send({ deductionBps: 9500 }).expect(400);
    await h.http().put('/driver/vehicle-terms').set(h.auth(driver.token)).send({ deductionBps: 50 }).expect(400);
    await h.http().put('/driver/vehicle-terms').set(h.auth((await h.login('driver')).token)).send({ deductionBps: 2000 }).expect(404); // no vehicle assigned
  });
});
