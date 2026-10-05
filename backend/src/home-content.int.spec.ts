import { randomUUID } from 'crypto';
import { bootApp } from './testing/harness.testing';

// The "For you" cards on the rider home screen, and how staff change them. Real HTTP, Postgres and Valkey.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('rider home cards', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  it('gives riders the active cards, with the Invite & Earn amount filled in, and lets an admin change them', async () => {
    const rider = await h.login('rider');
    const admin = await h.staff('admin');
    const support = await h.staff('support');

    const first = (await h.http().get('/app/home-cards').set(h.auth(rider.token)).expect(200)).body.items;
    expect(first.length).toBeGreaterThanOrEqual(3);
    const invite = first.find((c: { kind: string }) => c.kind === 'invite');
    expect(invite.title).toMatch(/^Invite & Earn ₦[\d,]+$/);

    // an admin changes the reward, adds an announcement and hides a card
    const all = (await h.http().get('/admin/home-cards').set(h.auth(support.token)).expect(200)).body.items;
    const row = all.find((c: { kind: string }) => c.kind === 'invite');
    await h.http().put(`/admin/home-cards/${row.id}`).set(h.auth(admin.token)).send({ kind: 'invite', title: 'Invite & Earn {amount}', body: row.body, amountKobo: 250_000, sortOrder: 1 }).expect(200);
    const note = `Road works ${randomUUID().slice(0, 6)}`;
    const made = (await h.http().post('/admin/home-cards').set(h.auth(admin.token)).send({ kind: 'announcement', title: note, body: 'Expect delays near the bridge.' }).expect(200)).body;
    const after = (await h.http().get('/app/home-cards').set(h.auth(rider.token)).expect(200)).body.items;
    expect(after[0]).toMatchObject({ kind: 'invite', title: 'Invite & Earn ₦2,500', amountKobo: 250_000 });
    expect(after.map((c: { title: string }) => c.title)).toContain(note);
    await h.http().put(`/admin/home-cards/${made.id}`).set(h.auth(admin.token)).send({ kind: 'announcement', title: note, body: 'x', active: false }).expect(200);
    expect((await h.http().get('/app/home-cards').set(h.auth(rider.token)).expect(200)).body.items.map((c: { title: string }) => c.title)).not.toContain(note);
    await h.http().delete(`/admin/home-cards/${made.id}`).set(h.auth(admin.token)).expect(204);

    // only an admin writes; a reward belongs on an invite card; riders do not see the admin list
    await h.http().post('/admin/home-cards').set(h.auth(support.token)).send({ kind: 'safety', title: 'x', body: 'y' }).expect(403);
    await h.http().post('/admin/home-cards').set(h.auth(admin.token)).send({ kind: 'safety', title: 'x', body: 'y', amountKobo: 100 }).expect(400);
    await h.http().get('/admin/home-cards').set(h.auth(rider.token)).expect(403);
    await h.http().get('/app/home-cards').expect(401);
    // put the reward back for other tests
    await h.http().put(`/admin/home-cards/${row.id}`).set(h.auth(admin.token)).send({ kind: 'invite', title: row.title, body: row.body, amountKobo: 100_000, sortOrder: row.sortOrder }).expect(200);
  });
});
