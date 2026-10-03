import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loading, Stat, dateTime, initials, useLoad } from '../ui';

interface Safety {
  openAlerts: number;
  unacknowledged: number;
  medianAckSeconds: number | null;
  items: { id: string; status: string; role: string; person: string; trip: string | null; at: string; acknowledgedBy: string | null; escalated: boolean }[];
}

const FILTERS = [['', 'All'], ['open', 'Open'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved']] as const;

export function sosChip(status: string) {
  return status === 'OPEN' ? <span className="chip red">Open</span> : status === 'ACKNOWLEDGED' ? <span className="chip amber">Acknowledged</span> : <span className="chip">Resolved</span>;
}

export default function SafetyCenter() {
  const [filter, setFilter] = useState('');
  const { data: d, error, reload } = useLoad<Safety>(`/admin/console/safety${filter ? `?status=${filter}` : ''}`, 10_000);
  const nav = useNavigate();
  if (!d) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="head"><div><h1>Safety Center</h1><div className="sub">SOS alerts. Open items first.</div></div></div>
      <div className="stats">
        <Stat icon="shield" label="Open alerts" value={d.openAlerts} tone={d.openAlerts ? 'red' : undefined} />
        <Stat icon="warn" label="Unacknowledged" value={d.unacknowledged} note="target: under 60 s" tone={d.unacknowledged ? 'amber' : undefined} />
        <Stat icon="clock" label="Median time to acknowledge" value={d.medianAckSeconds == null ? '-' : `${d.medianAckSeconds} s`} note="last 30 days" />
      </div>
      <div className="seg" style={{ marginTop: 14 }}>{FILTERS.map(([k, label]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>)}</div>
      <div className="card" style={{ padding: 0 }}>
        {d.items.length === 0 ? <div className="empty">No alerts{filter ? ' with this status' : ''}.</div> : (
          <table><thead><tr><th>Alert</th><th>Person</th><th>Trip</th><th>When</th><th>Detail</th><th>Status</th></tr></thead><tbody>
            {d.items.map((s) => (
              <tr key={s.id} className="link" onClick={() => nav(`/safety/${s.id}`)}>
                <td><span className="chip red">SOS</span> <span className="note">{s.id.slice(0, 8)}</span></td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(s.person)}</div><div>{s.person}<div className="note">{s.role === 'driver' ? 'Driver' : 'Rider'}</div></div></div></td>
                <td>{s.trip ? <Link to={`/safety/${s.id}`}>{s.trip}</Link> : '-'}</td>
                <td>{dateTime(s.at)}</td>
                <td>{s.acknowledgedBy ? `Acknowledged by ${s.acknowledgedBy}` : s.escalated ? 'On-call phoned' : '-'}</td>
                <td>{sosChip(s.status)}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
