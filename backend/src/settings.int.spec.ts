import { randomUUID } from 'crypto';
import { SettingsService } from './settings/settings.service';
import { bootApp } from './testing/harness.testing';

// Rules an admin can edit, the list of ride categories, and the commission shares. Real HTTP and Postgres.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(60_000);

/** A start time in the far future that no earlier run has used (two versions cannot start at the same moment). */
const farFuture = () => new Date(Date.UTC(2101, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60))).toISOString();

suite('editable rules, categories and commission shares', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  const revenue = { commissionBps: 1500, taxBase: 'included', shares: [{ name: 'Platform', bps: 6000 }, { name: 'Tech partner', bps: 4000 }] };

  it('lets anyone on staff read the rules, but only an admin propose a change', async () => {
    const support = await h.staff('support');
    const rider = await h.login('rider');
    const got = (await h.http().get('/admin/settings/revenue').set(h.auth(support.token)).expect(200)).body;
    expect(got.current).toMatchObject({ commissionBps: 1200, taxBase: 'excluded' });
    expect(got.versions.some((v: { state: string }) => v.state === 'live')).toBe(true);
    await h.http().post('/admin/settings/revenue').set(h.auth(support.token)).send({ value: revenue, effectiveFrom: farFuture() }).expect(403);
    await h.http().get('/admin/settings/revenue').set(h.auth(rider.token)).expect(403);
    await h.http().get('/admin/settings/nonsense').set(h.auth(support.token)).expect(400);
  });

  it('refuses rules that make no sense, and a start time that is too soon', async () => {
    const a = await h.staff('admin');
    const post = (value: unknown, effectiveFrom = farFuture()) => h.http().post('/admin/settings/revenue').set(h.auth(a.token)).send({ value, effectiveFrom });
    expect((await post({ ...revenue, shares: [{ name: 'Platform', bps: 5000 }] }).expect(400)).body.message).toMatch(/add up to 100%/);
    await post({ ...revenue, commissionBps: 9000 }).expect(400);
    await post({ ...revenue, taxBase: 'sometimes' }).expect(400);
    await post(revenue, new Date(Date.now() + 60_000).toISOString()).expect(400);
  });

  it('needs a different admin to approve, and applies the rule only from its start time', async () => {
    const a = await h.staff('admin');
    const b = await h.staff('admin');
    const when = farFuture();
    const made = (await h.http().post('/admin/settings/revenue').set(h.auth(a.token)).send({ value: revenue, effectiveFrom: when }).expect(200)).body;
    const state = async () => (await h.http().get('/admin/settings/revenue').set(h.auth(a.token)).expect(200)).body.versions.find((v: { id: string }) => v.id === made.id).state;
    expect(await state()).toBe('pending');
    await h.http().post(`/admin/settings/versions/${made.id}/approve`).set(h.auth(a.token)).expect(409); // not your own
    await h.http().post(`/admin/settings/versions/${made.id}/approve`).set(h.auth(b.token)).expect(204);
    expect(await state()).toBe('scheduled');
    await h.http().post(`/admin/settings/versions/${made.id}/approve`).set(h.auth(b.token)).expect(409); // already approved
    await h.http().delete(`/admin/settings/versions/${made.id}`).set(h.auth(b.token)).expect(409); // approved is permanent

    const settings = h.app.get(SettingsService);
    expect(await settings.effective('revenue')).toMatchObject({ commissionBps: 1200 }); // not yet
    expect(await settings.effective('revenue', new Date(Date.parse(when) + 1000))).toMatchObject({ commissionBps: 1500, taxBase: 'included' });
    expect(await settings.effective('revenue', new Date('2000-01-01'))).toMatchObject({ commissionBps: 1200 }); // the past stays as it was
  });

  it('lets a waiting proposal be discarded, and the cancellation policy be edited the same way', async () => {
    const a = await h.staff('admin');
    const policy = { enabled: true, windowDays: 14, minRequests: 5, tiers: [{ fromPct: 10, toPct: 29, penaltyMinutes: 3 }, { fromPct: 30, toPct: 100, penaltyMinutes: 8 }] };
    await h.http().post('/admin/settings/cancellation').set(h.auth(a.token)).send({ value: { ...policy, tiers: [{ fromPct: 10, toPct: 40, penaltyMinutes: 3 }, { fromPct: 30, toPct: 100, penaltyMinutes: 8 }] }, effectiveFrom: farFuture() }).expect(400); // overlap
    const made = (await h.http().post('/admin/settings/cancellation').set(h.auth(a.token)).send({ value: policy, effectiveFrom: farFuture() }).expect(200)).body;
    await h.http().delete(`/admin/settings/versions/${made.id}`).set(h.auth(a.token)).expect(204);
    const got = (await h.http().get('/admin/settings/cancellation').set(h.auth(a.token)).expect(200)).body;
    expect(got.versions.find((v: { id: string }) => v.id === made.id)).toBeUndefined();
    expect(got.current.enabled).toBe(false); // off until an admin turns it on
  });

  it('manages ride categories: a new one is not bookable until it has fees, and a switched-off one is not offered', async () => {
    const admin = await h.staff('admin');
    const support = await h.staff('support');
    const rider = await h.login('rider');
    const code = `t${randomUUID().replace(/-/g, '').slice(0, 8)}`;

    await h.http().post('/admin/asset-types').set(h.auth(support.token)).send({ code, label: 'Test type' }).expect(403);
    await h.http().post('/admin/asset-types').set(h.auth(admin.token)).send({ code: 'Bad Code', label: 'x' }).expect(400);
    await h.http().post('/admin/asset-types').set(h.auth(admin.token)).send({ code, label: 'Test type' }).expect(204);
    await h.http().post('/admin/asset-types').set(h.auth(admin.token)).send({ code, label: 'Again' }).expect(409);

    const find = async () => (await h.http().get('/admin/asset-types').set(h.auth(support.token)).expect(200)).body.find((t: { code: string }) => t.code === code);
    expect(await find()).toMatchObject({ label: 'Test type', active: true, hasFees: false, bookable: false });
    const offered = async () => (await h.http().get('/rides/categories').set(h.auth(rider.token)).expect(200)).body.map((t: { code: string }) => t.code);
    expect(await offered()).not.toContain(code);
    await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: code, distanceM: 3000, durationS: 500 }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

    await h.pool.query(
      `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, created_by, approved_by, approved_at)
       VALUES ($1, now() - interval '1 day', 50000, 10000, 1000, $2, $3, now())`, [code, randomUUID(), randomUUID()],
    );
    expect(await offered()).toContain(code);
    expect(await find()).toMatchObject({ hasFees: true, bookable: true });
    await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: code, distanceM: 3000, durationS: 500 }).expect(200);

    await h.http().patch(`/admin/asset-types/${code}`).set(h.auth(admin.token)).send({ label: 'Renamed', active: false }).expect(204);
    expect(await find()).toMatchObject({ label: 'Renamed', active: false, bookable: false });
    expect(await offered()).not.toContain(code);
    await h.http().post('/rides/quote').set(h.auth(rider.token)).send({ category: code, distanceM: 3000, durationS: 500 }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    await h.http().patch('/admin/asset-types/nope_nope').set(h.auth(admin.token)).send({ label: 'x y' }).expect(404);
  });

  it('shares the commission, and pays a party only what they are owed, approved by a second person', async () => {
    const finance = await h.staff('finance');
    const admin = await h.staff('admin');
    const support = await h.staff('support');
    const rider = await h.login('rider');
    const driver = await h.login('driver');
    const rideId = await h.completedRide(rider.id, driver.id, 226_000);
    await h.ledger.withTransaction((c) => h.ledger.completeCashTrip(c, rideId, driver.id, 226_000, 3_000, {}));

    await h.http().get('/admin/stakeholders').set(h.auth(support.token)).expect(403);
    const before = (await h.http().get('/admin/stakeholders').set(h.auth(finance.token)).expect(200)).body.find((o: { name: string }) => o.name === 'Platform');
    expect(before.accruedKobo).toBeGreaterThanOrEqual(26_760);
    const cash = (code: string) => h.platform(code);
    const commissionBefore = await cash('platform:commission');

    await h.http().post('/admin/stakeholders/payouts').set(h.auth(finance.token)).send({ stakeholder: 'Platform', amountKobo: before.availableKobo + 1 }).expect(409);
    await h.http().post('/admin/stakeholders/payouts').set(h.auth(finance.token)).send({ stakeholder: 'Nobody Ltd', amountKobo: 100 }).expect(404);
    const made = (await h.http().post('/admin/stakeholders/payouts').set(h.auth(finance.token)).send({ stakeholder: 'platform', amountKobo: 10_000, reference: 'BANK-TRF-1' }).expect(200)).body;
    expect((await h.http().get('/admin/stakeholders').set(h.auth(finance.token)).expect(200)).body.find((o: { name: string }) => o.name === 'Platform').pendingKobo).toBeGreaterThanOrEqual(10_000);

    await h.http().post(`/admin/stakeholders/payouts/${made.id}/approve`).set(h.auth(finance.token)).expect(409); // not your own
    expect(await cash('platform:commission')).toBe(commissionBefore); // nothing moved yet
    await h.http().post(`/admin/stakeholders/payouts/${made.id}/approve`).set(h.auth(admin.token)).expect(204);
    expect(await cash('platform:commission')).toBe(commissionBefore - 10_000);
    await h.http().post(`/admin/stakeholders/payouts/${made.id}/approve`).set(h.auth(admin.token)).expect(409); // only once

    const after = (await h.http().get('/admin/stakeholders').set(h.auth(finance.token)).expect(200)).body.find((o: { name: string }) => o.name === 'Platform');
    expect(after.paidKobo).toBe(before.paidKobo + 10_000);

    const rejected = (await h.http().post('/admin/stakeholders/payouts').set(h.auth(finance.token)).send({ stakeholder: 'Platform', amountKobo: 5_000 }).expect(200)).body;
    await h.http().post(`/admin/stakeholders/payouts/${rejected.id}/reject`).set(h.auth(admin.token)).send({ reason: 'wrong account' }).expect(204);
    const list = (await h.http().get('/admin/stakeholders/payouts').query({ status: 'REJECTED' }).set(h.auth(finance.token)).expect(200)).body;
    expect(list.find((p: { id: string }) => p.id === rejected.id)).toMatchObject({ rejectedReason: 'wrong account' });
  });
});
