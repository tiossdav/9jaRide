import { ReactNode, useState } from 'react';
import { del, post } from '../api';
import { Toast, go, useConfirm } from '../bits';
import { Icon, Loading, Modal, Pill, dateTime, useLoad } from '../ui';

// ---------------------------------------------------------------- shapes (mirror the server's settings)

export interface RevenueRules { commissionBps: number; taxBase: 'excluded' | 'included'; shares: { name: string; bps: number }[] }
export interface CancellationRules { enabled: boolean; windowDays: number; minRequests: number; tiers: { fromPct: number; toPct: number; penaltyMinutes: number }[] }
export interface ServiceAreaRules { enabled: boolean; areas: { name: string; lat: number; lng: number; radiusKm: number }[] }
interface Version<T> { id: string; value: T; effectiveFrom: string; createdAt: string; createdBy: string; approvedBy: string | null; state: 'live' | 'scheduled' | 'pending' | 'superseded' }
interface Payload<T> { current: T; versions: Version<T>[] }

const STATE = { live: ['green', 'Live'], scheduled: ['blue', 'Scheduled'], pending: ['amber', 'Awaiting approval'], superseded: ['grey', 'Replaced'] } as const;
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/**
 * The shape every editable rule shares: what is in force, a form to propose a change with a start time, and the history.
 * A change needs a different admin to approve it, so nothing is edited in place and past trips stay explainable.
 */
