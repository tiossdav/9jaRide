import { bootApp } from './testing/harness.testing';

// Staff management: invite, one-time password, forced change, role and access changes. Skipped unless INTEGRATION=1.
const suite = process.env.INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

suite('team management', () => {
  let h: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { h = await bootApp(); }, 60_000);
  afterAll(async () => { await h.close(); });

  const login = (email: string, password: string) => h.http().post('/auth/staff/login').send({ email, password });

  it('lets only admins manage the team', async () => {
    const support = await h.staff('support');
    await h.http().get('/admin/team').set(h.auth(support.token)).expect(403);
    await h.http().post('/admin/team').set(h.auth(support.token)).send({ email: 'x@example.test', fullName: 'X Y', role: 'support' }).expect(403);
  });

  it('invites someone with a one-time password they must change, then signs them in', async () => {
    const admin = await h.staff('admin');
    const email = `invitee-${Date.now()}@example.test`;
    const inv = (await h.http().post('/admin/team').set(h.auth(admin.token)).send({ email, fullName: 'New Hire', phone: '0803 000 1111', role: 'support' }).expect(200)).body;
    expect(inv.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await h.http().post('/admin/team').set(h.auth(admin.token)).send({ email, fullName: 'Dup', role: 'support' }).expect(409);

    const first = (await login(email, inv.temporaryPassword).expect(200)).body;
    expect(first).toMatchObject({ role: 'support', mustChangePassword: true });
    const bad = (pw: string) => h.http().post('/auth/staff/change-password').set(h.auth(first.accessToken)).send({ currentPassword: inv.temporaryPassword, newPassword: pw });
    await bad('short1').expect(400);
    await bad('onlyletterspassword').expect(400);
    await bad(inv.temporaryPassword).expect(400);
    await h.http().post('/auth/staff/change-password').set(h.auth(first.accessToken)).send({ currentPassword: 'wrong-current-pw1', newPassword: 'a-brand-new-pass-9' }).expect(401);
    await bad('a-brand-new-pass-9').expect(204);

    await login(email, inv.temporaryPassword).expect(401);
    const again = (await login(email, 'a-brand-new-pass-9').expect(200)).body;
    expect(again.mustChangePassword).toBe(false);
    // the old refresh token no longer works: changing the password ended every session
    await h.http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
  });

  it('changes roles and access, but never leaves the platform without an admin or lets you lock yourself out', async () => {
    const admin = await h.staff('admin');
    const other = await h.staff('support');
    const me = admin.id;
    await h.http().post(`/admin/team/${me}/role`).set(h.auth(admin.token)).send({ role: 'support' }).expect(400); // not your own
    await h.http().post(`/admin/team/${me}/active`).set(h.auth(admin.token)).send({ active: false }).expect(400);

    await h.http().post(`/admin/team/${other.id}/role`).set(h.auth(admin.token)).send({ role: 'finance' }).expect(204);
    expect((await h.http().get(`/admin/team/${other.id}`).set(h.auth(admin.token)).expect(200)).body.role).toBe('finance');
    await h.http().post('/auth/refresh').send({ refreshToken: (await login(other.email, other.password).expect(200)).body.refreshToken }).expect(200);

    await h.http().post(`/admin/team/${other.id}/active`).set(h.auth(admin.token)).send({ active: false }).expect(204);
    await login(other.email, other.password).expect(401);
    await h.http().post(`/admin/team/${other.id}/active`).set(h.auth(admin.token)).send({ active: true }).expect(204);
    await login(other.email, other.password).expect(200);

    const reset = (await h.http().post(`/admin/team/${other.id}/reset-password`).set(h.auth(admin.token)).expect(200)).body;
    expect((await login(other.email, reset.temporaryPassword).expect(200)).body.mustChangePassword).toBe(true);
    await h.http().get('/admin/team').query({ search: other.email }).set(h.auth(admin.token)).expect(200);
  });
});
