import { randomUUID } from 'crypto';
import { bootApp } from './testing/harness.testing';

// Chat between the rider and the driver of a ride: who may use it, when it is open, retries, unread counts and waiting for a
// new message. Real HTTP, Postgres and Valkey.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('rider-driver chat', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => {
    // a ride left searching would be offered to drivers in the suites that run after this one
    await h.pool.query(`UPDATE rides SET status = 'CANCELLED_BY_SYSTEM', cancel_reason = 'test cleanup' WHERE status = 'SEARCHING_DRIVER'`);
    await h.close();
  });

  /** A ride in the given state, written directly. */
  async function ride(riderId: string, driverId: string, status: string) {
    const r = await h.pool.query(
      `INSERT INTO rides (short_code, rider_id, driver_id, category, status, payment_status, payment_method, pickup, dropoff, idempotency_key)
       VALUES ($1, $2, $3, 'regular', $4, 'UNPAID', 'cash', ST_SetSRID(ST_MakePoint(3.3, 6.5), 4326)::geography, ST_SetSRID(ST_MakePoint(3.4, 6.4), 4326)::geography, $5) RETURNING id`,
      [randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(), riderId, driverId, status, randomUUID()]);
    return r.rows[0].id as string;
  }

  it('lets the two of them talk while the trip is on, and nobody else', async () => {
    const rider = await h.login('rider', 'Chat Rider');
    const driver = await h.login('driver', 'Chat Driver');
    const stranger = await h.login('rider', 'Someone Else');
    const id = await ride(rider.id, driver.id, 'DRIVER_ASSIGNED');
    const post = (who: { token: string }, text: string, clientId?: string) => h.http().post(`/rides/${id}/messages`).set(h.auth(who.token)).send({ text, clientId });
    const list = (who: { token: string }, q = '') => h.http().get(`/rides/${id}/messages${q}`).set(h.auth(who.token));

    // empty to begin with, and open
    expect((await list(rider).expect(200)).body).toMatchObject({ messages: [], open: true, unread: 0, with: 'Chat' });
    const m1 = (await post(rider, '  Hello, I am at the gate  ', 'c1').expect(200)).body;
    expect(m1).toMatchObject({ mine: true, text: 'Hello, I am at the gate' });
    // the same message sent again (a retry after a dropped connection) is stored once
    expect((await post(rider, 'Hello, I am at the gate', 'c1').expect(200)).body.id).toBe(m1.id);
    await post(driver, 'On my way', 'd1').expect(200);

    // each sees both, from their own side; the other's message is unread until marked read
    const seenByDriver = (await list(driver).expect(200)).body;
    expect(seenByDriver.messages.map((m: { text: string; mine: boolean }) => [m.text, m.mine])).toEqual([['Hello, I am at the gate', false], ['On my way', true]]);
    expect(seenByDriver.unread).toBe(0); // answering means the driver has read what came before
    expect((await list(rider).expect(200)).body.unread).toBe(1); // the driver's reply has not been read by the rider yet
    const m3 = (await post(rider, 'Second one', 'c2').expect(200)).body;
    expect((await list(driver).expect(200)).body.unread).toBe(1);
    await h.http().post(`/rides/${id}/messages/read`).set(h.auth(driver.token)).send({ upTo: m3.id }).expect(204);
    expect((await list(driver).expect(200)).body.unread).toBe(0);

    // the ride views carry the unread count, so the button can show a badge
    await post(driver, 'Almost there', 'd2').expect(200);
    expect((await h.http().get(`/rides/${id}`).set(h.auth(rider.token)).expect(200)).body.unreadMessages).toBe(1);

    // a stranger cannot read or write, and empty or oversized text is refused
    await list(stranger).expect(403);
    await post(stranger, 'hi').expect(403);
    await post(rider, '   ').expect(400);
    await post(rider, 'x'.repeat(501)).expect(400);
    await h.http().get(`/rides/${id}/messages`).expect(401);
  });

  it('holds a request until a message arrives, and answers at once when one does', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await ride(rider.id, driver.id, 'IN_TRANSIT');
    const started = Date.now();
    const waiting = h.http().get(`/rides/${id}/messages?after=0&wait=10`).set(h.auth(driver.token)).then((r) => r);
    await new Promise((r) => setTimeout(r, 700));
    await h.http().post(`/rides/${id}/messages`).set(h.auth(rider.token)).send({ text: 'Are you close?', clientId: 'w1' }).expect(200);
    const res = await waiting;
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(['Are you close?']);
    expect(Date.now() - started).toBeLessThan(5000); // answered by the message, not by the time running out
  });

  it('closes when the trip is over, but the two can still read what was said', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await ride(rider.id, driver.id, 'DRIVER_ARRIVED');
    await h.http().post(`/rides/${id}/messages`).set(h.auth(driver.token)).send({ text: 'I am here' }).expect(200);
    await h.pool.query(`UPDATE rides SET status = 'TRIP_COMPLETED' WHERE id = $1`, [id]);
    const res = await h.http().post(`/rides/${id}/messages`).set(h.auth(rider.token)).send({ text: 'thanks' }).expect(409);
    expect(res.body.code).toBe('chat_closed');
    const view = (await h.http().get(`/rides/${id}/messages`).set(h.auth(rider.token)).expect(200)).body;
    expect(view).toMatchObject({ open: false });
    expect(view.messages).toHaveLength(1);
    // before a driver is assigned there is no one to talk to
    const open = await h.pool.query(
      `INSERT INTO rides (short_code, rider_id, category, status, payment_status, payment_method, pickup, dropoff, idempotency_key)
       VALUES ($3, $1, 'regular', 'SEARCHING_DRIVER', 'UNPAID', 'cash', ST_SetSRID(ST_MakePoint(3.3, 6.5), 4326)::geography, ST_SetSRID(ST_MakePoint(3.4, 6.4), 4326)::geography, $2) RETURNING id`, [rider.id, randomUUID(), randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()]);
    await h.http().post(`/rides/${open.rows[0].id}/messages`).set(h.auth(rider.token)).send({ text: 'anyone?' }).expect(409);
  });

  it('slows down someone sending far too fast', async () => {
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const id = await ride(rider.id, driver.id, 'DRIVER_ASSIGNED');
    let refused = 0;
    for (let i = 0; i < 34; i++) {
      const r = await h.http().post(`/rides/${id}/messages`).set(h.auth(rider.token)).send({ text: `m${i}`, clientId: `f${i}` });
      if (r.status === 429) refused++;
    }
    expect(refused).toBeGreaterThanOrEqual(3);
  });
});
