import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post } from '../api';
import { go, useConfirm } from '../bits';
import { LiveMap, Loading, initials, timeOnly, title, useLoad } from '../ui';
import { sosChip } from './Safety';

interface Sos {
  id: string; status: string; role: string; createdAt: string; acknowledgedAt: string | null; resolvedAt: string | null;
  location: { lat: number; lng: number } | null;
  raisedBy: { name: string; phone: string };
  trip: { code: string; category: string; rideId: string; plate: string | null } | null;
  people: { id: string; name: string; phone: string; role: string }[];
  timeline: { kind: string; detail: Record<string, unknown>; at: string; by: string | null }[];
}

const OUTCOMES = ['Everyone is safe', 'False alarm', 'Police or emergency services called', 'Trip ended early', 'Could not reach anyone'];
const EVENT: Record<string, string> = {
  created: 'SOS pressed in app', location: 'Location updated', acknowledged: 'Acknowledged', assigned: 'Assigned', escalated: 'On-call phone alerted', sms_sent: 'Text message sent', callback: 'Call logged', note: 'Note', resolved: 'Resolved',
};

export default function SosDetail() {
  const { id } = useParams();
  const { data: s, error, reload } = useLoad<Sos>(`/admin/console/sos/${id}`, 10_000);
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const confirm = useConfirm();
  if (!s) return <Loading error={error} retry={reload} />;

  const resolved = s.status === 'RESOLVED';

  return (
    <>
      <div className="head">
        <div><Link to="/safety" className="note">← Safety Center</Link><h1>SOS {s.id.slice(0, 8)}</h1>
          <div className="sub">{s.role === 'driver' ? 'Driver' : 'Rider'} SOS{s.trip ? ` from trip ${s.trip.code}` : ''}</div></div>
        <div className="grow" />
        {sosChip(s.status)}
        {s.status === 'OPEN' && <button className="btn" onClick={() => confirm.ask({ title: 'Acknowledge this alert?', text: 'It shows that you are handling it. The time to acknowledge is measured.', confirm: 'Yes, acknowledge' }, () => go(() => post(`/admin/sos/${s.id}/acknowledge`), reload))}>Acknowledge</button>}
      </div>
      <div className="grid g21">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <h3>Evidence</h3>
            <div className="timeline" style={{ marginTop: 8 }}>
              {s.timeline.map((t, i) => (
                <div className="tl" key={i}><span className="note">{timeOnly(t.at)}</span>
                  <span>{EVENT[t.kind] ?? title(t.kind)}{typeof t.detail?.text === 'string' ? `: ${t.detail.text}` : ''}{typeof t.detail?.outcome === 'string' ? `: ${t.detail.outcome}` : ''}</span>
                  <span className="note">{t.by ?? 'System'}</span></div>
              ))}
            </div>
          </div>
          {s.location && <div className="card"><h3>Location</h3><div className="hint" style={{ marginBottom: 10 }}>Last known position of the person who raised the alert.</div>
            <LiveMap dots={[{ lat: s.location.lat, lng: s.location.lng, color: '#e5484d', label: s.raisedBy.name }]} height={260} /></div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <h3>People and trip</h3>
            {[{ name: s.raisedBy.name, phone: s.raisedBy.phone, role: s.role }, ...s.people.filter((p) => p.name !== s.raisedBy.name || p.phone !== s.raisedBy.phone)].map((p) => (
              <div key={p.phone} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <div className="avatar">{initials(p.name)}</div>
                <div className="grow">{p.name}<div className="note">{title(p.role)} · {p.phone}</div></div>
                <a className="btn ghost" style={{ height: 30 }} href={`tel:${p.phone}`}>Call</a>
              </div>
            ))}
            {s.trip && <div className="note" style={{ marginTop: 14 }}>Trip <Link to={`/trips/${s.trip.rideId}`} style={{ color: 'var(--accent)' }}>{s.trip.code}</Link> · {title(s.trip.category)}{s.trip.plate ? ` · ${s.trip.plate}` : ''}</div>}
          </div>
          {!resolved && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3>Resolve</h3>
              <div className="field"><label htmlFor="o">Outcome</label>
                <select id="o" className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Select outcome</option>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></div>
              <div className="field"><label htmlFor="n">Notes</label><textarea id="n" className="input" placeholder="What happened and what was done" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <button className="btn" disabled={!outcome} onClick={() => confirm.ask({ title: 'Mark this alert resolved?', text: `Outcome: ${outcome}. Resolved alerts leave the open list.`, confirm: 'Yes, mark resolved' }, () => go(async () => {
                if (notes.trim()) await post(`/admin/sos/${s.id}/notes`, { kind: 'note', detail: { text: notes.trim() } });
                await post(`/admin/sos/${s.id}/resolve`, { outcome });
                setNotes('');
              }, reload))}>Mark resolved</button>
            </div>
          )}
        </div>
      </div>
      {confirm.node}
    </>
  );
}
