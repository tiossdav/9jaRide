import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { download } from '../api';
import { useAction } from '../bits';
import { Bars, Donut, Loading, Pill, Stat, dateTime, initials, naira, paymentChip, statusChip, title, useLoad } from '../ui';

interface Overview {
  total: number; completed: number; cancelled: number; inProgress: number; scheduledAhead: number;
  regularVsScheduled: { regular: number; scheduled: number };
  revenueLast7Days: { day: string; kobo: number }[];
}
interface List {
  total: number; page: number; pageSize: number;
  items: { id: string; code: string; status: string; paymentStatus: string; method: string; category: string; at: string; scheduled: boolean; rider: string; driver: string | null; totalKobo: number | null }[];
}

const STATUSES = [['', 'All'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['active', 'In progress'], ['scheduled', 'Scheduled']] as const;

function OverviewTab() {
  const { data: d, error, reload } = useLoad<Overview>('/admin/console/trips/overview', 30_000);
  if (!d) return <Loading error={error} retry={reload} />;
  const total7 = d.revenueLast7Days.reduce((s, r) => s + r.kobo, 0);
  return (
    <>
      <div className="stats">
        <Stat icon="pin" label="Total trips" value={d.total} />
        <Stat icon="check" label="Completed" value={d.completed} />
        <Stat icon="x" label="Cancelled" value={d.cancelled} tone="red" />
        <Stat icon="clock" label="In progress" value={d.inProgress} tone="blue" />
      </div>
      <div className="grid g21" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="cardhead"><div><h3>Revenue by day</h3><div className="total gold" style={{ fontSize: 14, margin: '2px 0 0' }}>{naira(total7)} total</div></div><Pill>Last 7 days</Pill></div>
          <Bars items={d.revenueLast7Days.map((r) => ({ label: new Date(r.day + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: r.kobo }))} format={(n) => naira(n)} />
        </div>
        <div className="card"><h3>Trip type breakdown</h3><div className="hint">Regular vs scheduled</div>
          <div className="donut">
            <Donut parts={[{ label: 'Regular', value: d.regularVsScheduled.regular, color: 'var(--accent)' }, { label: 'Scheduled', value: d.regularVsScheduled.scheduled, color: 'var(--gold)' }]} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Pill tone="green">Regular {d.regularVsScheduled.regular}</Pill><Pill tone="amber">Scheduled {d.regularVsScheduled.scheduled}</Pill></div>
          </div>
          <div className="note" style={{ marginTop: 10 }}>{d.scheduledAhead} scheduled ride{d.scheduledAhead === 1 ? '' : 's'} still to come.</div></div>
      </div>
    </>
  );
}

function LogsTab() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const exp = useAction();
  useEffect(() => { const t = setTimeout(() => { setSearch(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);
  const qs = new URLSearchParams({ page: String(page), pageSize: '20', ...(search ? { search } : {}), ...(status ? { status } : {}) });
  const { data: d, error, reload } = useLoad<List>(`/admin/console/trips?${qs}`);
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search trip code, rider or driver" aria-label="Search trips" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn ghost" disabled={exp.busy} onClick={() => exp.run(() => download(`/admin/console/trips.csv${status ? `?status=${status}` : ''}`, 'trips.csv'))}>{exp.busy ? 'Preparing…' : 'Export CSV'}</button>
        {exp.error && <span className="error">{exp.error}</span>}
        <div className="seg" style={{ margin: 0 }}>{STATUSES.map(([k, label]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setPage(1); }}>{label}</button>)}</div>
      </div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {d.items.length === 0 ? <div className="empty">No trips match.</div> : (
            <table><thead><tr><th>Date</th><th>Trip code</th><th>Rider</th><th>Driver</th><th>Type</th><th>Payment</th><th>Method</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody>
              {d.items.map((t) => (
                <tr key={t.id} className="link" onClick={() => nav(`/trips/${t.id}`)}>
                  <td>{dateTime(t.at)}</td><td>{t.code}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(t.rider)}</div>{t.rider}</div></td>
                  <td>{t.driver ?? '-'}</td><td>{t.scheduled ? 'Scheduled' : title(t.category)}</td><td>{paymentChip(t.paymentStatus)}</td><td>{title(t.method)}</td><td>{statusChip(t.status)}</td>
                  <td className="num">{naira(t.totalKobo ?? 0)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
            <span className="note grow">Showing {d.total === 0 ? 0 : (page - 1) * d.pageSize + 1} to {Math.min(page * d.pageSize, d.total)} of {d.total} results</span>
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Trips() {
  const [tab, setTab] = useState<'overview' | 'logs'>('overview');
  return (
    <>
      <div className="head"><div><h1>All Trips</h1><div className="sub">Monitor all ride activity across the platform</div></div></div>
      <div className="pilltabs"><button className={'pilltab' + (tab === 'overview' ? ' on' : '')} onClick={() => setTab('overview')}>Overview</button><button className={'pilltab' + (tab === 'logs' ? ' on' : '')} onClick={() => setTab('logs')}>Logs</button></div>
      {tab === 'overview' ? <OverviewTab /> : <LogsTab />}
    </>
  );
}
