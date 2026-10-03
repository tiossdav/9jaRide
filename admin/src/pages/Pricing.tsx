import { useState } from 'react';
import { del, post } from '../api';
import { Toast, useAction, useConfirm } from '../bits';
import { Loading, Modal, dateTime, naira, title, useLoad } from '../ui';

interface Version {
  id: string; category: string; zone: string; effectiveFrom: string; baseKobo: number; perKmKobo: number; perMinuteKobo: number; waitingPerMinuteKobo: number;
  freeWaitingSeconds: number; taxKobo: number; roundingStepKobo: number; estimateLowBps: number; estimateHighBps: number; state: 'live' | 'scheduled' | 'pending' | 'superseded';
}

const CHIP = { live: 'chip', scheduled: 'chip blue', pending: 'chip amber', superseded: 'chip grey' } as const;
const LABEL = { live: 'Live', scheduled: 'Scheduled', pending: 'Awaiting approval', superseded: 'Replaced' } as const;
const label = (c: string) => title(c === 'package' ? 'send package' : c);

/** Local date-time input value ("2026-10-05T09:00") for a Date. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const toKobo = (n: string) => Math.round(Number(n) * 100);

function ProposeModal({ base, category, onClose, onDone }: { base?: Version; category: string; onClose: () => void; onDone: () => void }) {
  const naira2 = (k?: number) => (k == null ? '' : String(k / 100));
  const [cat, setCat] = useState(category);
  const [when, setWhen] = useState(localInput(new Date(Date.now() + 24 * 3600_000)));
  const [f, setF] = useState({
    base: naira2(base?.baseKobo), perKm: naira2(base?.perKmKobo), perMin: naira2(base?.perMinuteKobo), wait: naira2(base?.waitingPerMinuteKobo),
    free: String(Math.round((base?.freeWaitingSeconds ?? 0) / 60)), tax: naira2(base?.taxKobo), round: naira2(base?.roundingStepKobo ?? 1000),
    low: String((base?.estimateLowBps ?? 8500) / 100), high: String((base?.estimateHighBps ?? 11000) / 100),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') });
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const filled = Object.values(f).every((v) => v !== '') && new Date(when).getTime() > Date.now() + 10 * 60_000;
  const money: [keyof typeof f, string][] = [['base', 'Base fare (₦)'], ['perKm', 'Distance fee (₦ per km)'], ['perMin', 'Time fee (₦ per minute)'], ['wait', 'Waiting fee (₦ per minute)'], ['tax', 'Daily tax fee (₦)'], ['round', 'Round the total to the nearest (₦)']];
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Propose new fees</h3>
      <div className="note">Nothing changes until a different admin approves this and the start time arrives. Trips already in progress keep their old fees.</div>
      <div className="grid g2">
        <div className="field"><label htmlFor="pc">Category</label><select id="pc" className="select" value={cat} onChange={(e) => setCat(e.target.value)}>{['regular', 'comfort', 'package'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
        <div className="field"><label htmlFor="pw">Starts</label><input id="pw" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        {money.map(([k, l]) => <div className="field" key={k}><label htmlFor={`f-${k}`}>{l}</label><input id={`f-${k}`} className="input" inputMode="decimal" value={f[k]} onChange={set(k)} /></div>)}
        <div className="field"><label htmlFor="f-free">Free waiting (minutes)</label><input id="f-free" className="input" inputMode="numeric" value={f.free} onChange={set('free')} /></div>
        <div className="field"><label htmlFor="f-low">Estimate range, low (% of expected)</label><input id="f-low" className="input" inputMode="decimal" value={f.low} onChange={set('low')} /></div>
        <div className="field"><label htmlFor="f-high">Estimate range, high (% of expected)</label><input id="f-high" className="input" inputMode="decimal" value={f.high} onChange={set('high')} /></div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !filled} onClick={() => confirm.ask({ title: `Propose new ${label(cat)} fees?`, text: `Starting ${new Date(when).toLocaleString('en-GB')}. A different admin must approve before it counts.`, confirm: 'Yes, propose' }, () => run(() => post('/admin/console/pricing', {
          category: cat, effectiveFrom: new Date(when).toISOString(), baseKobo: toKobo(f.base), perKmKobo: toKobo(f.perKm), perMinuteKobo: toKobo(f.perMin), waitingPerMinuteKobo: toKobo(f.wait),
          freeWaitingSeconds: Math.round(Number(f.free) * 60), taxKobo: toKobo(f.tax), roundingStepKobo: toKobo(f.round), estimateLowBps: Math.round(Number(f.low) * 100), estimateHighBps: Math.round(Number(f.high) * 100),
        }), () => { onDone(); onClose(); }))}>{busy ? 'Saving…' : 'Propose'}</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

export default function Pricing() {
  const { data, error, reload } = useLoad<Version[]>('/admin/console/pricing');
  const [category, setCategory] = useState('');
  const [proposing, setProposing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  const confirm = useConfirm();
  if (!data) return <Loading error={error} retry={reload} />;
  const cats = [...new Set(data.map((v) => v.category))];
  const cat = category || cats[0] || 'regular';
  const versions = data.filter((v) => v.category === cat);
  const live = versions.find((v) => v.state === 'live');
  const pending = versions.filter((v) => v.state === 'pending');
  return (
    <>
      <div className="head"><div><h1>Trip Fees</h1><div className="sub">The items that make up trip fares</div></div><div className="grow" /><button className="btn" onClick={() => setProposing(true)}>Propose new fees</button></div>
      <div className="banner">Every change is saved as a new version with a start time, and a different admin must approve it. Trips in progress keep the version they started with.</div>
      <div className="seg">{['regular', 'comfort', 'package'].map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCategory(c)}>{label(c)}</button>)}</div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--gold)' }}>
          <h3>Waiting for approval</h3>
          {pending.map((v) => (
            <div className="line" key={v.id}>
              <span>Starts {dateTime(v.effectiveFrom)} · base {naira(v.baseKobo)} · {naira(v.perKmKobo)}/km · {naira(v.perMinuteKobo)}/min · tax {naira(v.taxKobo)}</span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <button className="btn" style={{ height: 30 }} disabled={act.busy} onClick={() => confirm.ask({ title: 'Approve these fees?', text: `They apply to ${label(v.category)} trips from ${dateTime(v.effectiveFrom)}. Once approved they can never be edited.`, confirm: 'Yes, approve' }, () => act.run(() => post(`/admin/console/pricing/${v.id}/approve`), () => { setToast('Fees approved'); reload(); }))}>Approve</button>{' '}
                <button className="btn outline-red" style={{ height: 30 }} disabled={act.busy} onClick={() => confirm.ask({ title: 'Discard this proposal?', text: 'It is removed. The current fees stay as they are.', confirm: 'Yes, discard', danger: true }, () => act.run(() => del(`/admin/console/pricing/${v.id}`), () => { setToast('Proposal discarded'); reload(); }))}>Discard</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {live ? (
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          <table><thead><tr><th>Trip fare</th><th className="num">Amount</th><th>Type</th><th>Effective from</th><th>Status</th></tr></thead><tbody>
            {([
              ['Base fare', naira(live.baseKobo), 'Flat'], ['Distance fee', `${naira(live.perKmKobo)} / km`, 'Flat'], ['Time fee', `${naira(live.perMinuteKobo)} / min`, 'Flat'],
              ['Waiting fee', `${naira(live.waitingPerMinuteKobo)} / min`, 'Flat'], ['Allowed waiting', `${Math.round(live.freeWaitingSeconds / 60)} minutes`, 'Minutes'],
              ['Daily tax fee', naira(live.taxKobo), 'Flat'], ['Rounding step', naira(live.roundingStepKobo), 'Nearest'],
              ['Estimate range', `${live.estimateLowBps / 100}% to ${live.estimateHighBps / 100}%`, 'Percent'],
            ] as const).map(([name, amount, type]) => (
              <tr key={name}><td>{name}</td><td className="num">{amount}</td><td>{type}</td><td>{dateTime(live.effectiveFrom)}</td><td><span className="chip">Live</span></td></tr>
            ))}
          </tbody></table>
        </div>
      ) : <div className="banner">No fees are live for {label(cat)}, so riders cannot book this category. Propose fees to get started.</div>}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 18px 4px' }}><h3>Version history</h3></div>
        <table><thead><tr><th>Effective from</th><th className="num">Base</th><th className="num">Per km</th><th className="num">Per min</th><th className="num">Waiting / min</th><th className="num">Tax</th><th>Status</th></tr></thead><tbody>
          {versions.map((v) => (
            <tr key={v.id}><td>{dateTime(v.effectiveFrom)}</td><td className="num">{naira(v.baseKobo)}</td><td className="num">{naira(v.perKmKobo)}</td><td className="num">{naira(v.perMinuteKobo)}</td>
              <td className="num">{naira(v.waitingPerMinuteKobo)}</td><td className="num">{naira(v.taxKobo)}</td><td><span className={CHIP[v.state]}>{LABEL[v.state]}</span></td></tr>
          ))}
        </tbody></table>
      </div>
      {proposing && <ProposeModal base={live} category={cat} onClose={() => setProposing(false)} onDone={() => { setToast('Sent for approval'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}
