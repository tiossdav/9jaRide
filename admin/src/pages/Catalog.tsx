import { useState } from 'react';
import { call, post } from '../api';
import { Segmented, Toast, go, useConfirm } from '../bits';
import { Loading, Modal, Pill, Stat, dateTime, naira, useLoad } from '../ui';

// ---------------------------------------------------------------- Asset Types

interface AssetType { code: string; label: string; active: boolean; vehicles: number; vehiclesInUse: number; hasFees: boolean; bookable: boolean; createdAt: string }

export function AssetTypes() {
  const { data, error, reload } = useLoad<AssetType[]>('/admin/asset-types');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<AssetType | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!data) return <Loading error={error} retry={reload} />;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 30);
  return (
    <>
      <div className="head"><div><h1>Asset Types</h1><div className="sub">The kinds of ride riders can book</div></div><div className="grow" /><button className="btn" onClick={() => setAdding(true)}>+ Add Asset Type</button></div>
      <div className="stats"><Stat icon="layers" label="Types" value={data.length} /><Stat icon="check" label="Bookable now" value={data.filter((t) => t.bookable).length} tone="green" /><Stat icon="warn" label="Need fees" value={data.filter((t) => t.active && !t.hasFees).length} tone={data.some((t) => t.active && !t.hasFees) ? 'amber' : undefined} /></div>
      <div className="card" style={{ padding: 0, marginTop: 14 }}>
        <table><thead><tr><th>Name</th><th>Code</th><th className="num">Vehicles</th><th className="num">In use</th><th>Fees</th><th>State</th><th /></tr></thead><tbody>
          {data.map((t) => (
            <tr key={t.code}>
              <td><b>{t.label}</b></td><td className="note">{t.code}</td><td className="num">{t.vehicles}</td><td className="num">{t.vehiclesInUse}</td>
              <td>{t.hasFees ? <Pill tone="green">Set</Pill> : <Pill tone="amber">Needs fees</Pill>}</td>
              <td>{!t.active ? <Pill tone="red">Switched off</Pill> : t.bookable ? <Pill tone="green">Bookable</Pill> : <Pill tone="amber">Not bookable yet</Pill>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn ghost" style={{ height: 30 }} onClick={() => setRenaming(t)}>Rename</button>{' '}
                <button className={'btn ' + (t.active ? 'outline-red' : '')} style={{ height: 30 }} onClick={() => confirm.ask(
                  t.active ? { title: `Switch off ${t.label}?`, text: 'Riders can no longer book it and new vehicles cannot be added to it. Trips already booked carry on.', confirm: 'Yes, switch off', danger: true } : { title: `Switch on ${t.label}?`, text: t.hasFees ? 'Riders can book it again.' : 'It still needs fees before riders can book it.', confirm: 'Yes, switch on' },
                  () => go(() => call('PATCH', `/admin/asset-types/${t.code}`, { active: !t.active }), () => { setToast(t.active ? 'Switched off' : 'Switched on'); reload(); }))}>{t.active ? 'Switch off' : 'Switch on'}</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>
      <div className="note" style={{ marginTop: 10 }}>A new type is bookable once it is switched on and has fees in force (Setup → Trip Fees). Codes cannot be changed after they are made.</div>
      {adding && <AddType slug={slug} onClose={() => setAdding(false)} onDone={() => { setToast('Added. Now set its fees.'); reload(); }} />}
      {renaming && <Rename t={renaming} onClose={() => setRenaming(null)} onDone={() => { setToast('Renamed'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function AddType({ slug, onClose, onDone }: { slug: (s: string) => string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const confirm = useConfirm();
  const shown = touched ? code : slug(label);
  const ok = label.trim().length >= 2 && /^[a-z][a-z0-9_]{1,29}$/.test(shown);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Add an asset type</h3>
      <div className="field"><label htmlFor="al">Name riders see</label><input id="al" className="input" placeholder="Premium" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus /></div>
      <div className="field"><label htmlFor="ac">Code</label><input id="ac" className="input" value={shown} onChange={(e) => { setTouched(true); setCode(e.target.value.toLowerCase()); }} /><div className="note">Lowercase letters, numbers and underscores. It cannot be changed later.</div></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask({ title: `Add ${label.trim()}?`, text: 'It will not be bookable until it has fees in force.', confirm: 'Yes, add' }, () => go(() => post('/admin/asset-types', { code: shown, label: label.trim() }), () => { onDone(); onClose(); }))}>Add</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

function Rename({ t, onClose, onDone }: { t: AssetType; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(t.label);
  const confirm = useConfirm();
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Rename {t.label}</h3>
      <div className="field"><label htmlFor="rn">Name riders see</label><input id="rn" className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus /></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={label.trim().length < 2 || label.trim() === t.label} onClick={() => confirm.ask({ title: `Rename to "${label.trim()}"?`, text: 'Riders and drivers see the new name straight away.', confirm: 'Yes, rename' }, () => go(() => call('PATCH', `/admin/asset-types/${t.code}`, { label: label.trim() }), () => { onDone(); onClose(); }))}>Save</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

// ---------------------------------------------------------------- Stakeholder payouts

interface Owed { name: string; accruedKobo: number; paidKobo: number; pendingKobo: number; availableKobo: number }
interface SPayout { id: string; stakeholder: string; amountKobo: number; reference: string | null; note: string | null; status: string; requestedBy: string | null; approvedBy: string | null; createdAt: string; rejectedReason: string | null }

export function StakeholderPayouts() {
  const { data: owed, error, reload } = useLoad<Owed[]>('/admin/stakeholders');
  const [status, setStatus] = useState<'PENDING_APPROVAL' | 'PAID' | 'REJECTED'>('PENDING_APPROVAL');
  const { data: list, reload: reloadList } = useLoad<SPayout[]>(`/admin/stakeholders/payouts?status=${status}`);
  const [paying, setPaying] = useState<Owed | null>(null);
  const [rejecting, setRejecting] = useState<SPayout | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();
  const refresh = () => { reload(); reloadList(); };
  if (!owed) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="head"><div><h1>Stakeholder payouts</h1><div className="sub">What each party is owed from the commission, set in Revenue Setup. A different person approves every payout.</div></div></div>
      <div className="card" style={{ padding: 0 }}>
        <table><thead><tr><th>Party</th><th className="num">Earned</th><th className="num">Paid</th><th className="num">Waiting</th><th className="num">Available</th><th /></tr></thead><tbody>
          {owed.length === 0 && <tr><td colSpan={6} className="empty">No parties yet. Add them in Revenue Setup.</td></tr>}
          {owed.map((o) => (
            <tr key={o.name}><td><b>{o.name}</b></td><td className="num">{naira(o.accruedKobo, true)}</td><td className="num">{naira(o.paidKobo, true)}</td><td className="num">{naira(o.pendingKobo, true)}</td><td className="num"><b>{naira(o.availableKobo, true)}</b></td>
              <td style={{ textAlign: 'right' }}><button className="btn" style={{ height: 30 }} disabled={o.availableKobo <= 0} onClick={() => setPaying(o)}>Pay out</button></td></tr>
          ))}
        </tbody></table>
      </div>
      <div style={{ margin: '18px 0 10px' }}><Segmented options={[['PENDING_APPROVAL', 'Waiting'], ['PAID', 'Paid'], ['REJECTED', 'Rejected']] as const} value={status} onChange={setStatus} /></div>
      <div className="card" style={{ padding: 0 }}>
        {!list ? <Loading /> : list.length === 0 ? <div className="empty">Nothing here.</div> : (
          <table><thead><tr><th>Requested</th><th>Party</th><th className="num">Amount</th><th>Reference</th><th>By</th><th /></tr></thead><tbody>
            {list.map((p) => (
              <tr key={p.id}><td>{dateTime(p.createdAt)}</td><td>{p.stakeholder}</td><td className="num">{naira(p.amountKobo, true)}</td><td className="note">{p.reference ?? '-'}{p.rejectedReason && <div>Rejected: {p.rejectedReason}</div>}</td>
                <td className="note">{p.requestedBy}{p.approvedBy ? ` → ${p.approvedBy}` : ''}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.status === 'PENDING_APPROVAL' && <>
                  <button className="btn" style={{ height: 30 }} onClick={() => confirm.ask({ title: `Pay ${naira(p.amountKobo, true)} to ${p.stakeholder}?`, text: 'The money leaves the commission account and the bank. It cannot be taken back.', confirm: 'Yes, approve and pay' }, () => go(() => post(`/admin/stakeholders/payouts/${p.id}/approve`), () => { setToast('Payout approved'); refresh(); }))}>Approve</button>{' '}
                  <button className="btn outline-red" style={{ height: 30 }} onClick={() => setRejecting(p)}>Reject</button></>}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      {paying && <PayModal o={paying} onClose={() => setPaying(null)} onDone={() => { setToast('Sent for approval'); refresh(); }} />}
      {rejecting && <RejectModal p={rejecting} onClose={() => setRejecting(null)} onDone={() => { setToast('Rejected'); refresh(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function PayModal({ o, onClose, onDone }: { o: Owed; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState((o.availableKobo / 100).toFixed(2));
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const confirm = useConfirm();
  const kobo = Math.round(Number(amount) * 100);
  const ok = kobo > 0 && kobo <= o.availableKobo;
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Pay out {o.name}</h3>
      <div className="note">Available: {naira(o.availableKobo, true)}</div>
      <div className="field"><label htmlFor="pa">Amount (₦)</label><input id="pa" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />{kobo > o.availableKobo && <div className="error">More than they are owed.</div>}</div>
      <div className="field"><label htmlFor="pr">Bank transfer reference</label><input id="pr" className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <div className="field"><label htmlFor="pn">Note</label><input id="pn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask({ title: `Ask to pay ${naira(kobo, true)} to ${o.name}?`, text: 'Nothing moves until a different person approves it.', confirm: 'Yes, send for approval' }, () => go(() => post('/admin/stakeholders/payouts', { stakeholder: o.name, amountKobo: kobo, ...(ref.trim() ? { reference: ref.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }), () => { onDone(); onClose(); }))}>Send for approval</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

function RejectModal({ p, onClose, onDone }: { p: SPayout; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const confirm = useConfirm();
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Reject {naira(p.amountKobo, true)} to {p.stakeholder}</h3>
      <div className="field"><label htmlFor="rr">Reason</label><textarea id="rr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus /></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={reason.trim().length < 3} onClick={() => confirm.ask({ title: 'Reject this payout?', confirm: 'Yes, reject', danger: true }, () => go(() => post(`/admin/stakeholders/payouts/${p.id}/reject`, { reason: reason.trim() }), () => { onDone(); onClose(); }))}>Reject</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
