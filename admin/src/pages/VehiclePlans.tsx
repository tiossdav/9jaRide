import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api';
import { Pager, ReasonModal, SearchBox, Segmented, Toast, go, kv, useConfirm } from '../bits';
import { dateTime, formatPlate, initials, Loading, Modal, moneyInput, naira, Pill, Stat, title, toKobo, useLoad } from '../ui';

export interface Plan {
  id: string; status: string; collection: string;
  driver: { id: string; name: string; phone: string };
  vehicle: { id: string; plate: string; make: string; colour: string; category: string };
  terms: { totalKobo: number; depositKobo: number; instalmentKobo: number; frequency: string; startsOn: string; notes: string | null };
  paidKobo: number; outstandingKobo: number; expectedKobo: number; overdueKobo: number; nextDueOn: string | null; createdAt: string;
  payments?: { id: number; kind: string; amountKobo: number; method: string; reference: string | null; note: string | null; paidOn: string; recordedAt: string; recordedBy: string | null }[];
}
interface List { total: number; page: number; pageSize: number; counts: { live: number; outstandingKobo: number; paidKobo: number; behind: number }; items: Plan[] }

const STATUS = [['all', 'All'], ['active', 'Running'], ['defaulted', 'Defaulted'], ['completed', 'Paid off'], ['cancelled', 'Cancelled']] as const;
const EVERY: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month' };

export const statusPill = (s: string) =>
  s === 'completed' ? <Pill tone="green">Paid off</Pill> : s === 'defaulted' ? <Pill tone="red">Defaulted</Pill> : s === 'cancelled' ? <Pill>Cancelled</Pill> : <Pill tone="blue">Running</Pill>;

