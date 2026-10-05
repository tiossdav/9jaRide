import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError, blobUrl, get } from './api';

// ---------------------------------------------------------------- formatting
export const naira = (kobo: number | null | undefined, decimals = false): string => {
  if (kobo == null) return '-';
  const v = kobo / 100;
  return '₦' + v.toLocaleString('en-NG', decimals || kobo % 100 !== 0 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
};
const LAGOS = 'Africa/Lagos';
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: LAGOS, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const timeOnly = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: LAGOS, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');
export const duration = (s?: number | null) => (s == null ? '-' : `${Math.floor(s / 60)}m ${s % 60}s`);
/** Tidies an amount while it is typed: digits and one dot, with commas every three digits (1250000.5 shows as 1,250,000.5). */
export const moneyInput = (typed: string): string => {
  const clean = typed.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = clean.split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest.length ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped;
};
/** A plate as people read it: KJA482AB shows as KJA-482AB. The stored value stays plain capitals and digits. */
export const formatPlate = (stored?: string | null): string => {
  const p = (stored ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p.length <= 3 ? p : `${p.slice(0, 3)}-${p.slice(3)}`;
};
/** What a person typed into a plate box, reduced to what is stored. */
export const plateInput = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

/** Naira typed into a money box, as kobo. */
export const toKobo = (typed: string): number => Math.round(Number(typed.replace(/,/g, '')) * 100);

/** How a driver comes by their car, in words staff use. */
export const ARRANGEMENT: Record<string, string> = { own: 'Owns the vehicle', business_vehicle: "A business's vehicle", platform_plan: 'Platform vehicle (older payment plan)', third_party: "Someone else's vehicle" };
export const arrangementLabel = (code?: string | null) => (code ? ARRANGEMENT[code] ?? title(code) : '-');
export const title = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name?: string | null) => (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function statusChip(status: string): ReactNode {
  if (status === 'TRIP_COMPLETED') return <span className="chip">Completed</span>;
  if (status.startsWith('CANCELLED') || status === 'NO_DRIVER_FOUND') return <span className="chip red">{status === 'NO_DRIVER_FOUND' ? 'No driver' : 'Cancelled'}</span>;
  if (status === 'SCHEDULED') return <span className="chip blue">Scheduled</span>;
  return <span className="chip amber">In progress</span>;
}

export function paymentChip(status: string): ReactNode {
  if (status === 'PAID') return <span className="chip">Paid</span>;
  if (status === 'REFUNDED') return <span className="chip blue">Refunded</span>;
  if (status === 'HELD') return <span className="chip amber">Held</span>;
  return <span className="chip grey">Pending</span>;
}

// ---------------------------------------------------------------- icons
const P = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z',
  users: 'M9 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z',
  car: 'M4 15l1.5-5A2 2 0 0 1 7.4 8.5h9.2a2 2 0 0 1 1.9 1.5L20 15v3h-3v-1.5H7V18H4z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.2a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 0 0 0-2.6z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  out: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM21 21l-4.5-4.5',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  help: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5',
  wallet: 'M6 6h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM16 12.5h2',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  share: 'M6 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM18 3.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6',
  activity: 'M4 12h4l3-8 4 16 3-8h2',
  chevR: 'M9 5l7 7-7 7',
  chevL: 'M15 5l-7 7 7 7',
  chevD: 'M5 9l7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  chevU: 'M5 15l7-7 7 7',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  pie: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10 3 8 4s0 3 4 3zM12 7s2-4 4-3-0 3-4 3z',
  award: 'M12 3a6 6 0 1 0 0 12a6 6 0 0 0 0-12zM8.5 14.5L7 21l5-3 5 3-1.5-6.5',
  ban: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  card: 'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM3 10h18',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  bank2: 'M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18',
  steer: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM12 14v7M3.5 10.5L10 12M20.5 10.5L14 12',
};
export type IconName = keyof typeof P;
export const Icon = ({ name, size = 17 }: { name: IconName; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}><path d={P[name]} /></svg>
);

// ---------------------------------------------------------------- data loading
/** Loads from the API now and again every `everyMs` (0 = once). Keeps the last good answer if a refresh fails. */
// How many requests are in flight, so a search box can say "Searching..." without every page wiring it up.
let inFlight = 0;
const watchers = new Set<() => void>();
const track = (delta: number) => { inFlight += delta; watchers.forEach((w) => w()); };
export function useAnyLoading(): boolean {
  const [, bump] = useState(0);
  useEffect(() => { const w = () => bump((n) => n + 1); watchers.add(w); return () => { watchers.delete(w); }; }, []);
  return inFlight > 0;
}

/**
 * Loads a page of data. When only the query string changes (a search, a filter, the next page) the rows already on screen
 * stay until the new ones arrive, so the page does not flash to a loading skeleton and a search box keeps what was typed.
 * Moving to a different resource does clear it.
 */
export function useLoad<T>(path: string, everyMs = 0): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const base = useRef(path.split('?')[0]);
  useEffect(() => {
    let live = true;
    const same = base.current === path.split('?')[0];
    base.current = path.split('?')[0];
    const run = (first: boolean) => {
      if (first) { setLoading(true); track(1); }
      return get<T>(path)
        .then((d) => { if (live) { setData(d); setError(null); } })
        .catch((e: ApiError) => { if (live) setError(e.message); })
        .finally(() => { if (first) { track(-1); if (live) setLoading(false); } });
    };
    if (!same) setData(null);
    run(true);
    const t = everyMs ? setInterval(() => run(false), everyMs) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [path, everyMs, tick]);
  return { data, error, reload: () => setTick((n) => n + 1), loading };
}

export function Loading({ error, retry }: { error?: string | null; retry?: () => void }) {
  if (!error) return <div className="grid" aria-busy="true" aria-label="Loading"><Skeleton h={90} /><div className="grid g2"><Skeleton h={230} /><Skeleton h={230} /></div></div>;
  return <div className="empty"><p className="error">{error}</p>{retry && <button className="btn ghost" style={{ marginTop: 12 }} onClick={retry}>Try again</button>}</div>;
}

// ---------------------------------------------------------------- pieces
export type Tone = 'green' | 'red' | 'blue' | 'amber';
export function Stat({ icon, label, value, note, tone }: { icon: IconName; label: string; value: ReactNode; note?: string; tone?: Tone }) {
  return (
    <div className="stat">
      <div className={'tile' + (tone ? ' ' + tone : '')}><Icon name={icon} size={18} /></div>
      <div><div className="label">{label}</div><div className={'big' + (tone ? ' ' + tone : '')}>{value}</div>{note && <div className="note">{note}</div>}</div>
    </div>
  );
}

export function Skeleton({ h = 120, count = 1 }: { h?: number; count?: number }) {
  return <>{Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}</>;
}

export function Pill({ children, tone = 'grey' }: { children: ReactNode; tone?: Tone | 'grey' }) {
  return <span className={'pill ' + tone}>{children}</span>;
}

export function Bars({ items, format, color = 'var(--gold)' }: { items: { label: string; value: number }[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const [hot, setHot] = useState<number | null>(null);
  return (
    <div className="bars" onMouseLeave={() => setHot(null)}>
      {items.map((i, n) => (
        <div className="bar" key={i.label} onMouseEnter={() => setHot(n)}>
          {hot === n && <em>{format ? format(i.value) : i.value}</em>}
          <i style={{ height: `${(i.value / max) * 100}%`, background: color, opacity: hot === null || hot === n ? 1 : 0.55 }} /><span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The design's trend chart: one green line with a soft area under it, four grid lines and a month letter under each point.
 * Hover shows the value for that month.
 */
export function LineChart({ labels, values, color = 'var(--accent)', format, letters = true }: { labels: string[]; values: number[]; color?: string; format?: (n: number) => string; letters?: boolean }) {
  const W = 520, H = 150, L = 8, R = 512, TOP = 16, BASE = 132;
  const max = Math.max(1, ...values);
  const x = (i: number) => L + (i * (R - L)) / Math.max(1, values.length - 1);
  const y = (v: number) => BASE - (v / max) * (BASE - TOP);
  const [hot, setHot] = useState<number | null>(null);
  const fmt = format ?? ((n: number) => String(n));
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <div className="chart" onMouseLeave={() => setHot(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Trend chart">
        {[132, 93, 55, 16].map((gy) => <line key={gy} x1={L} x2={R} y1={gy} y2={gy} className="grid-line" />)}
        <path d={`${line} L${R} ${BASE} L${L} ${BASE} Z`} fill={color} opacity="0.12" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hot !== null && <circle cx={x(hot)} cy={y(values[hot])} r="3.5" fill={color} stroke="var(--panel)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
        {labels.map((l, i) => (letters || i % Math.ceil(labels.length / 7) === 0) && <text key={i} x={x(i)} y="147" fontSize="9" fill="var(--muted)" textAnchor="middle">{letters ? l.slice(0, 1) : l}</text>)}
        {labels.map((_, i) => <rect key={i} x={x(i) - (R - L) / (labels.length - 1) / 2} y={0} width={(R - L) / (labels.length - 1)} height={H} fill="transparent" onMouseEnter={() => setHot(i)} />)}
      </svg>
      {hot !== null && <div className="tip" style={{ left: `${(x(hot) / W) * 100}%` }}><b>{labels[hot]}</b> {fmt(values[hot])}</div>}
    </div>
  );
}

export function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const R = 46, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg width="132" height="132" viewBox="0 0 120 120" role="img" aria-label="Breakdown">
      <circle cx="60" cy="60" r={R} fill="none" stroke="var(--raised)" strokeWidth="16" />
      {parts.map((p) => {
        const len = (p.value / total) * C;
        const el = <circle key={p.label} cx="60" cy="60" r={R} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
        offset += len;
        return el;
      })}
    </svg>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <div className="scrim" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>{children}</div></div>;
}

export interface MapDot { lat: number; lng: number; color: string; label?: string }

/** OpenStreetMap tiles (free, light use only: swap the tile URL for a paid provider before heavy use). */
export function LeafletMap({ dots, height = 340 }: { dots: MapDot[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true }).setView([7.3775, 3.947], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    dots.forEach((d) => {
      const m = L.circleMarker([d.lat, d.lng], { radius: 8, color: '#fff', weight: 2, fillColor: d.color, fillOpacity: 1 }).addTo(layer.current!);
      if (d.label) m.bindTooltip(d.label);
    });
    if (dots.length && !fitted.current) {
      map.current.fitBounds(L.latLngBounds(dots.map((d) => [d.lat, d.lng] as [number, number])).pad(0.3), { maxZoom: 15 });
      fitted.current = true;
    }
  }, [dots]);
  return <div className="map" ref={el} style={{ height }} />;
}

/** A private picture from the server, with a grey box while it loads and a plain one if it cannot be shown. */
export function AuthImage({ fileId, alt, size = 64 }: { fileId?: string | null; alt: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let live = true; let made: string | null = null;
    setUrl(null); setBad(false);
    if (fileId) blobUrl(`/files/${fileId}`).then((u) => { made = u; if (live) setUrl(u); else URL.revokeObjectURL(u); }).catch(() => live && setBad(true));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [fileId]);
  const box = { width: size, height: size, borderRadius: 10, background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11, overflow: 'hidden', flex: 'none' } as const;
  if (!fileId) return <div style={box} aria-label={alt}><Icon name="car" size={Math.round(size / 3)} /></div>;
  if (bad) return <div style={box} aria-label={alt}>No picture</div>;
  return url ? <img src={url} alt={alt} style={{ ...box, objectFit: 'cover' }} /> : <div style={box} aria-busy="true" aria-label={alt} />;
}
