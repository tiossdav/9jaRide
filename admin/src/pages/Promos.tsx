import { useState } from 'react';
import { call, post } from '../api';
import { Toast, go, useConfirm } from '../bits';
import { Loading, Modal, Pill, Stat, dateTime, naira, title, useLoad } from '../ui';

interface Promo {
  id: string; code: string; description: string; kind: 'percent' | 'fixed'; value: number; maxDiscountKobo: number | null; minFareKobo: number;
  categories: string[] | null; startsAt: string; endsAt: string | null; maxUses: number | null; perRiderLimit: number; active: boolean; uses: number; givenKobo: number;
  state: 'live' | 'scheduled' | 'expired' | 'used_up' | 'off';
}
interface Use { rideId: string; code: string; status: string; at: string; rider: string; discountKobo: number | null }
interface AssetType { code: string; label: string }

const STATE = { live: ['green', 'Live'], scheduled: ['blue', 'Scheduled'], expired: ['grey', 'Expired'], used_up: ['amber', 'Used up'], off: ['red', 'Switched off'] } as const;
const worth = (p: Promo) => (p.kind === 'percent' ? `${p.value / 100}% off${p.maxDiscountKobo ? `, up to ${naira(p.maxDiscountKobo)}` : ''}` : `${naira(p.value)} off`);
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function Promos() {
  const { data, error, reload } = useLoad<Promo[]>('/admin/promos');
  const [editing, setEditing] = useState<Promo | 'new' | null>(null);
  const [viewing, setViewing] = useState<Promo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!data) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="head"><div><h1>Promo</h1><div className="sub">Discount codes riders type when booking. The platform pays for every discount; drivers are paid in full.</div></div><div className="grow" /><button className="btn" onClick={() => setEditing('new')}>+ Create Promo</button></div>
      <div className="stats">
        <Stat icon="tag" label="Codes" value={data.length} />
        <Stat icon="check" label="Live now" value={data.filter((p) => p.state === 'live').length} tone="green" />
        <Stat icon="users" label="Times used" value={data.reduce((n, p) => n + p.uses, 0)} />
        <Stat icon="wallet" label="Given in discounts" value={naira(data.reduce((n, p) => n + p.givenKobo, 0))} tone="amber" />
      </div>
      <div className="card" style={{ padding: 0, marginTop: 14 }}>
        {data.length === 0 ? <div className="empty">No promo codes yet.</div> : (
          <table><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Runs</th><th className="num">Used</th><th className="num">Given</th><th>State</th><th /></tr></thead><tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td><b>{p.code}</b><div className="note">{p.description}</div></td><td>{worth(p)}{p.minFareKobo > 0 && <div className="note">fares from {naira(p.minFareKobo)}</div>}</td>
                <td>{p.categories ? p.categories.map((c) => title(c)).join(', ') : 'Every category'}</td>
                <td className="note">{dateTime(p.startsAt)}{p.endsAt ? ` to ${dateTime(p.endsAt)}` : ' onwards'}</td>
                <td className="num">{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}</td><td className="num">{naira(p.givenKobo)}</td>
                <td><Pill tone={STATE[p.state][0]}>{STATE[p.state][1]}</Pill></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost" style={{ height: 30 }} onClick={() => setViewing(p)}>Uses</button>{' '}
                  <button className="btn ghost" style={{ height: 30 }} onClick={() => setEditing(p)}>Edit</button>{' '}
                  <button className={'btn ' + (p.active ? 'outline-red' : '')} style={{ height: 30 }} onClick={() => confirm.ask(p.active ? { title: `Switch off ${p.code}?`, text: 'Riders can no longer use it. Trips that already have it keep their discount.', confirm: 'Yes, switch off', danger: true } : { title: `Switch on ${p.code}?`, confirm: 'Yes, switch on' }, () => go(() => call('PATCH', `/admin/promos/${p.id}`, { active: !p.active }), () => { setToast(p.active ? 'Switched off' : 'Switched on'); reload(); }))}>{p.active ? 'Off' : 'On'}</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {editing && <PromoForm promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(t) => { setToast(t); reload(); }} />}
      {viewing && <UsesModal promo={viewing} onClose={() => setViewing(null)} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function PromoForm({ promo, onClose, onDone }: { promo: Promo | null; onClose: () => void; onDone: (t: string) => void }) {
  const { data: types } = useLoad<AssetType[]>('/admin/asset-types');
  const [code, setCode] = useState(promo?.code ?? '');
  const [description, setDescription] = useState(promo?.description ?? '');
  const [kind, setKind] = useState<'percent' | 'fixed'>(promo?.kind ?? 'percent');
  const [value, setValue] = useState(promo ? String(promo.kind === 'percent' ? promo.value / 100 : promo.value / 100) : '');
  const [cap, setCap] = useState(promo?.maxDiscountKobo ? String(promo.maxDiscountKobo / 100) : '');
  const [minFare, setMinFare] = useState(promo?.minFareKobo ? String(promo.minFareKobo / 100) : '');
  const [cats, setCats] = useState<string[]>(promo?.categories ?? []);
  const [starts, setStarts] = useState(localInput(promo ? new Date(promo.startsAt) : new Date()));
  const [ends, setEnds] = useState(promo?.endsAt ? localInput(new Date(promo.endsAt)) : '');
  const [maxUses, setMaxUses] = useState(promo?.maxUses ? String(promo.maxUses) : '');
  const [perRider, setPerRider] = useState(String(promo?.perRiderLimit ?? 1));
  const confirm = useConfirm();
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const v = n(value);
  const ok = /^[A-Za-z0-9]{3,20}$/.test(code) && v > 0 && (kind !== 'percent' || v <= 100) && Number.isInteger(n(perRider)) && n(perRider) >= 1 && (!ends || new Date(ends) > new Date(starts));
  const body = () => ({
    ...(promo ? {} : { code: code.toUpperCase(), kind }), description,
    value: Math.round(v * (kind === 'percent' ? 100 : 100)), // percent → basis points; naira → kobo
    maxDiscountKobo: cap ? Math.round(n(cap) * 100) : 0, minFareKobo: minFare ? Math.round(n(minFare) * 100) : 0,
    categories: cats, startsAt: new Date(starts).toISOString(), endsAt: ends ? new Date(ends).toISOString() : null,
    maxUses: maxUses ? n(maxUses) : null, perRiderLimit: n(perRider),
  });
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{promo ? `Edit ${promo.code}` : 'Create a promo code'}</h3>
      <div className="grid g2">
        <div className="field"><label htmlFor="pc">Code</label><input id="pc" className="input" placeholder="WELCOME10" value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} disabled={!!promo} /></div>
        <div className="field"><label htmlFor="pk">Type</label><select id="pk" className="select" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')} disabled={!!promo}><option value="percent">Percentage off</option><option value="fixed">Fixed amount off</option></select></div>
        <div className="field"><label htmlFor="pv">{kind === 'percent' ? 'Percent off' : 'Amount off (₦)'}</label><input id="pv" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
        <div className="field"><label htmlFor="pcap">Biggest discount (₦, optional)</label><input id="pcap" className="input" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
        <div className="field"><label htmlFor="pmin">Smallest fare it applies to (₦)</label><input id="pmin" className="input" inputMode="decimal" value={minFare} onChange={(e) => setMinFare(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
        <div className="field"><label htmlFor="ppr">Uses per rider</label><input id="ppr" className="input" inputMode="numeric" value={perRider} onChange={(e) => setPerRider(e.target.value.replace(/[^0-9]/g, ''))} /></div>
        <div className="field"><label htmlFor="pst">Starts</label><input id="pst" className="input" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
        <div className="field"><label htmlFor="pen">Ends (optional)</label><input id="pen" className="input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />{ends && new Date(ends) <= new Date(starts) && <div className="error">Must end after it starts.</div>}</div>
        <div className="field"><label htmlFor="pmu">Total uses (blank for unlimited)</label><input id="pmu" className="input" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ''))} /></div>
        <div className="field"><label htmlFor="pd">Note for your team</label><input id="pd" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></div>
      </div>
      <div className="field"><label>Applies to</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(types ?? []).map((t) => <button key={t.code} type="button" className={'pilltab' + (cats.includes(t.code) ? ' on' : '')} onClick={() => setCats(cats.includes(t.code) ? cats.filter((c) => c !== t.code) : [...cats, t.code])}>{t.label}</button>)}
        </div>
        <div className="note">{cats.length === 0 ? 'Every category.' : `Only ${cats.length} chosen.`}</div></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask({ title: promo ? `Save changes to ${promo.code}?` : `Create ${code.toUpperCase()}?`, text: 'The platform pays for every discount. Riders can use it as soon as it starts.', confirm: promo ? 'Yes, save' : 'Yes, create' }, () => go(() => (promo ? call('PATCH', `/admin/promos/${promo.id}`, body()) : post('/admin/promos', body())), () => { onDone(promo ? 'Saved' : 'Created'); onClose(); }))}>{promo ? 'Save' : 'Create'}</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

function UsesModal({ promo, onClose }: { promo: Promo; onClose: () => void }) {
  const { data, error, reload } = useLoad<Use[]>(`/admin/promos/${promo.id}/uses`);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Uses of {promo.code}</h3>
      {!data ? <Loading error={error} retry={reload} /> : data.length === 0 ? <div className="empty">Nobody has used it yet.</div> : (
        <div style={{ maxHeight: 360, overflow: 'auto' }}><table><thead><tr><th>When</th><th>Rider</th><th>Trip</th><th className="num">Discount</th></tr></thead><tbody>
          {data.map((u) => <tr key={u.rideId}><td>{dateTime(u.at)}</td><td>{u.rider}</td><td>{u.code}<div className="note">{title(u.status)}</div></td><td className="num">{u.discountKobo == null ? '-' : naira(u.discountKobo)}</td></tr>)}
        </tbody></table></div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