export function VehiclePlans() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS)[number][0]>('all');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), status, ...(search ? { search } : {}) });
  const { data: d, error, reload } = useLoad<List>(`/admin/console/vehicle-plans?${qs}`);
  return (
    <>
      <div className="head"><div><h1>Vehicle plans</h1><div className="sub">Drivers paying for a platform vehicle in instalments</div></div></div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <>
          <div className="stats">
            <Stat icon="car" label="Running plans" value={d.counts.live} />
            <Stat icon="clock" label="Behind on payments" value={d.counts.behind} tone={d.counts.behind ? 'amber' : undefined} />
            <Stat icon="wallet" label="Still owed" value={naira(d.counts.outstandingKobo)} />
            <Stat icon="check" label="Collected" value={naira(d.counts.paidKobo)} tone="green" />
          </div>
          <div style={{ display: 'flex', gap: 12, margin: '14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchBox placeholder="Search driver, phone or plate" onSearch={(s) => { setSearch(s); setPage(1); }} />
            <Segmented options={STATUS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            {d.items.length === 0 ? <div className="empty">No vehicle plans yet. They appear when a driver who chose a platform vehicle is approved.</div> : (
              <table><thead><tr><th>Driver</th><th>Vehicle</th><th className="num">Paid</th><th className="num">Still owed</th><th>Next due</th><th>Status</th></tr></thead><tbody>
                {d.items.map((p) => (
                  <tr key={p.id} className="link" onClick={() => nav(`/finances/vehicle-plans/${p.id}`)}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(p.driver.name)}</div><div>{p.driver.name}<div className="note">{p.driver.phone}</div></div></div></td>
                    <td><b>{formatPlate(p.vehicle.plate)}</b><div className="note">{p.vehicle.colour} {p.vehicle.make}</div></td>
                    <td className="num">{naira(p.paidKobo)}</td><td className="num">{naira(p.outstandingKobo)}</td>
                    <td>{p.nextDueOn ? p.nextDueOn.slice(0, 10) : '-'}{p.overdueKobo > 0 && p.status !== 'cancelled' && <div className="note" style={{ color: 'var(--amber, #b7791f)' }}>{naira(p.overdueKobo)} behind</div>}</td>
                    <td>{statusPill(p.status)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </div>
        </>
      )}
    </>
  );
}

export function VehiclePlanDetail() {
  const { id } = useParams();
  const { data: p, error, reload } = useLoad<Plan>(`/admin/console/vehicle-plans/${id}`);
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<'active' | 'defaulted' | 'cancelled' | null>(null);
  if (!p) return <Loading error={error} retry={reload} />;
  const live = p.status === 'active' || p.status === 'defaulted';
  const pct = Math.min(100, Math.round((p.paidKobo / p.terms.totalKobo) * 100));
  const WORDS = { active: ['Resume this plan?', 'The plan goes back to running.', 'Resume'], defaulted: ['Mark this plan as defaulted?', 'Payments can still be recorded.', 'Mark as defaulted'], cancelled: ['Cancel this plan?', 'The plan ends. Payments already made stay on record, and no more can be added.', 'Cancel plan'] } as const;
  return (
    <>
      <div className="head">
        <div><Link to="/finances/vehicle-plans" className="note">← Vehicle plans</Link><h1>{formatPlate(p.vehicle.plate)} · {p.driver.name}</h1><div className="sub">{p.vehicle.colour} {p.vehicle.make} · started {p.terms.startsOn.slice(0, 10)}</div></div>
        <div className="grow" />{statusPill(p.status)}
        {live && <button className="btn" onClick={() => setPaying(true)}>Record payment</button>}
      </div>
      <div className="stats">
        <Stat icon="wallet" label="Price" value={naira(p.terms.totalKobo)} />
        <Stat icon="check" label="Paid so far" value={naira(p.paidKobo)} tone="green" note={`${pct}%`} />
        <Stat icon="clock" label="Still owed" value={naira(p.outstandingKobo)} />
        <Stat icon="warn" label="Behind by" value={naira(live ? p.overdueKobo : 0)} tone={live && p.overdueKobo ? 'amber' : undefined} note={p.nextDueOn ? `Next due ${p.nextDueOn.slice(0, 10)}` : undefined} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>Agreement</h3>
            {kv('Deposit', naira(p.terms.depositKobo))}{kv('Instalment', `${naira(p.terms.instalmentKobo)} every ${EVERY[p.terms.frequency]}`)}{kv('First due', p.terms.startsOn.slice(0, 10))}
            {kv('How it is collected', p.collection === 'manual' ? 'Staff record payments' : 'From trip earnings')}
            {p.terms.notes && <div className="note" style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{p.terms.notes}</div>}</div>
          <div className="card"><h3>Driver and vehicle</h3>
            {kv('Driver', <Link to={`/people/${p.driver.id}`} style={{ color: 'var(--accent)' }}>{p.driver.name}</Link>)}{kv('Phone', p.driver.phone)}
            {kv('Vehicle', <Link to={`/vehicles/${p.vehicle.id}`} style={{ color: 'var(--accent)' }}>{formatPlate(p.vehicle.plate)}</Link>)}{kv('Category', title(p.vehicle.category))}</div>
          {live && <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {p.status === 'active' && <button className="btn ghost" onClick={() => setAsk('defaulted')}>Mark as defaulted</button>}
            {p.status === 'defaulted' && <button className="btn ghost" onClick={() => setAsk('active')}>Back to running</button>}
            <button className="btn outline-red" onClick={() => setAsk('cancelled')}>Cancel plan</button>
          </div>}
        </div>
        <div className="card" style={{ padding: 0, alignSelf: 'start' }}>
          <div style={{ padding: '16px 18px 4px' }}><h3>Payment history</h3></div>
          {!p.payments || p.payments.length === 0 ? <div className="empty">No payments recorded yet.</div> : (
            <table><thead><tr><th>Paid on</th><th>What</th><th>How</th><th className="num">Amount</th></tr></thead><tbody>
              {p.payments.map((x) => (
                <tr key={x.id}><td>{x.paidOn.slice(0, 10)}<div className="note">{dateTime(x.recordedAt)}{x.recordedBy ? ` · ${x.recordedBy}` : ''}</div></td>
                  <td>{x.kind === 'reversal' ? <span className="chip red">Reversal</span> : title(x.kind)}{x.note && <div className="note">{x.note}</div>}</td>
                  <td>{title(x.method)}{x.reference && <div className="note">{x.reference}</div>}</td>
                  <td className="num">{x.kind === 'reversal' ? '-' : ''}{naira(x.amountKobo)}</td></tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
      {paying && <RecordPayment plan={p} onClose={() => setPaying(false)} onDone={() => { setToast('Payment recorded'); reload(); }} />}
      {ask && <ReasonModal title={WORDS[ask][0]} text={WORDS[ask][1]} confirm={WORDS[ask][2]} danger={ask !== 'active'} onClose={() => setAsk(null)}
        onSubmit={async (note) => { await post(`/admin/vehicle-plans/${p.id}/status`, { status: ask, note }); setToast('Plan updated'); reload(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function RecordPayment({ plan, onClose, onDone }: { plan: Plan; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'instalment' | 'deposit' | 'reversal'>(plan.paidKobo < plan.terms.depositKobo ? 'deposit' : 'instalment');
  const [naira$, setNaira] = useState('');
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const confirm = useConfirm();
  const kobo = toKobo(naira$);
  const ok = kobo > 0 && (kind !== 'reversal' || note.trim().length >= 3);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Record a payment · {plan.driver.name}</h3>
      <div className="note">Still owed {naira(plan.outstandingKobo)}. An entry cannot be edited later; a mistake is taken back with a reversal.</div>
      <div className="field"><label htmlFor="pk">What is it?</label>
        <select id="pk" className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="instalment">Instalment</option><option value="deposit">Deposit</option><option value="reversal">Reversal of a wrong entry</option></select></div>
      <div className="grid g2">
        <div className="field"><label htmlFor="pa">Amount (₦)</label><input id="pa" className="input" inputMode="decimal" placeholder={String(plan.terms.instalmentKobo / 100)} value={naira$} onChange={(e) => setNaira(moneyInput(e.target.value))} /></div>
        <div className="field"><label htmlFor="pm">How was it paid?</label>
          <select id="pm" className="select" value={method} onChange={(e) => setMethod(e.target.value)}><option value="transfer">Bank transfer</option><option value="cash">Cash</option><option value="earnings">From trip earnings</option><option value="other">Other</option></select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label htmlFor="pr">Reference (optional)</label><input id="pr" className="input" placeholder="Transfer or receipt number" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div className="field"><label htmlFor="pd">Date paid (optional)</label><input id="pd" className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="pn">{kind === 'reversal' ? 'Why is it being reversed?' : 'Note (optional)'}</label><input id="pn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask(
          { title: `${kind === 'reversal' ? 'Reverse' : 'Record'} ${naira(kobo)}?`, text: `${kind === 'reversal' ? 'This takes that amount off' : 'This adds that amount to'} ${plan.driver.name}'s payments for ${plan.vehicle.plate}.`, confirm: kind === 'reversal' ? 'Yes, reverse' : 'Yes, record', danger: kind === 'reversal' },
          () => go(() => post(`/admin/vehicle-plans/${plan.id}/payments`, { kind, amountKobo: kobo, method, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(paidOn ? { paidOn } : {}) }), () => { onDone(); onClose(); }),
        )}>{kind === 'reversal' ? 'Reverse' : 'Record payment'}</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
