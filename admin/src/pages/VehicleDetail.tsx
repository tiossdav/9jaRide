import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post } from '../api';
import { ReasonModal, Toast, go, useConfirm, PlateInput } from '../bits';
import { arrangementLabel, dateTime, formatPlate, isValidPlate, plateProblem, Loading, Modal, naira, Pill, title, useLoad } from '../ui';
import { Plan, statusPill } from './VehiclePlans';

interface Vehicle {
  id: string; plate: string; make: string; colour: string; category: string; inUse: boolean; suspendedAt: string | null; suspendedReason: string | null;
  arrangement: string; owner: { name: string; phone: string } | null; plan: Plan | null;
  driver: { id: string; name: string; phone: string; status: string }; driverTrips: number;
  history: { status: string; reason: string; at: string; by: string | null }[];
}

export default function VehicleDetail() {
  const { id } = useParams();
  const { data: v, error, reload } = useLoad<Vehicle>(`/admin/console/vehicles/${id}`);
  const [ask, setAsk] = useState<'suspend' | 'reinstate' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (!v) return <Loading error={error} retry={reload} />;
  const suspended = v.suspendedAt != null;
  return (
    <>
      <div className="head">
        <div><Link to="/vehicles" className="note">← Vehicles</Link><h1>{formatPlate(v.plate)}</h1><div className="sub">{v.colour} {v.make} · {title(v.category === 'package' ? 'send package' : v.category)}</div></div>
        <div className="grow" />
        {suspended ? <span className="chip red">Suspended</span> : v.inUse ? <span className="chip">In use</span> : <span className="chip grey">Retired</span>}
        {v.inUse && (suspended
          ? <button className="btn" onClick={() => setAsk('reinstate')}>Reinstate vehicle</button>
          : <button className="btn outline-red" onClick={() => setAsk('suspend')}>Suspend vehicle</button>)}
      </div>
      {suspended && <div className="banner" role="status">This vehicle is suspended, so <b>&nbsp;{v.driver.name}&nbsp;</b> cannot go online until it is reinstated{v.suspendedReason ? `. Reason: ${v.suspendedReason}` : ''}. A trip already under way is not interrupted.</div>}
      <div className="grid g2">
        <div className="card"><h3>Vehicle</h3>
          <div className="line"><span className="note">Plate</span><span>{formatPlate(v.plate)}</span></div><div className="line"><span className="note">Make</span><span>{v.make}</span></div>
          <div className="line"><span className="note">Colour</span><span>{v.colour}</span></div><div className="line"><span className="note">Category</span><span>{title(v.category)}</span></div>
          <div className="line"><span className="note">Arrangement</span><span>{arrangementLabel(v.arrangement)}</span></div>
          {v.owner && <div className="line"><span className="note">Owner</span><span>{v.owner.name} · {v.owner.phone}</span></div>}</div>
        <div className="card"><h3>Driver</h3>
          <div className="line"><span className="note">Name</span><span><Link to={`/people/${v.driver.id}`} style={{ color: 'var(--accent)' }}>{v.driver.name}</Link></span></div>
          <div className="line"><span className="note">Phone</span><span>{v.driver.phone}</span></div>
          <div className="line"><span className="note">Account</span><span>{v.driver.status === 'suspended' ? <Pill tone="red">Suspended</Pill> : <Pill tone="green">Active</Pill>}</span></div>
          <div className="line"><span className="note">Completed trips</span><span>{v.driverTrips}</span></div></div>
      </div>
      {v.plan && <div className="card" style={{ marginTop: 14 }}><div className="cardhead"><div><h3>Payment plan</h3></div>{statusPill(v.plan.status)}</div>
        <div className="line"><span className="note">Paid so far</span><span>{naira(v.plan.paidKobo)} of {naira(v.plan.terms.totalKobo)}</span></div>
        <div className="line"><span className="note">Still owed</span><span>{naira(v.plan.outstandingKobo)}</span></div>
        <div className="note" style={{ marginTop: 8 }}><Link to={`/finances/vehicle-plans/${v.plan.id}`} style={{ color: 'var(--accent)' }}>Open the plan and payments</Link></div></div>}
      <div className="card" style={{ marginTop: 14 }}><h3>History</h3>
        {v.history.length === 0 ? <div className="note" style={{ marginTop: 8 }}>No changes recorded.</div> : (
          <div className="timeline" style={{ marginTop: 8 }}>{v.history.map((h, i) => (
            <div className="tl" key={i}><span className="note">{dateTime(h.at)}</span><span><b>{title(h.status)}</b> · {h.reason}</span><span className="note">{h.by ?? 'System'}</span></div>))}</div>
        )}
      </div>
      {ask === 'suspend' && <ReasonModal title={`Suspend ${formatPlate(v.plate)}?`} text={`${v.driver.name} is taken offline and cannot go online until this vehicle is reinstated.`} confirm="Suspend vehicle" danger onClose={() => setAsk(null)}
        onSubmit={async (reason) => { await post(`/admin/console/vehicles/${v.id}/suspend`, { reason }); setToast('Vehicle suspended'); reload(); }} />}
      {ask === 'reinstate' && <ReasonModal title={`Reinstate ${formatPlate(v.plate)}?`} text={`${v.driver.name} can go online again.`} confirm="Reinstate" onClose={() => setAsk(null)}
        onSubmit={async (reason) => { await post(`/admin/console/vehicles/${v.id}/reinstate`, { reason }); setToast('Vehicle reinstated'); reload(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

/** Admin only: give a driver a different vehicle. Their old one is retired. */
export function AddVehicleModal({ driverId, driverName, onClose, onDone }: { driverId: string; driverName: string; onClose: () => void; onDone: () => void }) {
  return <AddVehicleForm driverId={driverId} driverName={driverName} onClose={onClose} onDone={onDone} />;
}


function AddVehicleForm({ driverId, driverName, onClose, onDone }: { driverId: string; driverName: string; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState('regular');
  const [make, setMake] = useState(''); const [colour, setColour] = useState(''); const [plate, setPlate] = useState('');
  const confirm = useConfirm();
  const ok = make.trim().length >= 2 && colour.trim().length >= 2 && isValidPlate(plate);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Add a vehicle for {driverName}</h3>
      <div className="note">Their current vehicle is retired, because a driver drives one vehicle at a time.</div>
      <div className="field"><label htmlFor="vc">Category</label><select id="vc" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="regular">Regular</option><option value="comfort">Comfort</option><option value="package">Send Package</option></select></div>
      <div className="grid g2">
        <div className="field"><label htmlFor="vm">Make and model</label><input id="vm" className="input" placeholder="Toyota Corolla" value={make} onChange={(e) => setMake(e.target.value)} /></div>
        <div className="field"><label htmlFor="vo">Colour</label><input id="vo" className="input" placeholder="Silver" value={colour} onChange={(e) => setColour(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="vp">Plate number</label><PlateInput id="vp" value={plate} onChange={setPlate} />{plateProblem(plate) && <div className="note" style={{ color: 'var(--red, #d64545)' }}>{plateProblem(plate)}</div>}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask({ title: `Add ${formatPlate(plate)}?`, text: `It becomes ${driverName}'s vehicle and the old one is retired.`, confirm: 'Yes, add vehicle' }, () => go(() => post('/admin/console/vehicles', { driverId, category, make, colour, plate }), () => { onDone(); onClose(); }))}>Add vehicle</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
