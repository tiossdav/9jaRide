import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from './api';
import { dateTime, title } from './ui';

export interface Notice { id: string; type: string; severity: 'critical' | 'warning' | 'info'; title: string; text: string; at: string; link: string }
export interface OpenSos { id: string; at: string; role: string; person: string; phone: string; trip: string | null; tripId: string | null; location: { lat: number; lng: number } | null; escalated: boolean }
interface Feed { now: string; items: Notice[]; openSos: OpenSos[]; unresolvedSos: number }

const EVERY_MS = 6000;
const SHOW_MS = 9000;

/** A two-tone beep for an emergency. Browsers only allow sound after the person has clicked on the page once; if not, it stays silent. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.22 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      o.start(ctx.currentTime + i * 0.22); o.stop(ctx.currentTime + i * 0.22 + 0.21);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1200);
  } catch { /* no sound allowed yet */ }
}

/**
 * Pop-ups at the top right, on every page. Ordinary events fade after a few seconds and collect in the bell. An SOS does
 * not fade: it stays, red, until someone acknowledges it, and it comes back after a reload while it is still open.
 */
export function useNotifications(enabled: boolean) {
  const [toasts, setToasts] = useState<Notice[]>([]);
  const [history, setHistory] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [sos, setSos] = useState<OpenSos[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const announced = useRef(new Set<string>());

  const poll = useCallback(async () => {
    try {
      const q = since.current ? `?since=${encodeURIComponent(since.current)}` : '';
      const f = await get<Feed>(`/admin/console/notifications${q}`);
      const first = since.current === null; // the first answer is just "what is open now"; old events are not replayed as pop-ups
      since.current = f.now;
      setSos(f.openSos);
      setUnresolved(f.unresolvedSos ?? 0);
      if (f.openSos.some((s) => !announced.current.has(s.id))) { beep(); f.openSos.forEach((s) => announced.current.add(s.id)); }
      if (first) { f.items.forEach((n) => seen.current.add(n.id)); return; }
      const fresh = f.items.filter((n) => !seen.current.has(n.id));
      if (!fresh.length) return;
      fresh.forEach((n) => seen.current.add(n.id));
      const quiet = fresh.filter((n) => n.type !== 'sos'); // SOS has its own sticky card
      setHistory((h) => [...fresh, ...h].slice(0, 50));
      setUnread((u) => u + fresh.length);
      if (quiet.length) {
        setToasts((t) => [...quiet, ...t].slice(0, 4));
        quiet.forEach((n) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), SHOW_MS));
      }
    } catch { /* offline or asleep: try again at the next beat */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    poll();
    const t = setInterval(poll, EVERY_MS);
    return () => clearInterval(t);
  }, [enabled, poll]);

  return {
    toasts, history, unread, sos, unresolved,
    dismiss: (id: string) => setToasts((t) => t.filter((x) => x.id !== id)),
    markRead: () => setUnread(0),
    clear: () => { setHistory([]); setUnread(0); },
    acknowledge: async (id: string) => { await post(`/admin/sos/${id}/acknowledge`); setSos((s) => s.filter((x) => x.id !== id)); },
  };
}

type Api = ReturnType<typeof useNotifications>;

/**
 * Always in the top right corner: how many emergency alerts nobody has resolved yet (new and being handled). It counts every
 * unresolved alert however old, never resets at midnight, and falls only when an alert is marked resolved.
 */
export function SosIndicator({ api }: { api: Api }) {
  const nav = useNavigate();
  const n = api.unresolved;
  return (
    <button className={'sos-ind' + (n > 0 ? ' live' : '')} onClick={() => nav('/safety')} title="Open the Safety Center" aria-label={`SOS Alerts: ${n}. Open the Safety Center`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4" /><path d="M12 17.5h.01" /></svg>
      <span className="sos-t">SOS Alerts: <b>{n}</b></span>
    </button>
  );
}

const mapLink = (l: { lat: number; lng: number }) => `https://www.google.com/maps?q=${l.lat},${l.lng}`;

/** The stack in the corner. Mounted once in the layout, so it shows whichever page is open. */
export function NotificationStack({ api }: { api: Api }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="nt-stack" aria-live="assertive">
      {api.sos.map((s) => (
        <div key={s.id} className="nt-card critical" role="alert">
          <div className="nt-head"><span className="nt-dot" /> <b>SOS EMERGENCY</b><span className="grow" /><span className="note">{dateTime(s.at)}</span></div>
          <div className="nt-body"><b>{s.person}</b> ({title(s.role)}) needs help{s.trip ? <> on trip <b>{s.trip}</b></> : ''}.<div className="note">Phone {s.phone}{s.escalated ? ' · escalated to on-call' : ''}</div></div>
          {error && <div className="error">{error}</div>}
          <div className="nt-actions">
            <button className="btn danger" disabled={busy === s.id} onClick={async () => { setBusy(s.id); setError(null); try { await api.acknowledge(s.id); nav(`/safety/${s.id}`); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } }}>{busy === s.id ? 'Working…' : 'Acknowledge and open'}</button>
            <button className="btn ghost" onClick={() => nav(`/safety/${s.id}`)}>Open</button>
            {s.tripId && <button className="btn ghost" onClick={() => nav(`/trips/${s.tripId}`)}>Trip</button>}
            {s.location && <a className="btn ghost" href={mapLink(s.location)} target="_blank" rel="noreferrer">Location</a>}
          </div>
        </div>
      ))}
      {api.toasts.map((n) => (
        <div key={n.id} className={'nt-card ' + n.severity} role="status">
          <div className="nt-head"><b>{n.title}</b><span className="grow" /><button className="nt-x" aria-label="Dismiss" onClick={() => api.dismiss(n.id)}>×</button></div>
          <div className="nt-body">{n.text}</div>
          <div className="nt-actions"><span className="note">{dateTime(n.at)}</span><span className="grow" /><button className="btn ghost" onClick={() => { api.dismiss(n.id); nav(n.link); }}>View</button></div>
        </div>
      ))}
    </div>
  );
}

/** The bell in the header: a count of what arrived, and the list. */
export function NotificationBell({ api }: { api: Api }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label="Notifications" aria-expanded={open} onClick={() => { setOpen(!open); api.markRead(); }} style={{ position: 'relative' }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {(api.unread > 0 || api.sos.length > 0) && <span className="nt-badge">{api.sos.length || api.unread > 9 ? (api.sos.length ? '!' : '9+') : api.unread}</span>}
      </button>
      {open && (
        <div className="nt-panel" role="dialog" aria-label="Notifications">
          <div className="nt-head"><b>Notifications</b><span className="grow" />{api.history.length > 0 && <button className="nt-x" style={{ fontSize: 12 }} onClick={api.clear}>Clear</button>}</div>
          {api.history.length === 0 ? <div className="note" style={{ padding: 16 }}>Nothing new yet. New bookings, sign-ups, verifications and alerts appear here as they happen.</div> : (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>{api.history.map((n) => (
              <button key={n.id} className="nt-row" onClick={() => { setOpen(false); nav(n.link); }}>
                <span className={'nt-pip ' + n.severity} /><span style={{ flex: 1, textAlign: 'left' }}><b>{n.title}</b><div className="note">{n.text}</div></span><span className="note">{dateTime(n.at)}</span>
              </button>))}</div>
          )}
        </div>
      )}
    </div>
  );
}
