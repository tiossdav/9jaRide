import { useState } from 'react';
import { download } from '../api';
import { Pager, SearchBox, useAction } from '../bits';
import { Loading, dateTime, initials, useLoad } from '../ui';

interface Log { total: number; page: number; pageSize: number; items: { id: number; method: string; path: string; status: number | null; ip: string | null; at: string; staff: string | null; email: string | null; role: string | null }[] }

/** Turns "/admin/users/<id>/suspend" into words a person would say. */
function describe(method: string, path: string): string {
  const p = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\?.*$/, '');
  const known: [RegExp, string][] = [
    [/\/users\/:id\/suspend$/, 'Suspended an account'], [/\/users\/:id\/reinstate$/, 'Reinstated an account'],
    [/driver-applications\/:id\/approve$/, 'Approved a driver'], [/driver-applications\/:id\/reject$/, 'Rejected a driver application'], [/driver-applications\/:id\/request-changes$/, 'Asked a driver for changes'],
    [/payouts\/:id\/approve$/, 'Approved a payout'], [/payouts\/:id\/reject$/, 'Rejected a payout'],
    [/adjustments$/, 'Requested an adjustment'], [/adjustments\/:id\/approve$/, 'Approved an adjustment'], [/adjustments\/:id\/reject$/, 'Rejected an adjustment'],
    [/payment-exceptions\/resolve$/, 'Resolved a payment exception'], [/reconciliation\/run$/, 'Ran reconciliation'],
    [/sos\/:id\/acknowledge$/, 'Acknowledged an SOS'], [/sos\/:id\/resolve$/, 'Resolved an SOS'], [/sos\/:id\/notes$/, 'Added an SOS note'], [/sos\/:id\/assign$/, 'Assigned an SOS'],
    [/app-config$/, 'Changed app settings'], [/trip-checks\/:id\/review$/, 'Reviewed a trip check'],
  ];
  return known.find(([re]) => re.test(p))?.[1] ?? `${method} ${p}`;
}

export default function Activity() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const exp = useAction();
  const { data: d, error, reload } = useLoad<Log>(`/admin/console/activity?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  return (
    <>
      <div className="head"><div><h1>Activity Logs</h1><div className="sub">Everything staff change, newest first. This record cannot be edited or deleted.</div></div><div className="grow" /><button className="btn ghost" disabled={exp.busy} onClick={() => exp.run(() => download('/admin/console/activity.csv', 'activity.csv'))}>{exp.busy ? 'Preparing…' : 'Export CSV'}</button></div>
      {exp.error && <div className="banner error" role="alert">{exp.error}</div>}
      <div style={{ marginBottom: 14 }}><SearchBox placeholder="Search by person or action" onSearch={(s) => { setSearch(s); setPage(1); }} /></div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {d.items.length === 0 ? <div className="empty">No activity yet.</div> : (
            <table><thead><tr><th>When</th><th>Staff</th><th>Action</th><th>Result</th><th>From</th></tr></thead><tbody>
              {d.items.map((l) => (
                <tr key={l.id}>
                  <td>{dateTime(l.at)}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(l.staff)}</div><div>{l.staff ?? 'Unknown'}<div className="note">{l.email}</div></div></div></td>
                  <td>{describe(l.method, l.path)}<div className="note" style={{ fontFamily: 'ui-monospace, monospace' }}>{l.method} {l.path.replace(/\?.*$/, '')}</div></td>
                  <td>{l.status != null && l.status < 400 ? <span className="chip">Done</span> : <span className="chip red">Refused {l.status ?? ''}</span>}</td>
                  <td className="note">{l.ip ?? '-'}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          <Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}
