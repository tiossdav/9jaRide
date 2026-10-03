const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Tokens { accessToken: string; refreshToken: string }

// Tab-scoped on purpose: closing the tab signs staff out. (Move to httpOnly cookies when the portal gets its own domain.)
const read = (): Tokens | null => {
  try { return JSON.parse(sessionStorage.getItem('tokens') ?? 'null'); } catch { return null; }
};
const write = (t: Tokens | null) => {
  try { if (t) sessionStorage.setItem('tokens', JSON.stringify(t)); else sessionStorage.removeItem('tokens'); } catch { /* private window: stay signed in for this page only */ }
};

export const signedIn = () => read() !== null;
let onExpired: () => void = () => {};
export const setExpiredHandler = (f: () => void) => { onExpired = f; };

async function raw(method: string, path: string, body: unknown, token?: string, extra: Record<string, string> = {}): Promise<Response> {
  try {
    return await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
}

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const t = read();
    if (!t) return false;
    const res = await raw('POST', '/auth/refresh', { refreshToken: t.refreshToken });
    if (!res.ok) { if (res.status === 401) write(null); return false; }
    const j = await res.json();
    write({ accessToken: j.accessToken, refreshToken: j.refreshToken });
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function fail(res: Response): Promise<never> {
  let message = `Something went wrong (${res.status}).`;
  try { const j = await res.json(); if (typeof j.message === 'string') message = j.message; else if (Array.isArray(j.message)) message = j.message.join(', '); } catch { /* keep default */ }
  throw new ApiError(res.status, message);
}

export async function call<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res = await raw(method, path, body, read()?.accessToken, extra);
  if (res.status === 401 && read()) {
    if (await refresh()) res = await raw(method, path, body, read()?.accessToken, extra);
    else { onExpired(); throw new ApiError(401, 'Your session has ended. Sign in again.'); }
  }
  if (!res.ok) await fail(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const get = <T = any>(path: string) => call<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}, extra: Record<string, string> = {}) => call<T>('POST', path, body, extra);
export const del = <T = any>(path: string) => call<T>('DELETE', path);

/** Downloads a file the server builds (CSV), sending the sign-in token that a plain link could not. */
export async function download(path: string, filename: string): Promise<void> {
  const send = (t?: string) => fetch(BASE + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  let res = await send(read()?.accessToken);
  if (res.status === 401 && (await refresh())) res = await send(read()?.accessToken);
  if (!res.ok) throw new ApiError(res.status, res.status === 403 ? 'You are not allowed to export this.' : 'The export failed. Try again.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export async function login(email: string, password: string): Promise<string> {
  const res = await raw('POST', '/auth/staff/login', { email: email.trim(), password });
  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, 'Wrong email or password.');
    if (res.status === 429) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
    await fail(res);
  }
  const j = await res.json();
  write({ accessToken: j.accessToken, refreshToken: j.refreshToken });
  return j.role as string;
}

export async function logout(): Promise<void> {
  const t = read();
  write(null);
  if (t) await raw('POST', '/auth/logout', { refreshToken: t.refreshToken }).catch(() => undefined);
}
