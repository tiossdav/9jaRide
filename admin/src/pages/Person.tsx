import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api';
import { AdjustModal } from '../adjust';
import { AddVehicleModal } from './VehicleDetail';
import { ReasonModal, Toast } from '../bits';
import { Loading, Stat, dateTime, initials, naira, statusChip, title, useLoad } from '../ui';

interface Person {
  id: string; name: string; phone: string; role: 'rider' | 'driver'; status: 'active' | 'suspended'; joinedAt: string;
  completedTrips: number; cancelledTrips: number; totalKobo: number; rating: number | null; ratings: number; walletKobo: number;
  vehicles: { id: string; category: string; make: string; colour: string; plate: string; active: boolean }[];
  application: { id: string; status: string } | null;
  recentTrips: { id: string; code: string; status: string; at: string; totalKobo: number | null }[];
  statusHistory: { status: string; reason: string; at: string; by: string | null }[];
}

/** One page for both a driver and a customer; the driver gets vehicles and rating on top. */
export default function PersonPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: p, error, reload } = useLoad<Person>(`/admin/console/people/${id}`);
  const [ask, setAsk] = useState<'suspend' | 'reinstate' | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  if (!p) return <Loading error={error} retry={reload} />;
  const driver = p.role === 'driver';
  const back = driver ? '/drivers' : '/customers';

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="avatar" style={{ width: 56, height: 56, fontSize: 18 }}>{initials(p.name)}</div>
          <div><Link to={back} className="note">← {driver ? 'Drivers' : 'Customers'}</Link><h1>{p.name}</h1>
            <div className="sub">{p.phone} · joined {dateTime(p.joinedAt)}</div></div>
        </div>
        <div className="grow" />
        {p.status === 'suspended' ? <span className="chip red">Suspended</span> : <span className="chip">Active</span>}
        <button className="btn ghost" onClick={() => setAdjust(true)}>Adjust wallet</button>
        {p.status === 'active'
          ? <button className="btn outline-red" onClick={() => setAsk('suspend')}>Suspend account</button>
          : <button className="btn" onClick={() => setAsk('reinstate')}>Reinstate account</button>}
      </div>

      <div className="stats">
        <Stat icon="check" label="Completed trips" value={p.completedTrips} />
        <Stat icon="x" label="Cancelled" value={p.cancelledTrips} tone={p.cancelledTrips ? 'red' : undefined} />
        <Stat icon="wallet" label={driver ? 'Earned in fares' : 'Spent'} value={naira(p.totalKobo)} />
        {driver ? <Stat icon="activity" label="Rating" value={p.rating ?? '-'} note={`${p.ratings} rating${p.ratings === 1 ? '' : 's'}`} /> : <Stat icon="wallet" label="Wallet balance" value={naira(p.walletKobo)} />}
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {driver && (
            <div className="card"><div className="cardhead"><div><h3>Vehicles</h3></div><button className="btn ghost" style={{ height: 30 }} onClick={() => setAddingVehicle(true)}>Add vehicle</button></div>
              {p.vehicles.length === 0 ? <div className="note" style={{ marginTop: 8 }}>No vehicle on file{p.application ? <>. Application: <Link to={`/onboarding/${p.application.id}`} style={{ color: 'var(--accent)' }}>{title(p.application.status)}</Link></> : ''}.</div> :
                p.vehicles.map((v) => <div className="line" key={v.id}><span><Link to={`/vehicles/${v.id}`} style={{ color: 'var(--accent)' }}>{v.plate}</Link> <span className="note">{v.colour} {v.make} · {title(v.category)}</span></span>{v.active ? <span className="chip">In use</span> : <span className="chip grey">Retired</span>}</div>)}
              {p.application && p.vehicles.length > 0 && <div className="note" style={{ marginTop: 8 }}>Onboarding: <Link to={`/onboarding/${p.application.id}`} style={{ color: 'var(--accent)' }}>{title(p.application.status)}</Link></div>}
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '16px 18px 4px' }}><h3>Recent trips</h3></div>
            {p.recentTrips.length === 0 ? <div className="empty">No trips yet.</div> : (
              <table><thead><tr><th>Trip</th><th>When</th><th>Status</th><th className="num">Fare</th></tr></thead><tbody>
                {p.recentTrips.map((t) => <tr key={t.id} className="link" onClick={() => nav(`/trips/${t.id}`)}><td>{t.code}</td><td>{dateTime(t.at)}</td><td>{statusChip(t.status)}</td><td className="num">{t.totalKobo == null ? '-' : naira(t.totalKobo)}</td></tr>)}
              </tbody></table>
            )}
          </div>
        </div>
        <div className="card" style={{ alignSelf: 'start' }}>
          <h3>Account history</h3>
          {p.statusHistory.length === 0 ? <div className="note" style={{ marginTop: 8 }}>No suspensions or reinstatements.</div> : (
            <div className="timeline" style={{ marginTop: 8 }}>{p.statusHistory.map((h, i) => (
              <div className="tl" key={i} style={{ gridTemplateColumns: '90px 1fr auto' }}><span className="note">{dateTime(h.at)}</span><span><b>{h.status === 'suspended' ? 'Suspended' : 'Reinstated'}</b> · {h.reason}</span><span className="note">{h.by ?? 'System'}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      {ask === 'suspend' && <ReasonModal title={`Suspend ${p.name}?`} text={driver ? 'They are signed out and cannot go online or take trips.' : 'They are signed out and cannot book rides.'} confirm="Suspend" danger onClose={() => setAsk(null)}
        onSubmit={async (reason) => { await post(`/admin/users/${p.id}/suspend`, { reason }); setToast('Account suspended'); reload(); }} />}
      {ask === 'reinstate' && <ReasonModal title={`Reinstate ${p.name}?`} confirm="Reinstate" onClose={() => setAsk(null)}
        onSubmit={async (reason) => { await post(`/admin/users/${p.id}/reinstate`, { reason }); setToast('Account reinstated'); reload(); }} />}
      {adjust && <AdjustModal userId={p.id} who={p.name} onClose={() => setAdjust(false)} onDone={() => setToast('Sent for approval')} />}
      {addingVehicle && <AddVehicleModal driverId={p.id} driverName={p.name} onClose={() => setAddingVehicle(false)} onDone={() => { setToast('Vehicle added'); reload(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}
