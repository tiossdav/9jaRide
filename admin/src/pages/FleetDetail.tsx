import { useRef, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { del, post, uploadFile } from '../api';
import { ReasonModal, SearchBox, Toast, go, kv, useAction, useConfirm } from '../bits';
import { AuthImage, Loading, Modal, Pill, dateTime, formatPlate, moneyInput, naira, title, toKobo, useLoad } from '../ui';
import { vehicleChip } from './Fleet';

interface Detail {
  id: string; plate: string; makeModel: string; colour: string; category: string; year: number | null; vin: string | null; notes: string | null; status: string; verifiedAt: string | null;
  business: { id: string; name: string; defaultDeductionBps: number } | null;
  images: { id: string; fileId: string }[];
  available: boolean;
  history: { id: string; driver: { id: string; name: string }; startedAt: string; endedAt: string | null; endedReason: string | null; deductionBps: number; targetKobo: number | null; setBy: string; paidKobo: number }[];
}
interface DriverPick { id: string; name: string; phone: string; hasVehicle: boolean; plate: string | null }

export default function FleetDetail() {
  const { id } = useParams();
  const { me } = useOutletContext<{ me: { role: string } | null }>();
  const canEdit = me?.role === 'admin' || me?.role === 'business';
  const { data: v, error, reload } = useLoad<Detail>(`/fleet/vehicles/${id}`);
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  if (!v) return <Loading error={error} retry={reload} />;
  const live = v.history.find((h) => !h.endedAt);
  const status = (s: 'verified' | 'suspended' | 'retired', text: string, done: string, danger = false) =>
    confirm.ask({ title: `${title(s === 'verified' ? 'verify' : s === 'suspended' ? 'suspend' : 'retire')} ${formatPlate(v.plate)}?`, text, confirm: `Yes, ${s === 'verified' ? 'verify' : s === 'suspended' ? 'suspend' : 'retire'}`, danger },
      () => go(() => post(`/fleet/vehicles/${v.id}/status`, { status: s }), () => { setToast(done); reload(); }));

  return (
    <>
      <div className="head">
        <div><Link to="/fleet" className="note">← Fleet</Link><h1>{formatPlate(v.plate)}</h1><div className="sub">{v.colour} {v.makeModel}{v.year ? ` · ${v.year}` : ''} · {title(v.category)}{v.business ? ` · ${v.business.name}` : ''}</div></div>
        <div className="grow" />{vehicleChip({ status: v.status, driver: live })}
        {canEdit && v.status === 'pending' && <button className="btn" onClick={() => status('verified', 'Once verified, this vehicle can be given to a driver.', 'Vehicle verified')}>Verify vehicle</button>}
        {canEdit && v.status === 'verified' && v.available && <button className="btn" onClick={() => setAssigning(true)}>Give to a driver</button>}
        {canEdit && v.status === 'verified' && <button className="btn outline-red" onClick={() => status('suspended', 'It cannot be given to a driver while suspended.', 'Vehicle suspended', true)}>Suspend</button>}
        {canEdit && v.status === 'suspended' && <button className="btn" onClick={() => status('verified', 'It can be given to a driver again.', 'Vehicle verified')}>Verify again</button>}
        {canEdit && v.status !== 'retired' && !live && <button className="btn ghost" onClick={() => status('retired', 'It is taken out of the list for good.', 'Vehicle retired', true)}>Retire</button>}
      </div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      <div className="grid g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>Details</h3>
            {kv('Plate number', formatPlate(v.plate))}{kv('Make and model', v.makeModel)}{kv('Colour', v.colour)}{kv('Category', title(v.category))}{kv('Year', v.year ?? '-')}{kv('VIN', v.vin ?? '-')}
            {kv('Verified', v.verifiedAt ? dateTime(v.verifiedAt) : 'Not yet')}{v.notes && <div className="note" style={{ marginTop: 8 }}>{v.notes}</div>}</div>
          <div className="card">
            <div className="cardhead"><div><h3>Pictures</h3></div>{canEdit && v.images.length < 8 && <>
              <button className="btn ghost" style={{ height: 30 }} onClick={() => file.current?.click()}>Add picture</button>
              <input ref={file} type="file" accept="image/*" hidden aria-label="Add picture" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (f) act.run(async () => { const fileId = await uploadFile(f); await post(`/fleet/vehicles/${v.id}/images`, { fileId }); }, reload);
              }} /></>}</div>
            {v.images.length === 0 ? <div className="note" style={{ marginTop: 8 }}>No pictures yet. Add a few so drivers and staff can recognise the vehicle.</div> : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {v.images.map((i) => (
                  <div key={i.id} style={{ position: 'relative' }}>
                    <AuthImage fileId={i.fileId} alt={`${formatPlate(v.plate)} picture`} size={110} />
                    {canEdit && <button aria-label="Remove picture" className="nt-x" style={{ position: 'absolute', top: 2, right: 6, color: '#fff', textShadow: '0 0 4px #000' }}
                      onClick={() => confirm.ask({ title: 'Remove this picture?', text: 'The picture is taken off this vehicle.', confirm: 'Yes, remove', danger: true }, () => go(() => del(`/fleet/vehicles/${v.id}/images/${i.id}`), reload))}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: 0, alignSelf: 'start' }}>
          <div style={{ padding: '16px 18px 4px' }}><h3>Who has driven it</h3></div>
          {v.history.length === 0 ? <div className="empty">Nobody has driven this vehicle yet.</div> : (
            <table><thead><tr><th>Driver</th><th>From</th><th>Share</th><th className="num">Paid so far</th><th /></tr></thead><tbody>
              {v.history.map((h) => (
                <tr key={h.id}>
                  <td><Link to={`/people/${h.driver.id}`} style={{ color: 'var(--accent)' }}>{h.driver.name}</Link>{h.endedAt ? <div className="note">until {dateTime(h.endedAt)}{h.endedReason ? ` · ${h.endedReason}` : ''}</div> : <div><Pill tone="blue">Driving now</Pill></div>}</td>
                  <td>{dateTime(h.startedAt)}</td>
                  <td>{h.deductionBps / 100}%{h.targetKobo != null && <div className="note">until {naira(h.targetKobo)}</div>}</td>
                  <td className="num">{naira(h.paidKobo)}</td>
                  <td>{canEdit && !h.endedAt && <button className="btn ghost" style={{ height: 28 }} onClick={() => setEnding(h.id)}>Take back</button>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
      {assigning && <AssignDriver v={v} onClose={() => setAssigning(false)} onDone={() => { setToast('Vehicle given to the driver'); reload(); }} />}
      {ending && <ReasonModal title="Take this vehicle back?" text="The driver is taken offline and has no vehicle until they are given another. The record of this assignment is kept." confirm="Take back" danger onClose={() => setEnding(null)}
        onSubmit={async (reason) => { await post(`/fleet/assignments/${ending}/end`, { reason }); setToast('Vehicle taken back'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

/** Pick an approved driver and set what share of their earnings goes toward the vehicle. */
function AssignDriver({ v, onClose, onDone }: { v: Detail; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<DriverPick | null>(null);
  const [percent, setPercent] = useState(String((v.business?.defaultDeductionBps ?? 2000) / 100));
  const [target, setTarget] = useState('');
  const { data: drivers, loading } = useLoad<DriverPick[]>(`/fleet/drivers${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const confirm = useConfirm();
  const bps = Math.round(Number(percent) * 100);
  const ok = !!picked && bps >= 0 && bps <= 9000 && percent !== '';
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Give {formatPlate(v.plate)} to a driver</h3>
      <div className="note">Only drivers who have passed verification are listed. Drivers without a vehicle come first.</div>
      <SearchBox placeholder="Search by name or phone" onSearch={setSearch} />
      <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, opacity: loading ? 0.6 : 1 }}>
        {(drivers ?? []).length === 0 ? <div className="note" style={{ padding: 12 }}>No approved drivers found.</div> : (drivers ?? []).map((d) => (
          <button key={d.id} onClick={() => setPicked(d)} className="nt-row" style={{ background: picked?.id === d.id ? 'var(--active)' : undefined }} aria-pressed={picked?.id === d.id}>
            <span style={{ flex: 1, textAlign: 'left' }}><b>{d.name}</b><div className="note">{d.phone}</div></span>
            {d.hasVehicle ? <span className="note">Has {d.plate ? formatPlate(d.plate) : 'a vehicle'}: it will be replaced</span> : <Pill tone="green">No vehicle</Pill>}
          </button>))}
      </div>
      <div className="grid g2">
        <div className="field"><label htmlFor="as-pct">Share of the driver's earnings (%)</label><input id="as-pct" className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} />
          <div className="note">Taken from each trip and paid to {v.business?.name ?? 'the owner'}. The driver cannot change it. Up to 90%.</div></div>
        <div className="field"><label htmlFor="as-target">Stop after (₦, optional)</label><input id="as-target" className="input" inputMode="decimal" placeholder="Price of the vehicle" value={target} onChange={(e) => setTarget(moneyInput(e.target.value))} />
          <div className="note">Leave empty to carry on with no end.</div></div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => picked && confirm.ask(
          { title: `Give ${formatPlate(v.plate)} to ${picked.name}?`, text: `${percent}% of ${picked.name}'s earnings will go toward this vehicle${target ? ` until ${naira(toKobo(target))} is paid` : ''}. ${picked.hasVehicle ? 'Their current vehicle is taken back. ' : ''}They can go online with it straight away.`, confirm: 'Yes, give it' },
          () => go(() => post(`/fleet/vehicles/${v.id}/assign`, { driverId: picked.id, deductionBps: bps, ...(target ? { targetKobo: toKobo(target) } : {}) }), () => { onDone(); onClose(); }),
        )}>Give vehicle</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
