import { randomUUID } from 'crypto';
import { bootApp } from './testing/harness.testing';

// Sign-up and onboarding from a clean start: the temporary 0000 code, and each way a driver can come by a car.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;
const inFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const plate = () => `S${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`;
const phone = () => `+23480${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

suite('sign-up with the temporary code', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    h = await bootApp({ otpMode: 'test' });
  }, 60_000);
  afterAll(() => h.close());

  it('signs a rider up with 0000 and tells the app what length to expect', async () => {
    const p = phone();
    const sent = await h.http().post('/auth/otp/request').send({ phone: p }).expect(200);
    expect(sent.body).toMatchObject({ sent: true, codeLength: 4, testMode: true });
    await h.http().post('/auth/otp/verify').send({ phone: p, code: '1234' }).expect(401); // only 0000 works
    await h.http().post('/auth/otp/request').send({ phone: p }).expect(200);
    const ticket = await h.http().post('/auth/otp/verify').send({ phone: p, code: '0000' }).expect(422);
    const done = await h.http().post('/auth/register').send({ registrationTicket: ticket.body.registrationTicket, role: 'rider', fullName: 'New Rider' }).expect(200);
    expect(done.body).toMatchObject({ role: 'rider', isNewUser: true });
    // the same number signs in next time with the same code
    await h.http().post('/auth/otp/request').send({ phone: p }).expect(200);
    expect((await h.http().post('/auth/otp/verify').send({ phone: p, code: '0000' }).expect(200)).body).toMatchObject({ role: 'rider', isNewUser: false });
  });

  it('does not limit how often testers ask for a code, but still limits wrong guesses', async () => {
    const p = phone();
    for (let i = 0; i < 6; i++) await h.http().post('/auth/otp/request').send({ phone: p }).expect(200);
    for (let i = 0; i < 5; i++) await h.http().post('/auth/otp/verify').send({ phone: p, code: '9999' }).expect(401);
    await h.http().post('/auth/otp/verify').send({ phone: p, code: '0000' }).expect(401); // locked until a new code is asked for
    await h.http().post('/auth/otp/request').send({ phone: p }).expect(200);
    await h.http().post('/auth/otp/verify').send({ phone: p, code: '0000' }).expect(422);
  });

  it('lists the ways a driver can get a vehicle', async () => {
    const driver = await h.login('driver');
    const r = await h.http().get('/driver/application/arrangements').set(h.auth(driver.token)).expect(200);
    expect(r.body.items.map((a: { code: string }) => a.code)).toEqual(['own', 'business_vehicle', 'third_party']);
    expect(r.body.items[1]).toMatchObject({ code: 'business_vehicle', asksForVehicle: false, asksForOwner: false });
    expect(r.body.items[2]).toMatchObject({ asksForVehicle: true, asksForOwner: true });
  });


  describe('driver onboarding by arrangement', () => {
    /** The documents a platform-plan driver shows: who they are, no vehicle papers. */
    const personDocs = async (token: string) => (await h.ownerDocs(token)).filter((d) => ['drivers_licence', 'nin', 'lassdri'].includes(d.kind));
    const base = async (token: string, over: object = {}) => ({ arrangement: 'business_vehicle', vehicle: { category: 'regular' }, personal: h.personal(), documents: await personDocs(token), ...over });

    it('takes proof uploads, keeps them private, and lets staff look at them', async () => {
      const driver = await h.login('driver');
      const other = await h.login('driver');
      const support = await h.staff('support');
      const id = await h.upload(driver.token);
      const mine = await h.http().get(`/files/${id}`).set(h.auth(driver.token)).expect(200);
      expect(mine.headers['content-type']).toContain('image/png');
      await h.http().get(`/files/${id}`).set(h.auth(other.token)).expect(403); // not theirs
      await h.http().get(`/files/${id}`).set(h.auth(support.token)).expect(200); // staff review it
      await h.http().post('/files').set(h.auth(driver.token)).attach('file', Buffer.from('not an image at all'), 'x.png').expect(400); // judged by content, not by name
      await h.http().post('/files').set(h.auth(driver.token)).expect(400); // nothing sent
      const rider = await h.login('rider');
      await h.http().post('/files').set(h.auth(rider.token)).attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'x.jpg').expect(403);
      // an application cannot use someone else's upload
      const theirs = await personDocs(other.token);
      await h.http().post('/driver/application').set(h.auth(driver.token)).send(await base(driver.token, { documents: theirs })).expect(400);
    });

    it('asks for personal details and next of kin, and a driver can ask only for Regular or Comfort', async () => {
      const driver = await h.login('driver');
      const send = async (over: object) => h.http().post('/driver/application').set(h.auth(driver.token)).send(await base(driver.token, over));
      await send({ vehicle: { category: 'package' } }).then((r) => expect(r.status).toBe(400));
      await send({ personal: { ...h.personal(), nin: '123' } }).then((r) => expect(r.status).toBe(400));
      await send({ personal: { ...h.personal(), email: 'nope' } }).then((r) => expect(r.status).toBe(400));
      await send({ personal: { ...h.personal(), nextOfKin: { name: 'X', phone: 'bad', address: 'somewhere' } } }).then((r) => expect(r.status).toBe(400));
      await send({ personal: undefined }).then((r) => expect(r.status).toBe(400));
      await send({ vehicle: { category: 'comfort' } }).then((r) => expect(r.status).toBe(200));
      const mine = (await h.http().get('/driver/application').set(h.auth(driver.token)).expect(200)).body;
      expect(mine).toMatchObject({ status: 'SUBMITTED', vehicle: { category: 'comfort' }, personal: { nin: '12345678901', contactPreference: 'whatsapp', nextOfKin: { name: 'Ngozi Test', phone: '+2348031230000' } } });
      expect(mine.documents.map((d: { kind: string }) => d.kind).sort()).toEqual(['drivers_licence', 'lassdri', 'nin']);
    });

    it('lets the reviewer confirm a different category after inspecting the vehicle', async () => {
      const driver = await h.login('driver');
      const admin = await h.staff('admin');
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send({ ...(await base(driver.token, { arrangement: 'own', vehicle: { category: 'comfort', make: 'Honda', colour: 'Grey', plate: plate() } })), documents: await h.ownerDocs(driver.token) }).expect(200);
      const url = `/admin/driver-applications/${sub.body.id}/approve`;
      await h.http().post(url).set(h.auth(admin.token)).send({ category: 'nonexistent' }).expect(409);
      await h.http().post(url).set(h.auth(admin.token)).send({ category: 'regular' }).expect(204); // asked for Comfort, inspector says Regular
      const v = await h.pool.query(`SELECT category FROM vehicles WHERE driver_id = $1 AND active`, [driver.id]);
      expect(v.rows[0].category).toBe('regular');
      const a = await h.pool.query(`SELECT vehicle_category, approved_category, category_confirmed_by FROM driver_applications WHERE id = $1`, [sub.body.id]);
      expect(a.rows[0]).toMatchObject({ vehicle_category: 'comfort', approved_category: 'regular', category_confirmed_by: admin.id });
    });

    it('is enforced by the database itself, whatever code writes to it', async () => {
      const driver = await h.login('driver');
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await base(driver.token)).expect(200);
      // approving without a confirmed category is refused
      await expect(h.pool.query(`UPDATE driver_applications SET status = 'APPROVED', reviewed_by = $2 WHERE id = $1`, [sub.body.id, randomUUID()])).rejects.toThrow(/confirms the vehicle category/);
      // an application without personal details cannot be saved as submitted
      await expect(h.pool.query(`INSERT INTO driver_applications (driver_id, vehicle_category, arrangement) VALUES ($1, 'regular', 'platform_plan')`, [(await h.login('driver')).id])).rejects.toThrow(/missing personal details/);
      // a driver cannot ask for the package category
      await expect(h.pool.query(`UPDATE driver_applications SET vehicle_category = 'package' WHERE id = $1`, [sub.body.id])).rejects.toThrow();
      // uploaded files cannot be changed or removed
      const f = await h.upload(driver.token);
      await expect(h.pool.query(`DELETE FROM uploaded_files WHERE id = $1`, [f])).rejects.toThrow();
    });

    it('asks the owner of a borrowed car for their details and permission', async () => {
      const driver = await h.login('driver');
      const body = async (extra: object[] = []) => ({ arrangement: 'third_party', deductionBps: 2000, vehicle: { category: 'regular', make: 'Honda', colour: 'Grey', plate: plate() }, personal: h.personal(), documents: [...(await h.ownerDocs(driver.token)), ...extra] });
      const owner = { name: 'Mr Owner', phone: '08031234567' };
      await h.http().post('/driver/application').set(h.auth(driver.token)).send(await body()).expect(400); // no owner
      await h.http().post('/driver/application').set(h.auth(driver.token)).send({ ...(await body()), owner: { name: 'Mr Owner', phone: '08031234567' }, deductionBps: undefined }).expect(400); // no share chosen
      const first = await body();
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send({ ...first, owner }).expect(200);
      const admin = await h.staff('admin');
      const detail = (await h.http().get(`/admin/driver-applications/${sub.body.id}`).set(h.auth(admin.token)).expect(200)).body;
      expect(detail).toMatchObject({ arrangement: 'third_party', owner: { name: 'Mr Owner', phone: '+2348031234567' }, missingDocuments: ['owner_consent'] });
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(409);
      await h.http().post(`/admin/driver-applications/${sub.body.id}/request-changes`).set(h.auth(admin.token)).send({ note: 'add the owner consent' }).expect(204);
      await h.http().post('/driver/application').set(h.auth(driver.token)).send({ ...(await body([{ kind: 'owner_consent', fileId: await h.upload(driver.token) }])), owner }).expect(200);
      const again = (await h.http().get('/driver/application').set(h.auth(driver.token)).expect(200)).body;
      await h.http().post(`/admin/driver-applications/${again.id}/approve`).set(h.auth(admin.token)).send({}).expect(204);
      const v = await h.pool.query(`SELECT arrangement, owner_name FROM vehicles WHERE driver_id = $1 AND active`, [driver.id]);
      expect(v.rows[0]).toEqual({ arrangement: 'third_party', owner_name: 'Mr Owner' });
      // who drives what is recorded, with the share the driver chose and the owner who is paid it
      const a = await h.pool.query(`SELECT a.deduction_bps, a.deduction_set_by, o.name, o.kind FROM vehicle_assignments a JOIN vehicle_owners o ON o.id = a.owner_id WHERE a.driver_id = $1 AND a.ended_at IS NULL`, [driver.id]);
      expect(a.rows[0]).toEqual({ deduction_bps: 2000, deduction_set_by: 'driver', name: 'Mr Owner', kind: 'individual' });
    });

    it('checks the NIN with a verification service instead of a photo of the card', async () => {
      const driver = await h.login('driver');
      const admin = await h.staff('admin');
      const noPhoto = (await personDocs(driver.token)).filter((d) => d.kind !== 'nin'); // no NIN photo is sent or needed
      const withNin = (nin: string) => base(driver.token, { documents: noPhoto, personal: { ...h.personal(), nin } });

      // a number the service cannot find is refused on the spot, with a message the driver can act on
      const bad = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await withNin('12345678999')).expect(400);
      expect(bad.body.code).toBe('nin_failed');
      expect(bad.body.message).toContain('could not find');

      // a service that has not answered yet leaves the check pending; the application is still accepted
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await withNin('12345678000')).expect(200);
      expect((await h.http().get(`/admin/driver-applications/${sub.body.id}`).set(h.auth(admin.token)).expect(200)).body).toMatchObject({ ninCheck: { status: 'pending' }, missingDocuments: [] });

      // approval asks again; the service has answered by now
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(204);
      expect((await h.pool.query(`SELECT nin_status FROM driver_applications WHERE id = $1`, [sub.body.id])).rows[0].nin_status).toBe('verified');
    });

    it('lets an admin accept a NIN by hand when the check cannot settle it', async () => {
      const driver = await h.login('driver');
      const admin = await h.staff('admin');
      const support = await h.staff('support');
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await base(driver.token)).expect(200);
      await h.pool.query(`UPDATE driver_applications SET nin_status = 'failed', nin_reason = 'No match' WHERE id = $1`, [sub.body.id]);
      await h.pool.query(`UPDATE driver_applications SET nin = '12345678999' WHERE id = $1`, [sub.body.id]); // the service will keep refusing this one
      const refused = await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(409);
      expect(refused.body.code).toBe('nin_not_verified');
      await h.http().post(`/admin/driver-applications/${sub.body.id}/accept-nin`).set(h.auth(support.token)).send({ note: 'Checked the card in person' }).expect(403); // admin only
      await h.http().post(`/admin/driver-applications/${sub.body.id}/accept-nin`).set(h.auth(admin.token)).send({ note: 'Checked the card in person' }).expect(204);
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(204);
    });

    it('takes an approved driver through settlement: a payout account first, then done', async () => {
      const driver = await h.login('driver');
      const admin = await h.staff('admin');
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await base(driver.token)).expect(200);
      await h.http().post('/driver/settlement/complete').set(h.auth(driver.token)).expect(400); // not approved, no account
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(204);
      const before = (await h.http().get('/driver/settlement').set(h.auth(driver.token)).expect(200)).body;
      expect(before).toMatchObject({ done: false, account: null, terms: { kind: 'business', setBy: 'owner', canChange: false, waiting: true } });
      await h.http().post('/driver/settlement/complete').set(h.auth(driver.token)).expect(400); // still no account
      await h.http().post('/driver/settlement/account').set(h.auth(driver.token)).send({ bankName: 'GTBank', accountNumber: '123', accountName: 'Ada' }).expect(400);
      await h.http().post('/driver/settlement/account').set(h.auth(driver.token)).send({ bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Driver' }).expect(204);
      await h.http().post('/driver/settlement/complete').set(h.auth(driver.token)).expect(204);
      expect((await h.http().get('/driver/settlement').set(h.auth(driver.token)).expect(200)).body).toMatchObject({ done: true, account: { accountNumber: '0123456789' } });
    });

    /** The earlier fixed-instalment plans are switched off for new drivers but still work for old records, so these tests turn them on for a moment. */
    const legacy = async (work: () => Promise<void>) => {
      await h.pool.query(`UPDATE vehicle_arrangements SET active = true WHERE code = 'platform_plan'`);
      try { await work(); } finally { await h.pool.query(`UPDATE vehicle_arrangements SET active = false WHERE code = 'platform_plan'`); }
    };
    const planBase = async (token: string) => base(token, { arrangement: 'platform_plan' });

    it('still tracks an older fixed-instalment vehicle plan: payments, reversals and paying it off', async () => legacy(async () => {
      const driver = await h.login('driver');
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await planBase(driver.token)).expect(200);
      const admin = await h.staff('admin');
      const support = await h.staff('support');
      const finance = await h.staff('finance');
      const url = `/admin/driver-applications/${sub.body.id}/approve`;
      await h.http().post(url).set(h.auth(admin.token)).send({}).expect(400); // no car chosen
      const assignment = { vehicle: { category: 'regular', make: 'Toyota', colour: 'White', plate: plate() }, plan: { totalKobo: 1_000_000, depositKobo: 200_000, instalmentKobo: 100_000, frequency: 'weekly', startsOn: inFuture(-14) } };
      await h.http().post(url).set(h.auth(support.token)).send({ assignment }).expect(403); // support cannot commit company money
      await h.http().post(url).set(h.auth(admin.token)).send({ assignment: { ...assignment, plan: { ...assignment.plan, depositKobo: 2_000_000 } } }).expect(400); // deposit above price
      await h.http().post(url).set(h.auth(admin.token)).send({ assignment }).expect(204);

      const v = await h.pool.query(`SELECT arrangement FROM vehicles WHERE driver_id = $1 AND active`, [driver.id]);
      expect(v.rows[0].arrangement).toBe('platform_plan');

      let plan = (await h.http().get('/driver/vehicle-plan').set(h.auth(driver.token)).expect(200)).body.plan;
      expect(plan).toMatchObject({ status: 'active', paidKobo: 0, outstandingKobo: 1_000_000, terms: { instalmentKobo: 100_000, frequency: 'weekly' } });
      expect(plan.overdueKobo).toBe(500_000); // the deposit plus the three weekly instalments that have fallen due in two weeks
      const pay = (body: object, who = finance) => h.http().post(`/admin/vehicle-plans/${plan.id}/payments`).set(h.auth(who.token)).send(body);

      await pay({ kind: 'deposit', amountKobo: 200_000, method: 'transfer', reference: 'TRF-1' }, support).expect(403);
      await pay({ kind: 'deposit', amountKobo: 200_000, method: 'transfer', reference: 'TRF-1' }).expect(200);
      await pay({ kind: 'deposit', amountKobo: 200_000, method: 'transfer', reference: 'TRF-1' }).expect(409); // same reference twice
      await pay({ kind: 'instalment', amountKobo: 100_000, method: 'cash' }).expect(200);
      await pay({ kind: 'instalment', amountKobo: 900_000, method: 'cash' }).expect(409); // more than is owed
      await pay({ kind: 'reversal', amountKobo: 100_000, method: 'cash' }).expect(400); // needs a reason
      await pay({ kind: 'reversal', amountKobo: 100_000, method: 'cash', note: 'entered twice by mistake' }).expect(200);

      plan = (await h.http().get(`/admin/console/vehicle-plans/${plan.id}`).set(h.auth(support.token)).expect(200)).body;
      expect(plan).toMatchObject({ paidKobo: 200_000, outstandingKobo: 800_000 });
      expect(plan.payments.map((p: { kind: string }) => p.kind)).toEqual(['reversal', 'instalment', 'deposit']);

      // the admin sees it from the driver's profile and from the list
      const person = (await h.http().get(`/admin/console/people/${driver.id}`).set(h.auth(support.token)).expect(200)).body;
      expect(person.vehiclePlan).toMatchObject({ id: plan.id, outstandingKobo: 800_000 });
      const list = (await h.http().get('/admin/console/vehicle-plans?search=' + encodeURIComponent(assignment.vehicle.plate)).set(h.auth(support.token)).expect(200)).body;
      expect(list.items).toHaveLength(1);

      // paying it off closes the plan and nothing more can be recorded
      await pay({ kind: 'instalment', amountKobo: 800_000, method: 'transfer' }).expect(200);
      expect((await h.http().get(`/admin/console/vehicle-plans/${plan.id}`).set(h.auth(support.token)).expect(200)).body).toMatchObject({ status: 'completed', outstandingKobo: 0, nextDueOn: null });
      await pay({ kind: 'instalment', amountKobo: 100, method: 'cash' }).expect(409);
    }));

    it('shows the driver their own sign-up and onboarding details, and a photo they can replace', async () => {
      const driver = await h.login('driver', 'Ada Profile');
      const admin = await h.staff('admin');
      const p = plate();
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send({ ...(await base(driver.token, { arrangement: 'own', vehicle: { category: 'comfort', make: 'Honda Accord', colour: 'Grey', plate: p } })), documents: await h.ownerDocs(driver.token) }).expect(200);
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({}).expect(204);
      const me = (await h.http().get('/driver/profile').set(h.auth(driver.token)).expect(200)).body;
      expect(me).toMatchObject({
        name: 'Ada Profile', phone: driver.phone, photoFileId: null, application: { status: 'APPROVED', arrangement: 'own' },
        personal: { email: 'driver@example.com', nin: '12345678901', lassdri: 'LAS-778899', address: '12 Marina Road, Lagos', nextOfKin: { name: 'Ngozi Test', phone: '+2348031230000' } },
        vehicle: { plate: p.toUpperCase(), make: 'Honda Accord', colour: 'Grey', category: 'comfort', arrangement: 'own' },
      });
      // admins find the vehicle by plate however it is typed: lower case, with the dash, or with spaces
      const dashed = `${p.slice(0, 3)}-${p.slice(3)}`.toLowerCase();
      for (const term of [p.toLowerCase(), dashed, `${p.slice(0, 3)} ${p.slice(3)}`.toLowerCase()]) {
        const found = (await h.http().get('/admin/console/vehicles').query({ search: term }).set(h.auth(admin.token)).expect(200)).body;
        expect(found.items.map((v: { plate: string }) => v.plate)).toContain(p.toUpperCase());
        const drivers = (await h.http().get('/admin/console/drivers').query({ search: term }).set(h.auth(admin.token)).expect(200)).body;
        expect(drivers.items.map((d: { id: string }) => d.id)).toContain(driver.id);
      }
      const first = await h.upload(driver.token);
      await h.http().post('/driver/profile/photo').set(h.auth(driver.token)).send({ fileId: first }).expect(204);
      const second = await h.upload(driver.token);
      await h.http().post('/driver/profile/photo').set(h.auth(driver.token)).send({ fileId: second }).expect(204); // replaced
      expect((await h.http().get('/driver/profile').set(h.auth(driver.token)).expect(200)).body.photoFileId).toBe(second);
      const other = await h.login('driver');
      await h.http().post('/driver/profile/photo').set(h.auth(other.token)).send({ fileId: second }).expect(400); // someone else's file
      const trips = (await h.http().get('/driver/trips').set(h.auth(driver.token)).expect(200)).body;
      expect(trips).toMatchObject({ items: [], today: { trips: 0, earnedKobo: 0, keptKobo: 0, vehicleDeductionKobo: 0 } });
      await h.http().get('/driver/profile').set(h.auth((await h.login('rider')).token)).expect(403);
    });

    it('lets only an admin change an older plan to defaulted or cancelled', async () => legacy(async () => {
      const driver = await h.login('driver');
      const sub = await h.http().post('/driver/application').set(h.auth(driver.token)).send(await planBase(driver.token)).expect(200);
      const admin = await h.staff('admin');
      const finance = await h.staff('finance');
      await h.http().post(`/admin/driver-applications/${sub.body.id}/approve`).set(h.auth(admin.token)).send({ assignment: { vehicle: { category: 'regular', make: 'Kia', colour: 'Red', plate: plate() }, plan: { totalKobo: 500_000, depositKobo: 0, instalmentKobo: 50_000, frequency: 'daily', startsOn: inFuture(0) } } }).expect(204);
      const id = (await h.http().get('/driver/vehicle-plan').set(h.auth(driver.token)).expect(200)).body.plan.id;
      await h.http().post(`/admin/vehicle-plans/${id}/status`).set(h.auth(finance.token)).send({ status: 'defaulted', note: 'missed weeks' }).expect(403);
      expect((await h.http().post(`/admin/vehicle-plans/${id}/status`).set(h.auth(admin.token)).send({ status: 'defaulted', note: 'missed weeks' }).expect(200)).body.status).toBe('defaulted');
      await h.http().post(`/admin/vehicle-plans/${id}/status`).set(h.auth(admin.token)).send({ status: 'defaulted', note: 'again' }).expect(409);
      expect((await h.http().post(`/admin/vehicle-plans/${id}/status`).set(h.auth(admin.token)).send({ status: 'cancelled', note: 'car returned' }).expect(200)).body.status).toBe('cancelled');
    }));
  });
});