function RuleScreen<T>({ settingKey, title, intro, summary, Form, rows }: {
  settingKey: 'revenue' | 'cancellation' | 'service_area'; title: string; intro: string; summary: (v: T) => ReactNode;
  Form: (p: { initial: T; onSubmit: (value: T, when: Date) => Promise<unknown>; onClose: () => void }) => ReactNode; rows: (v: T) => ReactNode;
}) {
  const { data, error, reload } = useLoad<Payload<T>>(`/admin/settings/${settingKey}`);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!data) return <Loading error={error} retry={reload} />;
  const pending = data.versions.filter((v) => v.state === 'pending');
  const scheduled = data.versions.filter((v) => v.state === 'scheduled');
  return (
    <>
      <div className="head"><div><h1>{title}</h1><div className="sub">{intro}</div></div><div className="grow" /><button className="btn" onClick={() => setEditing(true)}>Propose a change</button></div>
      <div className="banner">Changes start at a time you choose and need a different admin to approve them. Trips already booked keep the rules they were booked under.</div>

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--gold)' }}>
          <h3>Waiting for approval</h3>
          {pending.map((v) => (
            <div className="line" key={v.id} style={{ alignItems: 'center' }}>
              <span><b>Starts {dateTime(v.effectiveFrom)}</b> · proposed by {v.createdBy}<div className="note">{summary(v.value)}</div></span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <button className="btn" style={{ height: 30 }} onClick={() => confirm.ask({ title: 'Approve this change?', text: `It applies to trips booked from ${dateTime(v.effectiveFrom)}. Once approved it can never be edited.`, confirm: 'Yes, approve' }, () => go(() => post(`/admin/settings/versions/${v.id}/approve`), () => { setToast('Approved'); reload(); }))}>Approve</button>{' '}
                <button className="btn outline-red" style={{ height: 30 }} onClick={() => confirm.ask({ title: 'Discard this proposal?', text: 'It is removed. The rules in force stay as they are.', confirm: 'Yes, discard', danger: true }, () => go(() => del(`/admin/settings/versions/${v.id}`), () => { setToast('Discarded'); reload(); }))}>Discard</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {scheduled.length > 0 && <div className="banner" role="status">{scheduled.length} approved change{scheduled.length === 1 ? '' : 's'} will start later: next on {dateTime(scheduled[scheduled.length - 1].effectiveFrom)}.</div>}

      <div className="card" style={{ marginBottom: 14 }}><div className="cardhead"><div><h3>In force now</h3></div><Pill tone="green">Live</Pill></div><div style={{ marginTop: 8 }}>{rows(data.current)}</div></div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 18px 4px' }}><h3>History</h3></div>
        <table><thead><tr><th>Starts</th><th>Rules</th><th>Proposed by</th><th>Approved by</th><th>Status</th></tr></thead><tbody>
          {data.versions.map((v) => (
            <tr key={v.id}><td>{dateTime(v.effectiveFrom)}</td><td className="note" style={{ maxWidth: 380 }}>{summary(v.value)}</td><td>{v.createdBy}</td><td>{v.approvedBy ?? '-'}</td><td><Pill tone={STATE[v.state][0]}>{STATE[v.state][1]}</Pill></td></tr>
          ))}
        </tbody></table>
      </div>

      {editing && <Form initial={data.current} onClose={() => setEditing(false)} onSubmit={(value, when) => post(`/admin/settings/${settingKey}`, { value, effectiveFrom: when.toISOString() }).then(() => { setToast('Sent for approval'); reload(); })} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function Shell({ title, hint, children, onClose, canSave, onSave, when, setWhen }: {
  title: string; hint: string; children: ReactNode; onClose: () => void; canSave: boolean; onSave: () => Promise<unknown>; when: string; setWhen: (v: string) => void;
}) {
  const confirm = useConfirm();
  const soonEnough = new Date(when).getTime() > Date.now() + 10 * 60_000;
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
      <div className="note">{hint}</div>
      {children}
      <div className="field"><label htmlFor="when">Starts</label><input id="when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        {!soonEnough && <div className="error">Choose a time at least 10 minutes from now.</div>}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!canSave || !soonEnough} onClick={() => confirm.ask({ title: 'Send this change for approval?', text: `It starts ${new Date(when).toLocaleString('en-GB')} once a different admin approves it.`, confirm: 'Yes, send' }, () => go(onSave, onClose))}>Send for approval</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

// ---------------------------------------------------------------- Revenue Setup

function RevenueForm({ initial, onSubmit, onClose }: { initial: RevenueRules; onSubmit: (v: RevenueRules, when: Date) => Promise<unknown>; onClose: () => void }) {
  const [commission, setCommission] = useState(String(initial.commissionBps / 100));
  const [taxBase, setTaxBase] = useState(initial.taxBase);
  const [shares, setShares] = useState(initial.shares.map((s) => ({ name: s.name, pct: String(s.bps / 100) })));
  const [when, setWhen] = useState(localInput(new Date(Date.now() + 24 * 3600_000)));
  const total = shares.reduce((n, s) => n + (num(s.pct) || 0), 0);
  const bps = Math.round(num(commission) * 100);
  const valid = Number.isFinite(bps) && bps >= 0 && bps <= 5000 && Math.abs(total - 100) < 0.001 && shares.every((s) => s.name.trim().length >= 2 && Number.isFinite(num(s.pct)) && num(s.pct) >= 0);
  const set = (i: number, k: 'name' | 'pct', v: string) => setShares(shares.map((s, n) => (n === i ? { ...s, [k]: k === 'pct' ? v.replace(/[^0-9.]/g, '') : v } : s)));
  return (
    <Shell title="Propose a revenue change" hint="The 9jaRide service charge is the platform's share of each fare. The shares say who the commission is divided between." onClose={onClose} when={when} setWhen={setWhen} canSave={valid}
      onSave={() => onSubmit({ commissionBps: bps, taxBase, shares: shares.map((s) => ({ name: s.name.trim(), bps: Math.round(num(s.pct) * 100) })) }, new Date(when))}>
      <div className="field"><label htmlFor="rc">9jaRide service charge (% of the fare)</label><input id="rc" className="input" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value.replace(/[^0-9.]/g, ''))} />
        <div className="note">Between 0% and 50%.</div></div>
      <div className="field"><label htmlFor="tb">Worked out on</label>
        <select id="tb" className="select" value={taxBase} onChange={(e) => setTaxBase(e.target.value as 'excluded' | 'included')}>
          <option value="excluded">The fare without the tax line</option><option value="included">The whole fare, tax line included</option></select></div>
      <div className="field"><label>Who shares the service charge</label>
        {shares.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input className="input" aria-label={`Party ${i + 1} name`} placeholder="Name" value={s.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <input className="input" aria-label={`Party ${i + 1} share`} style={{ width: 90 }} inputMode="decimal" value={s.pct} onChange={(e) => set(i, 'pct', e.target.value)} />
            <span style={{ alignSelf: 'center' }}>%</span>
            {shares.length > 1 && <button className="icon-btn" aria-label={`Remove party ${i + 1}`} onClick={() => setShares(shares.filter((_, n) => n !== i))}><Icon name="x" size={16} /></button>}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {shares.length < 10 && <button className="btn ghost" style={{ height: 30 }} onClick={() => setShares([...shares, { name: '', pct: '0' }])}>Add a party</button>}
          <span className={Math.abs(total - 100) < 0.001 ? 'note' : 'error'}>Adds up to {total.toFixed(2).replace(/\.?0+$/, '')}% {Math.abs(total - 100) < 0.001 ? '' : '(must be 100%)'}</span>
        </div>
      </div>
    </Shell>
  );
}

const revenueSummary = (v: RevenueRules) => `${pct(v.commissionBps)} of the fare ${v.taxBase === 'included' ? 'with' : 'without'} the tax line · ${v.shares.map((s) => `${s.name} ${pct(s.bps)}`).join(', ')}`;

export function RevenueSetup() {
  return (
    <RuleScreen<RevenueRules> settingKey="revenue" title="Revenue Setup" intro="How much the platform keeps from each trip, and who the commission is shared with" summary={revenueSummary} Form={RevenueForm}
      rows={(v) => (
        <>
          <div className="line"><span className="note">9jaRide service charge</span><b>{pct(v.commissionBps)}</b></div>
          <div className="line"><span className="note">Worked out on</span><span>{v.taxBase === 'included' ? 'The whole fare, tax line included' : 'The fare without the tax line'}</span></div>
          {v.shares.map((s) => <div className="line" key={s.name}><span className="note">{s.name}</span><span>{pct(s.bps)} of the commission</span></div>)}
        </>
      )} />
  );
}

// ---------------------------------------------------------------- Cancellation Policy

function CancellationForm({ initial, onSubmit, onClose }: { initial: CancellationRules; onSubmit: (v: CancellationRules, when: Date) => Promise<unknown>; onClose: () => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [windowDays, setWindowDays] = useState(String(initial.windowDays));
  const [minRequests, setMinRequests] = useState(String(initial.minRequests));
  const [tiers, setTiers] = useState(initial.tiers.map((t) => ({ from: String(t.fromPct), to: String(t.toPct), mins: String(t.penaltyMinutes) })));
  const [when, setWhen] = useState(localInput(new Date(Date.now() + 24 * 3600_000)));
  const sorted = tiers.map((t) => ({ f: num(t.from), t: num(t.to), m: num(t.mins) })).sort((a, b) => a.f - b.f);
  const tiersOk = sorted.every((t, i) => [t.f, t.t, t.m].every(Number.isInteger) && t.f >= 0 && t.t <= 100 && t.t >= t.f && t.m >= 0 && t.m <= 120 && (i === 0 || t.f > sorted[i - 1].t));
  const valid = Number.isInteger(num(windowDays)) && num(windowDays) >= 1 && num(windowDays) <= 90 && Number.isInteger(num(minRequests)) && num(minRequests) >= 1 && tiersOk;
  const set = (i: number, k: 'from' | 'to' | 'mins', v: string) => setTiers(tiers.map((t, n) => (n === i ? { ...t, [k]: v.replace(/[^0-9]/g, '') } : t)));
  return (
    <Shell title="Propose a cancellation policy change" hint="Drivers who cancel a lot are ranked lower when a rider is matched, by adding minutes to how far away they seem." onClose={onClose} when={when} setWhen={setWhen} canSave={valid}
      onSave={() => onSubmit({ enabled, windowDays: num(windowDays), minRequests: num(minRequests), tiers: sorted.map((t) => ({ fromPct: t.f, toPct: t.t, penaltyMinutes: t.m })) }, new Date(when))}>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Apply this policy</label>
      <div className="grid g2">
        <div className="field"><label htmlFor="wd">Look back (days)</label><input id="wd" className="input" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value.replace(/[^0-9]/g, ''))} /></div>
        <div className="field"><label htmlFor="mr">Fewest trips before it applies</label><input id="mr" className="input" inputMode="numeric" value={minRequests} onChange={(e) => setMinRequests(e.target.value.replace(/[^0-9]/g, ''))} /></div>
      </div>
      <div className="field"><label>Tiers (cancel rate → minutes added)</label>
        {tiers.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input className="input" aria-label={`Tier ${i + 1} from`} style={{ width: 70 }} inputMode="numeric" value={t.from} onChange={(e) => set(i, 'from', e.target.value)} /><span>% to</span>
            <input className="input" aria-label={`Tier ${i + 1} to`} style={{ width: 70 }} inputMode="numeric" value={t.to} onChange={(e) => set(i, 'to', e.target.value)} /><span>% adds</span>
            <input className="input" aria-label={`Tier ${i + 1} minutes`} style={{ width: 70 }} inputMode="numeric" value={t.mins} onChange={(e) => set(i, 'mins', e.target.value)} /><span>min</span>
            <button className="icon-btn" aria-label={`Remove tier ${i + 1}`} onClick={() => setTiers(tiers.filter((_, n) => n !== i))}><Icon name="x" size={16} /></button>
          </div>
        ))}
        {tiers.length < 10 && <button className="btn ghost" style={{ height: 30, alignSelf: 'flex-start' }} onClick={() => setTiers([...tiers, { from: '', to: '', mins: '' }])}>Add a tier</button>}
        {!tiersOk && <div className="error">Each tier needs whole numbers, ending after it starts, with no overlap between tiers.</div>}
      </div>
    </Shell>
  );
}

const cancelSummary = (v: CancellationRules) => `${v.enabled ? 'On' : 'Off'} · last ${v.windowDays} days · from ${v.minRequests} trips · ${v.tiers.map((t) => `${t.fromPct}–${t.toPct}% adds ${t.penaltyMinutes} min`).join(', ') || 'no tiers'}`;

export function CancellationPolicy() {
  return (
    <RuleScreen<CancellationRules> settingKey="cancellation" title="Cancellation Policy" intro="Drivers who cancel often are offered fewer rides" summary={cancelSummary} Form={CancellationForm}
      rows={(v) => (
        <>
          <div className="line"><span className="note">Status</span><span>{v.enabled ? <Pill tone="green">On</Pill> : <Pill>Off</Pill>}</span></div>
          <div className="line"><span className="note">Window</span><span>{v.windowDays} days, rolling</span></div>
          <div className="line"><span className="note">Fewest trips before it applies</span><span>{v.minRequests}</span></div>
          {v.tiers.map((t, i) => <div className="line" key={i}><span className="note">Tier {i + 1}: {t.fromPct}% to {t.toPct}% cancelled</span><span>adds {t.penaltyMinutes} min</span></div>)}
          <div className="note" style={{ marginTop: 10 }}>The minutes are added to how far away a driver seems when a rider is matched, so a frequent canceller is offered fewer rides. Drivers who accept fewer trips than the minimum are never affected.</div>
        </>
      )} />
  );
}

// ---------------------------------------------------------------- Operating Area

function OperatingAreaForm({ initial, onSubmit, onClose }: { initial: ServiceAreaRules; onSubmit: (v: ServiceAreaRules, when: Date) => Promise<unknown>; onClose: () => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [areas, setAreas] = useState(initial.areas.map((a) => ({ name: a.name, lat: String(a.lat), lng: String(a.lng), km: String(a.radiusKm) })));
  const [when, setWhen] = useState(localInput(new Date(Date.now() + 24 * 3600_000)));
  const parsed = areas.map((a) => ({ name: a.name.trim(), lat: num(a.lat), lng: num(a.lng), radiusKm: num(a.km) }));
  const valid = (!enabled || parsed.length > 0) && parsed.every((a) => a.name.length >= 2 && a.lat >= 3 && a.lat <= 15 && a.lng >= 2 && a.lng <= 15 && a.radiusKm >= 1 && a.radiusKm <= 300);
  const set = (i: number, k: 'name' | 'lat' | 'lng' | 'km', v: string) => setAreas(areas.map((a, n) => (n === i ? { ...a, [k]: k === 'name' ? v : v.replace(/[^0-9.]/g, '') } : a)));
  return (
    <Shell title="Propose an operating area change" hint="Riders can only book from inside these places, and only drivers inside them are offered rides. Where a trip ends does not matter." onClose={onClose} when={when} setWhen={setWhen} canSave={valid}
      onSave={() => onSubmit({ enabled, areas: parsed }, new Date(when))}>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Limit bookings and drivers to these areas</label>
      <div className="field"><label>Areas (a centre point and how far it reaches)</label>
        {areas.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input className="input" aria-label={`Area ${i + 1} name`} placeholder="Name" value={a.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <input className="input" aria-label={`Area ${i + 1} latitude`} style={{ width: 90 }} placeholder="Lat" inputMode="decimal" value={a.lat} onChange={(e) => set(i, 'lat', e.target.value)} />
            <input className="input" aria-label={`Area ${i + 1} longitude`} style={{ width: 90 }} placeholder="Lng" inputMode="decimal" value={a.lng} onChange={(e) => set(i, 'lng', e.target.value)} />
            <input className="input" aria-label={`Area ${i + 1} radius in km`} style={{ width: 70 }} placeholder="km" inputMode="decimal" value={a.km} onChange={(e) => set(i, 'km', e.target.value)} />
            <button className="icon-btn" aria-label={`Remove area ${i + 1}`} onClick={() => setAreas(areas.filter((_, n) => n !== i))}><Icon name="x" size={16} /></button>
          </div>
        ))}
        <button className="btn ghost" style={{ height: 30 }} onClick={() => setAreas([...areas, { name: '', lat: '', lng: '', km: '30' }])}>Add an area</button>
      </div>
    </Shell>
  );
}

const areaSummary = (v: ServiceAreaRules) => (v.enabled ? v.areas.map((a) => `${a.name} (${a.radiusKm} km)`).join(', ') : 'No limit');

export function OperatingArea() {
  return (
    <RuleScreen<ServiceAreaRules> settingKey="service_area" title="Operating Area" intro="Where drivers work. All of Nigeria to begin with; narrow it to a city or state if you ever need to" summary={areaSummary} Form={OperatingAreaForm}
      rows={(v) => (
        <>
          <div className="line"><span className="note">Status</span><span>{v.enabled ? <Pill tone="green">Limited to these areas</Pill> : <Pill>No limit</Pill>}</span></div>
          {v.areas.map((a) => <div className="line" key={a.name}><span className="note">{a.name}</span><span>{a.radiusKm} km around {a.lat.toFixed(3)}, {a.lng.toFixed(3)}</span></div>)}
        </>
      )} />
  );
}
