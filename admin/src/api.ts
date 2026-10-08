const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) {
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
  let field: string | undefined;
  try { const j = await res.json(); if (typeof j.message === 'string') message = j.message; else if (Array.isArray(j.message)) message = j.message.join(', '); if (typeof j.field === 'string') field = j.field; } catch { /* keep default */ }
  throw new ApiError(res.status, message, field);
}

// Anything that changes something (a save, an approval, an upload) is counted while it runs, so a "please wait" screen can cover the page
// and a second click cannot repeat it. Reading a page does not count: pages show their own loading state.
let writing: string[] = [];
const writeWatchers = new Set<() => void>();
const tell = () => writeWatchers.forEach((w) => w());
export const subscribeWrites = (w: () => void) => { writeWatchers.add(w); return () => { writeWatchers.delete(w); }; };
/** What the person is waiting for, or null when nothing is being saved. */
export const writingNow = (): string | null => writing[0] ?? null;
const SAYS: [RegExp, string][] = [
  [/\/files|upload|import/, 'Please wait while the file is being uploaded...'],
  [/approve/, 'Please wait while the application is being approved...'],
  [/verify|nin/, 'Please wait while we verify...'],
  [/request-changes|reject/, 'Please wait while your answer is being sent...'],
];
const says = (path: string) => SAYS.find(([r]) => r.test(path))?.[1] ?? 'Please wait...';
async function whileWriting<T>(method: string, path: string, run: () => Promise<T>): Promise<T> {
  if (method === 'GET') return run();
  const text = says(path);
  writing = [...writing, text]; tell();
  try { return await run(); } finally { const i = writing.indexOf(text); writing = [...writing.slice(0, i), ...writing.slice(i + 1)]; tell(); }
}

export function call<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  return whileWriting(method, path, () => callNow<T>(method, path, body, extra));
}

async function callNow<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res = await raw(method, path, body, read()?.accessToken, extra);
  if (res.status === 401 && read()) {
    if (await refresh()) res = await raw(method, path, body, read()?.accessToken, extra);
    else { onExpired(); throw new ApiError(401, 'Your session has ended. Sign in again.'); }
  }
  if (!res.ok) await fail(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Sends a form with a file in it (an upload, or a list of vehicles), signed in, with the same one retry after a refresh. */
export function sendForm<T = any>(path: string, form: FormData): Promise<T> {
  return whileWriting('POST', path, () => sendFormNow<T>(path, form));
}

async function sendFormNow<T = any>(path: string, form: FormData): Promise<T> {
  const go = async (token?: string) => {
    try { return await fetch(BASE + path, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }); } catch { throw new ApiError(0, 'Cannot reach the server. Check your connection.'); }
  };
  let res = await go(read()?.accessToken);
  if (res.status === 401 && read()) {
    if (await refresh()) res = await go(read()?.accessToken);
    else { onExpired(); throw new ApiError(401, 'Your session has ended. Sign in again.'); }
  }
  if (!res.ok) await fail(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Uploads one photo or PDF and returns its id. */
export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  return (await sendForm<{ id: string }>('/files', form)).id;
}

/** A private picture as something an <img> can show: fetched with the sign-in token, then turned into a local address. */
export async function blobUrl(path: string): Promise<string> {
  const send = (t?: string) => fetch(BASE + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  let res = await send(read()?.accessToken);
  if (res.status === 401 && (await refresh())) res = await send(read()?.accessToken);
  if (!res.ok) throw new ApiError(res.status, 'The picture could not be loaded.');
  return URL.createObjectURL(await res.blob());
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

/** Opens a private uploaded file (a photo or PDF) in a new tab, sending the sign-in token that a plain link could not. */
export async function openFile(path: string): Promise<void> {
  const tab = window.open('', '_blank'); // opened first so the browser does not treat it as a blocked pop-up
  try {
    const send = (t?: string) => fetch(BASE + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    let res = await send(read()?.accessToken);
    if (res.status === 401 && (await refresh())) res = await send(read()?.accessToken);
    if (!res.ok) throw new ApiError(res.status, res.status === 403 ? 'You are not allowed to open this file.' : 'The file could not be opened.');
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Asks a sleeping hosted server to start, and says when it answers. A free host can take a minute or two. */
export async function wakeServer(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 110_000);
    const res = await fetch(BASE + '/health', { signal: ctl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
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
