import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pager, SearchBox, Segmented } from '../bits';
import { RatingsTab } from './Insights';
import { arrangementLabel, dateTime, formatPlate, initials, Loading, Pill, Stat, title, useLoad } from '../ui';

interface DriverList {
  counts: { total: number; active: number; suspended: number; pendingApplications: number };
  total: number; page: number; pageSize: number;
  items: { id: string; name: string; phone: string; status: string; joinedAt: string; trips: number; rating: number | null; arrangement: string | null; vehicle: { plate: string; make: string; colour: string; category: string } | null }[];
}
interface Application { id: string; driverId: string; driverName: string; phone: string; status: string; arrangement: string; vehicle: { category: string; make: string | null; colour: string | null; plate: string | null }; submittedAt: string; reviewNote: string | null }

const STATUS = [['', 'All'], ['active', 'Active'], ['suspended', 'Suspended']] as const;
const APP_STATUS = [['SUBMITTED', 'Waiting for review'], ['CHANGES_REQUESTED', 'Changes requested'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']] as const;

function Overview() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(search ? { search } : {}), ...(status ? { status } : {}) });
  const { data: d, error, reload } = useLoad<DriverList>(`/admin/console/drivers?${qs}`);
  if (!d) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="stats">
        <Stat icon="user" label="Total drivers" value={d.counts.total} />
        <Stat icon="check" label="Active" value={d.counts.active} />
        <Stat icon="x" label="Suspended" value={d.counts.suspended} tone={d.counts.suspended ? 'red' : undefined} />
        <Stat icon="clock" label="Awaiting review" value={d.counts.pendingApplications} tone={d.counts.pendingApplications ? 'amber' : undefined} />
      </div>
      <div style={{ display: 'flex', gap: 12, margin: '14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchBox placeholder="Search name, phone or plate" onSearch={(s) => { setSearch(s); setPage(1); }} />
        <Segmented options={STATUS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        {d.items.length === 0 ? <div className="empty">No drivers match.</div> : (
          <table><thead><tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th>Arrangement</th><th className="num">Trips</th><th className="num">Rating</th><th>Joined</th><th>Status</th></tr></thead><tbody>
            {d.items.map((r) => (
              <tr key={r.id} className="link" onClick={() => nav(`/people/${r.id}`)}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(r.name)}</div>{r.name}</div></td>
                <td>{r.phone}</td>
                <td>{r.vehicle ? <>{formatPlate(r.vehicle.plate)}<div className="note">{r.vehicle.colour} {r.vehicle.make} · {title(r.vehicle.category)}</div></> : <span className="note">No vehicle</span>}</td>
                <td>{arrangementLabel(r.arrangement)}</td>
                <td className="num">{r.trips}</td><td className="num">{r.rating ?? '-'}</td><td>{dateTime(r.joinedAt)}</td>
                <td>{r.status === 'suspended' ? <span className="chip red">Suspended</span> : <span className="chip">Active</span>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
        <Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
      </div>
    </>
  );
}

function Onboarding() {
  const nav = useNavigate();
  const [status, setStatus] = useState<string>('SUBMITTED');
  const { data, error, reload } = useLoad<Application[]>(`/admin/driver-applications?status=${status}`);
  return (
    <>
      <div style={{ margin: '0 0 14px' }}><Segmented options={APP_STATUS} value={status as 'SUBMITTED'} onChange={setStatus} /></div>
      {!data ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {data.length === 0 ? <div className="empty">No applications here.</div> : (
            <table><thead><tr><th>Applicant</th><th>Phone</th><th>Vehicle</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
              {data.map((a) => (
                <tr key={a.id} className="link" onClick={() => nav(`/onboarding/${a.id}`)}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(a.driverName)}</div>{a.driverName}</div></td>
                  <td>{a.phone}</td><td>{formatPlate(a.vehicle.plate)}<div className="note">{a.vehicle.colour} {a.vehicle.make} · {title(a.vehicle.category)}</div></td>
                  <td>{dateTime(a.submittedAt)}</td>
                  <td><Pill tone={a.status === 'APPROVED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'amber'}>{title(a.status)}</Pill></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}
    </>
  );
}

export default function Drivers() {
  const [tab, setTab] = useState<'overview' | 'onboarding' | 'ratings'>('overview');
  return (
    <>
      <div className="head"><div><h1>Drivers</h1><div className="sub">Manage all driver accounts and onboarding</div></div></div>
      <div className="pilltabs">
        <button className={'pilltab' + (tab === 'overview' ? ' on' : '')} onClick={() => setTab('overview')}>Overview</button>
        <button className={'pilltab' + (tab === 'onboarding' ? ' on' : '')} onClick={() => setTab('onboarding')}>Onboarding</button>
        <button className={'pilltab' + (tab === 'ratings' ? ' on' : '')} onClick={() => setTab('ratings')}>Ratings</button>
      </div>
      {tab === 'overview' ? <Overview /> : tab === 'onboarding' ? <Onboarding /> : <RatingsTab />}
    </>
  );
}
