import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api';
import { Segmented, SearchBox, Toast, go, useConfirm } from '../bits';
import { Loading, Pill, Stat, dateTime, initials, title, useLoad } from '../ui';

interface Queue {
  counts: { open: number; inProgress: number; resolved: number; medianResolveSeconds: number | null };
  items: { id: string; code: string; topic: string; message: string; status: string; role: string; person: string; assignee: string | null; createdAt: string }[];
}
interface Detail {
  id: string; code: string; topic: string; message: string; status: string; resolution: string | null; role: string; createdAt: string; resolvedAt: string | null;
  person: { id: string; name: string; phone: string }; assignee: string | null; ride: { id: string; code: string } | null; notes: { body: string; at: string; by: string | null }[];
}

const TONE = { OPEN: 'red', IN_PROGRESS: 'amber', RESOLVED: 'green' } as const;
const NAME = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved' } as const;
const hours = (s: number | null) => (s == null ? '-' : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export function SupportQueue() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, reload } = useLoad<Queue>(`/admin/support?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`, 20_000);
  return (
    <>
      <div className="head"><div><h1>Support</h1><div className="sub">Problems reported from the rider and driver apps</div></div></div>
      {!data ? <Loading error={error} retry={reload} /> : (
        <>
          <div className="stats">
            <Stat icon="warn" label="Open" value={data.counts.open} tone={data.counts.open ? 'red' : undefined} />
            <Stat icon="clock" label="In progress" value={data.counts.inProgress} tone="amber" />
            <Stat icon="check" label="Resolved" value={data.counts.resolved} />
            <Stat icon="clock" label="Median time to resolve" value={hours(data.counts.medianResolveSeconds)} note="last 30 days" />
          </div>
          <div style={{ display: 'flex', gap: 12, margin: '14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchBox placeholder="Search ticket, person or words" onSearch={setSearch} />
            <Segmented options={[['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved']] as const} value={status as ''} onChange={setStatus} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            {data.items.length === 0 ? <div className="empty">No tickets{status || search ? ' match' : ' yet'}.</div> : (
              <table><thead><tr><th>Ticket</th><th>Person</th><th>Topic</th><th>Problem</th><th>Raised</th><th>Handled by</th><th>Status</th></tr></thead><tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="link" onClick={() => nav(`/support/${t.id}`)}>
                    <td><b>{t.code}</b></td><td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(t.person)}</div><div>{t.person}<div className="note">{title(t.role)}</div></div></div></td>
                    <td>{title(t.topic)}</td><td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.message}</td><td>{dateTime(t.createdAt)}</td><td>{t.assignee ?? '-'}</td>
                    <td><Pill tone={TONE[t.status as keyof typeof TONE]}>{NAME[t.status as keyof typeof NAME]}</Pill></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
        </>
      )}
    </>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const { data: t, error, reload } = useLoad<Detail>(`/admin/support/${id}`);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!t) return <Loading error={error} retry={reload} />;
  const done = (m: string) => () => { setToast(m); reload(); };
  return (
    <>
      <div className="head">
        <div><Link to="/support" className="note">← Support</Link><h1>Ticket {t.code}</h1><div className="sub">{title(t.topic)} · raised {dateTime(t.createdAt)} by {t.person.name} ({title(t.role)})</div></div>
        <div className="grow" /><Pill tone={TONE[t.status as keyof typeof TONE]}>{NAME[t.status as keyof typeof NAME]}</Pill>
        {t.status === 'OPEN' && <button className="btn" onClick={() => confirm.ask({ title: 'Take this ticket?', text: 'It shows as in progress and yours. Nobody else can take it.', confirm: 'Yes, take it' }, () => go(() => post(`/admin/support/${t.id}/take`), done('Ticket taken')))}>Take ticket</button>}
        {t.status === 'RESOLVED' && <button className="btn ghost" onClick={() => confirm.ask({ title: 'Reopen this ticket?', text: 'It goes back to open and the person no longer sees it as resolved.', confirm: 'Yes, reopen' }, () => go(() => post(`/admin/support/${t.id}/status`, { status: 'OPEN' }), done('Reopened')))}>Reopen</button>}
      </div>
      <div className="grid g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>What they said</h3><p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{t.message}</p></div>
          <div className="card"><h3>Internal notes</h3>
            <div className="timeline" style={{ marginTop: 6 }}>
              {t.notes.length === 0 && <div className="note">No notes yet.</div>}
              {t.notes.map((n, i) => <div className="tl" key={i} style={{ gridTemplateColumns: '100px 1fr auto' }}><span className="note">{dateTime(n.at)}</span><span>{n.body}</span><span className="note">{n.by ?? 'Staff'}</span></div>)}
            </div>
            {t.status !== 'RESOLVED' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input className="input" aria-label="Add a note" placeholder="Add a note for your team" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn" disabled={!note.trim()} onClick={() => confirm.ask({ title: 'Add this note?', text: 'Notes are permanent and visible to staff only.', confirm: 'Yes, add' }, () => go(() => post(`/admin/support/${t.id}/notes`, { body: note.trim() }), () => { setNote(''); done('Note added')(); }))}>Add</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>Person</h3>
            <div className="line"><span className="note">Name</span><Link to={`/people/${t.person.id}`} style={{ color: 'var(--accent)' }}>{t.person.name}</Link></div>
            <div className="line"><span className="note">Phone</span><a href={`tel:${t.person.phone}`} style={{ color: 'var(--accent)' }}>{t.person.phone}</a></div>
            {t.ride && <div className="line"><span className="note">Trip</span><Link to={`/trips/${t.ride.id}`} style={{ color: 'var(--accent)' }}>{t.ride.code}</Link></div>}
            <div className="line"><span className="note">Handled by</span><span>{t.assignee ?? 'Nobody yet'}</span></div></div>
          {t.status === 'RESOLVED' ? (
            <div className="card"><h3>Resolution</h3><p style={{ marginTop: 8 }}>{t.resolution}</p><div className="note" style={{ marginTop: 6 }}>Resolved {dateTime(t.resolvedAt)}. The person sees this in their app.</div></div>
          ) : (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3>Resolve</h3>
              <div className="field"><label htmlFor="res">What was done (the person sees this)</label><textarea id="res" className="input" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} /></div>
              <button className="btn" disabled={resolution.trim().length < 3} onClick={() => confirm.ask({ title: 'Mark as resolved?', text: 'The person sees your message in their app.', confirm: 'Yes, resolve' }, () => go(() => post(`/admin/support/${t.id}/status`, { status: 'RESOLVED', resolution: resolution.trim() }), done('Resolved')))}>Mark resolved</button>
            </div>
          )}
        </div>
      </div>
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}
