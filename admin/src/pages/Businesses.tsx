import { useState } from 'react';
import { post } from '../api';
import { Toast, go, useConfirm } from '../bits';
import { Loading, Modal, Pill, Stat, dateTime, naira, useLoad } from '../ui';
import { Business } from './Fleet';

interface Login { id: string; name: string; email: string; active: boolean; lastLoginAt: string | null; pendingFirstLogin: boolean }

/** The businesses that supply vehicles: add one, set its usual share, and give people at it a login to manage its fleet. */
export default function Businesses() {
  const { data, error, reload } = useLoad<Business[]>('/fleet/businesses');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Business | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      <div className="head"><div><h1>Businesses</h1><div className="sub">Companies that supply vehicles to drivers</div></div><div className="grow" /><button className="btn" onClick={() => setAdding(true)}>Add business</button></div>
      {!data ? <Loading error={error} retry={reload} /> : (
        <>
          <div className="stats">
            <Stat icon="users" label="Businesses" value={data.length} />
            <Stat icon="car" label="Vehicles" value={data.reduce((n, b) => n + b.vehicles, 0)} />
            <Stat icon="steer" label="Drivers paying toward a vehicle" value={data.reduce((n, b) => n + b.drivers, 0)} tone="blue" />
            <Stat icon="wallet" label="Collected for businesses" value={naira(data.reduce((n, b) => n + b.collectedKobo, 0))} tone="green" />
          </div>
          <div className="card" style={{ padding: 0, marginTop: 14 }}>
            {data.length === 0 ? <div className="empty">No businesses yet. Add one, then import its vehicles.</div> : (
              <table><thead><tr><th>Business</th><th>Contact</th><th className="num">Vehicles</th><th className="num">Drivers</th><th className="num">Usual share</th><th className="num">Collected</th><th /></tr></thead><tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b>{b.status !== 'active' && <> <Pill tone="red">Suspended</Pill></>}</td>
                    <td>{b.contactName ?? '-'}<div className="note">{b.phone ?? b.email ?? ''}</div></td>
                    <td className="num">{b.vehicles}</td><td className="num">{b.drivers}</td><td className="num">{b.defaultDeductionBps / 100}%</td><td className="num">{naira(b.collectedKobo)}</td>
                    <td><button className="btn ghost" style={{ height: 28 }} onClick={() => setOpen(b)}>Logins</button></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
        </>
      )}
      {adding && <AddBusiness onClose={() => setAdding(false)} onDone={() => { setToast('Business added'); reload(); }} />}
      {open && <Logins business={open} onClose={() => setOpen(null)} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function AddBusiness({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(''); const [contact, setContact] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [percent, setPercent] = useState('20');
  const confirm = useConfirm();
  const bps = Math.round(Number(percent) * 100);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Add a business</h3>
      <div className="field"><label htmlFor="bn">Business name</label><input id="bn" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid g2">
        <div className="field"><label htmlFor="bc">Contact person</label><input id="bc" className="input" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
        <div className="field"><label htmlFor="bp">Phone</label><input id="bp" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label htmlFor="be">Email</label><input id="be" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="bs">Usual share of a driver&apos;s earnings (%)</label><input id="bs" className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={name.trim().length < 2 || !(bps >= 0 && bps <= 9000)} onClick={() => confirm.ask({ title: `Add ${name.trim()}?`, text: 'You can then add its vehicles and give people there a login.', confirm: 'Yes, add' },
          () => go(() => post('/fleet/businesses', { name: name.trim(), ...(contact.trim() ? { contactName: contact.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), defaultDeductionBps: bps }), () => { onDone(); onClose(); }))}>Add business</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

function Logins({ business, onClose }: { business: Business; onClose: () => void }) {
  const { data, reload } = useLoad<Login[]>(`/fleet/businesses/${business.id}/users`);
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const confirm = useConfirm();
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Logins for {business.name}</h3>
      <div className="note">People here sign in to this portal and see only {business.name}&apos;s vehicles.</div>
      {made ? (
        <div className="banner" role="status">
          Account made for <b>{made.email}</b>. Pass on this one-time password; they change it at their first sign-in.
          <div className="input" style={{ marginTop: 8, fontFamily: 'monospace' }}>{made.password}</div>
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setMade(null)}>I have passed it on</button>
        </div>
      ) : (
        <>
          {(data ?? []).map((u) => (
            <div className="line" key={u.id}><span>{u.name}<div className="note">{u.email} · {u.pendingFirstLogin ? 'has not signed in yet' : u.lastLoginAt ? `last in ${dateTime(u.lastLoginAt)}` : ''}</div></span>
              <span style={{ display: 'flex', gap: 6 }}>
                {u.active ? <button className="btn ghost" style={{ height: 28 }} onClick={() => confirm.ask({ title: `Switch off ${u.name}?`, text: 'They are signed out and cannot sign in until switched on again.', confirm: 'Yes, switch off', danger: true }, () => go(() => post(`/admin/team/${u.id}/active`, { active: false }), reload))}>Switch off</button>
                  : <button className="btn ghost" style={{ height: 28 }} onClick={() => go(() => post(`/admin/team/${u.id}/active`, { active: true }), reload)}>Switch on</button>}
                <button className="btn ghost" style={{ height: 28 }} onClick={() => confirm.ask({ title: `New password for ${u.name}?`, text: 'A new one-time password replaces the old one, and they are signed out.', confirm: 'Yes, reset' }, () => go(async () => { const r = await post<{ temporaryPassword: string }>(`/admin/team/${u.id}/reset-password`); setMade({ email: u.email, password: r.temporaryPassword }); }))}>Reset password</button>
              </span></div>))}
          {data && data.length === 0 && <div className="note">Nobody can sign in for this business yet.</div>}
          <h3 style={{ fontSize: 14, marginTop: 6 }}>Add a login</h3>
          <div className="grid g2">
            <div className="field"><label htmlFor="ln">Full name</label><input id="ln" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="le">Email address</label><input id="le" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose}>Close</button>
            <button className="btn" disabled={name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email)} onClick={() => confirm.ask({ title: `Create a login for ${name.trim()}?`, text: `They will manage ${business.name}'s vehicles only.`, confirm: 'Yes, create' },
              () => go(async () => { const r = await post<{ temporaryPassword: string }>('/admin/team', { email: email.trim(), fullName: name.trim(), role: 'business', businessId: business.id }); setMade({ email: email.trim(), password: r.temporaryPassword }); setName(''); setEmail(''); reload(); }))}>Create login</button>
          </div>
        </>
      )}
      {confirm.node}
    </Modal>
  );
}
