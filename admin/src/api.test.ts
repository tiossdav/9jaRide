import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, call, login, logout, setExpiredHandler, signedIn } from './api';

// Unit tests for the HTTP client: sign-in, the automatic token refresh, and how failures read.
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('signs in and keeps the tokens for this tab only', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'a1', refreshToken: 'r1', role: 'admin' }));
    expect(signedIn()).toBe(false);
    expect(await login('  Boss@Example.com ', 'pw')).toBe('admin');
    expect(signedIn()).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).email).toBe('Boss@Example.com'); // trimmed, the server lowercases
  });

  it('says plainly when the password is wrong or the account is locked', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'wrong email or password' }));
    await expect(login('a@b.co', 'x')).rejects.toThrow('Wrong email or password.');
    fetchMock.mockResolvedValueOnce(json(429, { message: 'too many failed attempts' }));
    await expect(login('a@b.co', 'x')).rejects.toThrow(/Too many attempts/);
  });

  it('sends the token, and swaps in a new one once when it has expired', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'old', refreshToken: 'r1', role: 'admin' }));
    await login('a@b.co', 'pw');
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new', refreshToken: 'r2' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    expect(await call('GET', '/me')).toEqual({ ok: true });
    const retry = fetchMock.mock.calls[3][1].headers.Authorization;
    expect(retry).toBe('Bearer new');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ refreshToken: 'r1' });
  });

  it('sends the person back to sign in when the refresh is refused', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'old', refreshToken: 'r1', role: 'admin' }));
    await login('a@b.co', 'pw');
    const expired = vi.fn();
    setExpiredHandler(expired);
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {}));
    await expect(call('GET', '/me')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalled();
    expect(signedIn()).toBe(false);
  });

  it('turns server errors into a sentence, including validation lists', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { message: ['amount must be a positive number', 'reason is too short'] }));
    await expect(call('POST', '/x', {})).rejects.toThrow('amount must be a positive number, reason is too short');
    fetchMock.mockResolvedValueOnce(json(500, 'not json'));
    await expect(call('GET', '/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('reports an unreachable server as such', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(call('GET', '/x')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Cannot reach') });
  });

  it('returns nothing for a 204', async () => {
    fetchMock.mockResolvedValueOnce(json(204, null));
    expect(await call('POST', '/x', {})).toBeUndefined();
  });

  it('forgets the tokens on sign out even if the server cannot be reached', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'a', refreshToken: 'r', role: 'admin' }));
    await login('a@b.co', 'pw');
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await logout();
    expect(signedIn()).toBe(false);
  });
});
