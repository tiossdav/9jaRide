import { useState } from 'react';
import { post } from '../api';
import { go, useConfirm, PlateInput } from '../bits';
import { Modal, moneyInput, naira, toKobo, formatPlate, isValidPlate, plateProblem } from '../ui';

const todayPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Admin only: pick the platform car for this driver and agree how they will pay for it. Approval and the plan happen together. */
export function AssignModal({ app, onClose, onDone }: { app: { id: string; driverName: string; vehicle: { category: string } }; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState(app.vehicle.category);
  const [make, setMake] = useState(''); const [colour, setColour] = useState(''); const [plate, setPlate] = useState('');
  const [total, setTotal] = useState(''); const [deposit, setDeposit] = useState('0'); const [instalment, setInstalment] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [startsOn, setStartsOn] = useState(todayPlus(7));
  const [notes, setNotes] = useState('');
  const confirm = useConfirm();
  const k = toKobo;
  const ok = make.trim().length >= 2 && colour.trim().length >= 2 && isValidPlate(plate) && k(total) > 0 && k(deposit) >= 0 && k(deposit) <= k(total) && k(instalment) > 0 && !!startsOn;
  const num = (set: (v: string) => void) => (e: { target: { value: string } }) => set(moneyInput(e.target.value));
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Assign a vehicle to {app.driverName}</h3>
      <div className="note">The driver pays for the car in instalments. You record each payment later under Finances, Vehicle plans.</div>
      <div className="grid g2">
        <div className="field"><label htmlFor="av-cat">Category</label><select id="av-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="regular">Regular</option><option value="comfort">Comfort</option><option value="package">Send Package</option></select></div>
        <div className="field"><label htmlFor="av-plate">Plate number</label><PlateInput id="av-plate" value={plate} onChange={setPlate} />{plateProblem(plate) && <div className="note" style={{ color: 'var(--red, #d64545)' }}>{plateProblem(plate)}</div>}</div>
        <div className="field"><label htmlFor="av-make">Make and model</label><input id="av-make" className="input" placeholder="Toyota Corolla" value={make} onChange={(e) => setMake(e.target.value)} /></div>
        <div className="field"><label htmlFor="av-col">Colour</label><input id="av-col" className="input" placeholder="Silver" value={colour} onChange={(e) => setColour(e.target.value)} /></div>
      </div>
      <div className="grid g2">
        <div className="field"><label htmlFor="av-total">Vehicle price (₦)</label><input id="av-total" className="input" inputMode="decimal" value={total} onChange={num(setTotal)} /></div>
        <div className="field"><label htmlFor="av-dep">Deposit (₦)</label><input id="av-dep" className="input" inputMode="decimal" value={deposit} onChange={num(setDeposit)} /></div>
        <div className="field"><label htmlFor="av-inst">Each instalment (₦)</label><input id="av-inst" className="input" inputMode="decimal" value={instalment} onChange={num(setInstalment)} /></div>
        <div className="field"><label htmlFor="av-freq">How often</label><select id="av-freq" className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
          <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></div>
      </div>
      <div className="field"><label htmlFor="av-start">First instalment due</label><input id="av-start" className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></div>
      <div className="field"><label htmlFor="av-notes">Notes (optional)</label><input id="av-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask(
          { title: `Approve ${app.driverName} and assign ${formatPlate(plate) || 'this vehicle'}?`, text: `${naira(k(total))} paid as ${naira(k(instalment))} ${frequency}, after a ${naira(k(deposit))} deposit. They can go online straight away.`, confirm: 'Yes, approve' },
          () => go(() => post(`/admin/driver-applications/${app.id}/approve`, { assignment: { vehicle: { category, make: make.trim(), colour: colour.trim(), plate: plate.trim() }, plan: { totalKobo: k(total), depositKobo: k(deposit), instalmentKobo: k(instalment), frequency, startsOn, ...(notes.trim() ? { notes: notes.trim() } : {}) } } }), () => { onDone(); onClose(); }),
        )}>Approve and assign</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
