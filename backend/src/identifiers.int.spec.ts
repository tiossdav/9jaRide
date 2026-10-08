import { bootApp, uniqueLassdri, uniqueLicence, uniqueNin, uniquePlate } from './testing/harness.testing';

// One driver per NIN, LASDRI number and licence number (however it is typed), a strict number plate format, and an error that names only the
// kind of number, never who holds it. Real HTTP, Postgres and Valkey.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('driver identifiers and number plates', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

  /** A complete application, with whichever numbers a test wants to control. */
  async function application(token: string, over: { nin?: string; lassdri?: string; licence?: string; plate?: string } = {}) {
    const docs = await h.ownerDocs(token);
    return {
      vehicle: { category: 'comfort', make: 'Toyota', colour: 'Black', plate: over.plate ?? uniquePlate() },
      personal: { ...h.personal(), ...(over.nin ? { nin: over.nin } : {}), ...(over.lassdri ? { lassdri: over.lassdri } : {}) },
      documents: docs.map((d) => (d.kind === 'drivers_licence' ? { ...d, number: over.licence ?? uniqueLicence(), expiresOn: future } : d)),
    };
  }
  const send = (token: string, body: object) => h.http().post('/driver/application').set(h.auth(token)).send(body);

  it('accepts only three letters, three digits and two letters, however it is typed', async () => {
    const driver = await h.login('driver');
    for (const bad of ['AB-123XY', 'ABC-12XY', '123-ABCXY', 'ABC-1234X', 'ABCD-123XY', 'ABC-123X', '']) {
      const r = await send(driver.token, await application(driver.token, { plate: bad || ' ' }));
      expect([bad, r.status, r.body.code, r.body.field]).toEqual([bad, 400, 'bad_plate', 'plate']);
      expect(r.body.message).toContain('ABC-123XY');
    }
    const ok = await send(driver.token, await application(driver.token, { plate: 'kja-482 ab' }));
    expect(ok.status).toBe(200);
    const stored = await h.pool.query(`SELECT vehicle_plate FROM driver_applications WHERE id = $1`, [ok.body.id]);
    expect(stored.rows[0].vehicle_plate).toBe('KJA482AB'); // capitals, no hyphen or spaces
  });

  it('refuses a NIN another driver already has, naming only the kind of number, and keeps the first driver\'s', async () => {
    const first = await h.login('driver');
    const second = await h.login('driver');
    const nin = uniqueNin();
    await send(first.token, await application(first.token, { nin })).then((r) => expect(r.status).toBe(200));

    const r = await send(second.token, await application(second.token, { nin }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'duplicate_identifier', field: 'nin', message: 'This NIN is already registered.' });
    expect(JSON.stringify(r.body)).not.toMatch(new RegExp(first.id));
    // nothing of the refused application was saved, so the second driver can fix the number and send again
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM driver_applications WHERE driver_id = $1`, [second.id])).rows[0].n).toBe(0);
    await send(second.token, await application(second.token)).then((x) => expect(x.status).toBe(200));
  });

  it('treats spaces, hyphens, slashes and capitals as the same number', async () => {
    const first = await h.login('driver');
    const second = await h.login('driver');
    const lassdri = uniqueLassdri();      // LAS-12345678
    const licence = uniqueLicence();      // LIC12345678
    await send(first.token, await application(first.token, { lassdri, licence })).then((r) => expect(r.status).toBe(200));

    const lassdriAgain = await send(second.token, await application(second.token, { lassdri: lassdri.toLowerCase().replace('-', ' ') }));
    expect(lassdriAgain.body).toMatchObject({ code: 'duplicate_identifier', field: 'lassdri', message: 'This LASDRI number is already registered.' });
    const licenceAgain = await send(second.token, await application(second.token, { licence: `${licence.slice(0, 3)} ${licence.slice(3, 7)}/${licence.slice(7)}`.toLowerCase() }));
    expect(licenceAgain.body).toMatchObject({ code: 'duplicate_identifier', field: 'licenceNumber', message: "This driver's licence number is already registered." });
  });

  it('lets a driver keep their own numbers when they send the application again, and change them', async () => {
    const driver = await h.login('driver');
    const admin = await h.staff('admin');
    const nin = uniqueNin(), lassdri = uniqueLassdri(), licence = uniqueLicence();
    const first = await send(driver.token, await application(driver.token, { nin, lassdri, licence })).then((r) => (expect(r.status).toBe(200), r.body));
    await h.http().post(`/admin/driver-applications/${first.id}/request-changes`).set(h.auth(admin.token)).send({ note: 'photo is blurry', items: ['selfie'] }).expect(204);
    // the same numbers again are fine: they are this driver's own
    const again = await send(driver.token, await application(driver.token, { nin, lassdri, licence }));
    expect(again.status).toBe(200);
    // a changed number moves over, and the old one is free for someone else
    await h.http().post(`/admin/driver-applications/${again.body.id}/request-changes`).set(h.auth(admin.token)).send({ note: 'wrong licence', items: ['drivers_licence'] }).expect(204);
    const newLicence = uniqueLicence();
    await send(driver.token, await application(driver.token, { nin, lassdri, licence: newLicence })).then((r) => expect(r.status).toBe(200));
    const other = await h.login('driver');
    await send(other.token, await application(other.token, { licence })).then((r) => expect(r.status).toBe(200));
  });

  it('lets only one of two drivers win when they claim the same number at the same moment', async () => {
    const a = await h.login('driver');
    const b = await h.login('driver');
    const nin = uniqueNin();
    const [bodyA, bodyB] = [await application(a.token, { nin }), await application(b.token, { nin })];
    const results = await Promise.all([send(a.token, bodyA), send(b.token, bodyB)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM driver_identifiers WHERE kind = 'nin' AND value = $1`, [nin])).rows[0].n).toBe(1);
  });

  it('answers yes or no to whether a number is free, without saying who has it', async () => {
    const first = await h.login('driver');
    const second = await h.login('driver');
    const nin = uniqueNin();
    const ask = (token: string, value: string) => h.http().get('/driver/application/identifier').query({ kind: 'nin', value }).set(h.auth(token));
    expect((await ask(second.token, nin).expect(200)).body).toEqual({ available: true });
    await send(first.token, await application(first.token, { nin })).then((r) => expect(r.status).toBe(200));
    expect((await ask(second.token, nin).expect(200)).body).toEqual({ available: false });
    expect((await ask(first.token, nin).expect(200)).body).toEqual({ available: true }); // their own
    await h.http().get('/driver/application/identifier').query({ kind: 'bank', value: '1' }).set(h.auth(second.token)).expect(400);
  });

  it('keeps a phone number to one account: the database refuses a second user with the same number', async () => {
    const driver = await h.login('driver');
    await expect(h.pool.query(`INSERT INTO users (phone, role, full_name) VALUES ($1, 'driver', 'Copy')`, [driver.phone])).rejects.toMatchObject({ code: '23505' });
  });
});
