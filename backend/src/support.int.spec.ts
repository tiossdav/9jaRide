import { bootApp } from './testing/harness.testing';

jest.setTimeout(60_000);
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('support tickets', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  it('takes a problem report from the app once, even if it is sent twice', async () => {
    const rider = await h.login('rider');
    const key = h.key();
    const send = (body: object) => h.http().post('/support/tickets').set(h.auth(rider.token)).set('Idempotency-Key', key).send(body);
    await send({ topic: 'payment', message: 'hi' }).expect(400); // too short to mean anything
    await send({ topic: 'nonsense', message: 'My wallet was charged twice' }).expect(400);
    const one = (await send({ topic: 'payment', message: 'My wallet was charged twice' }).expect(200)).body;
    const two = (await send({ topic: 'payment', message: 'My wallet was charged twice' }).expect(200)).body;
    expect(two.id).toBe(one.id);
    await h.http().post('/support/tickets').set(h.auth(rider.token)).send({ topic: 'app', message: 'No key' }).expect(400);
    expect((await h.http().get('/support/tickets').set(h.auth(rider.token)).expect(200)).body).toHaveLength(1);
  });

  it('only lets someone link their own trip', async () => {
    const rider = await h.login('rider');
    const other = await h.login('rider');
    const driver = await h.login('driver');
    const mine = await h.completedRide(rider.id, driver.id, 100_000);
    const post = (token: string, rideId: string) => h.http().post('/support/tickets').set(h.auth(token)).set('Idempotency-Key', h.key()).send({ topic: 'trip', message: 'Driver took a long route', rideId });
    await post(rider.token, mine).expect(200);
    await post(other.token, mine).expect(404);
  });

  it('is handled by support: take it, add notes, resolve with words the person sees, reopen', async () => {
    const rider = await h.login('rider', 'Ticket Rider');
    const a = await h.staff('support');
    const b = await h.staff('support');
    const finance = await h.staff('finance');
    const made = (await h.http().post('/support/tickets').set(h.auth(rider.token)).set('Idempotency-Key', h.key()).send({ topic: 'safety', message: 'The driver was driving unsafely' }).expect(200)).body;

    await h.http().get('/admin/support').set(h.auth(finance.token)).expect(403);
    await h.http().get('/admin/support').set(h.auth(rider.token)).expect(403);
    const open = (await h.http().get('/admin/support').query({ status: 'OPEN', search: 'Ticket Rider' }).set(h.auth(a.token)).expect(200)).body;
    expect(open.items.find((t: { id: string }) => t.id === made.id)).toMatchObject({ code: made.code, status: 'OPEN', person: 'Ticket Rider' });

    await h.http().post(`/admin/support/${made.id}/take`).set(h.auth(a.token)).expect(204);
    expect((await h.http().post(`/admin/support/${made.id}/take`).set(h.auth(b.token)).expect(409)).body.code).toBe('taken');
    await h.http().post(`/admin/support/${made.id}/notes`).set(h.auth(a.token)).send({ body: 'Called the driver, no answer' }).expect(204);
    await h.http().post(`/admin/support/${made.id}/status`).set(h.auth(a.token)).send({ status: 'RESOLVED' }).expect(400); // must say what was done
    await h.http().post(`/admin/support/${made.id}/status`).set(h.auth(a.token)).send({ status: 'RESOLVED', resolution: 'We spoke to the driver and issued a warning.' }).expect(204);
    await h.http().post(`/admin/support/${made.id}/status`).set(h.auth(a.token)).send({ status: 'RESOLVED', resolution: 'again again' }).expect(409);

    const detail = (await h.http().get(`/admin/support/${made.id}`).set(h.auth(a.token)).expect(200)).body;
    expect(detail).toMatchObject({ status: 'RESOLVED', topic: 'safety' });
    expect(detail.notes[0].body).toBe('Called the driver, no answer');
    const mine = (await h.http().get('/support/tickets').set(h.auth(rider.token)).expect(200)).body.find((t: { id: string }) => t.id === made.id);
    expect(mine).toMatchObject({ status: 'RESOLVED', resolution: 'We spoke to the driver and issued a warning.' });

    await h.http().post(`/admin/support/${made.id}/status`).set(h.auth(b.token)).send({ status: 'OPEN' }).expect(204);
    expect((await h.http().get(`/admin/support/${made.id}`).set(h.auth(b.token)).expect(200)).body).toMatchObject({ status: 'OPEN', resolution: null });
  });
});
