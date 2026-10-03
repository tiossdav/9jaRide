import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api';
import { Segmented, SearchBox, Toast, useAction, useConfirm, go } from '../bits';
import { Icon, Loading, Modal, Pill, Stat, dateTime, initials, title, useLoad } from '../ui';

export type StaffRole = 'support' | 'finance' | 'admin';
interface Member { id: string; name: string; email: string; phone: string | null; role: StaffRole; active: boolean; pendingFirstLogin: boolean; lastLoginAt: string | null; createdAt: string; invitedBy: string | null }
interface Detail extends Member { recent: { method: string; path: string; status: number | null; at: string }[] }

export const ROLE_TEXT: Record<StaffRole, { label: string; blurb: string }> = {
  admin: { label: 'Admin', blurb: 'Everything, including the team, activity logs and money approvals.' },
  finance: { label: 'Finance', blurb: 'Wallet, payouts, adjustments and reconciliation. Approves money requests.' },
  support: { label: 'Support', blurb: 'Operations: trips, drivers, customers, safety. Can request adjustments, not approve them.' },
};

const stateOf = (m: Member) => (!m.active ? <Pill tone="red">Switched off</Pill> : m.pendingFirstLogin ? <Pill tone="amber">Pending</Pill> : <Pill tone="green">Active</Pill>);

/** Shows a one-time password exactly once, with a copy button. */
function PasswordModal({ who, password, onClose }: { who: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>One-time password for {who}</h3>
      <div className="sub">Send it to them privately. It is shown only now and cannot be looked up again. They must choose their own password at first sign-in.</div>
      <div className="input" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15, userSelect: 'all' }}>{password}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* select and copy by hand */ } }}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn" onClick={onClose}>I have passed it on</button>
      </div>
    </Modal>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: (who: string, pw: string) => void }) {
  const [first, setFirst] = useState(''); const [last, setLast] = useState('');
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('support');
  const confirm = useConfirm();
  const valid = first.trim().length >= 1 && last.trim().length >= 1 && /^\S+@\S+\.\S+$/.test(email);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Invite team member</h3>
      <div className="grid g2">
        <div className="field"><label htmlFor="fn">First name</label><input id="fn" className="input" placeholder="Ada" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="ln">Last name</label><input id="ln" className="input" placeholder="Okonkwo" value={last} onChange={(e) => setLast(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="em">Email address</label><input id="em" className="input" type="email" placeholder="name@9jaridepro.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="grid g2">
        <div className="field"><label htmlFor="ph">Phone number</label><input id="ph" className="input" placeholder="0803 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label htmlFor="rl">Role</label><select id="rl" className="select" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>{(Object.keys(ROLE_TEXT) as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_TEXT[r].label}</option>)}</select></div>
      </div>
      <div className="note">{ROLE_TEXT[role].blurb}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!valid} onClick={() => confirm.ask({ title: `Create an account for ${first.trim()} ${last.trim()}?`, text: `They get ${ROLE_TEXT[role].label} access. ${ROLE_TEXT[role].blurb}`, confirm: 'Yes, create account' }, () => go(async () => {
          const r = await post<{ temporaryPassword: string }>('/admin/team', { email: email.trim(), fullName: `${first.trim()} ${last.trim()}`, role, ...(phone.trim() ? { phone: phone.trim() } : {}) });
          onDone(`${first.trim()} ${last.trim()}`, r.temporaryPassword);
        }))}>Create account</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

export function Members() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | StaffRole>('all');
  const { data, error, reload } = useLoad<Member[]>(`/admin/team${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const [inviting, setInviting] = useState(false);
  const [shown, setShown] = useState<{ who: string; pw: string } | null>(null);
  if (!data) return <Loading error={error} retry={reload} />;
  const rows = data.filter((m) => filter === 'all' || m.role === filter);
  return (
    <>
      <div className="head"><div><h1>Team Members</h1><div className="sub">{data.length} people can sign in to this portal</div></div><div className="grow" /><button className="btn" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> Invite Member</button></div>
      <div className="stats">
        <Stat icon="users" label="Members" value={data.length} />
        <Stat icon="check" label="Active" value={data.filter((m) => m.active && !m.pendingFirstLogin).length} />
        <Stat icon="clock" label="Pending first sign-in" value={data.filter((m) => m.active && m.pendingFirstLogin).length} tone="amber" />
      </div>
      <div style={{ display: 'flex', gap: 12, margin: '14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchBox placeholder="Search members" onSearch={setSearch} />
        <Segmented options={[['all', 'All'], ['admin', 'Admin'], ['finance', 'Finance'], ['support', 'Support']] as const} value={filter} onChange={setFilter} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? <div className="empty">No members match.</div> : (
          <table><thead><tr><th>Member</th><th>Phone</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Joined</th></tr></thead><tbody>
            {rows.map((m) => (
              <tr key={m.id} className="link" onClick={() => nav(`/team/${m.id}`)}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(m.name)}</div><div>{m.name}<div className="note">{m.email}</div></div></div></td>
                <td>{m.phone ?? '-'}</td><td><Pill tone="green">{ROLE_TEXT[m.role].label}</Pill></td><td>{stateOf(m)}</td><td>{m.lastLoginAt ? dateTime(m.lastLoginAt) : 'Never'}</td><td>{dateTime(m.createdAt)}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {inviting && <InviteModal onClose={() => setInviting(false)} onDone={(who, pw) => { setInviting(false); setShown({ who, pw }); reload(); }} />}
      {shown && <PasswordModal who={shown.who} password={shown.pw} onClose={() => setShown(null)} />}
    </>
  );
}

export function MemberDetail() {
  const { id } = useParams();
  const { data: m, error, reload } = useLoad<Detail>(`/admin/team/${id}`);
  const [tab, setTab] = useState<'profile' | 'activity' | 'permissions'>('profile');
  const [shown, setShown] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  const confirm = useConfirm();
  if (!m) return <Loading error={error} retry={reload} />;
  const done = (t: string) => () => { setToast(t); reload(); };
  return (
    <>
      <Link to="/team" className="note">← Back to Members</Link>
      <div className="card" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 20 }}>{initials(m.name)}</div>
        <div className="grow"><h1 style={{ fontSize: 22, fontWeight: 800 }}>{m.name}</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}><Pill tone="green">{ROLE_TEXT[m.role].label}</Pill>{stateOf(m)}{m.invitedBy && <span className="note">Invited by {m.invitedBy}</span>}</div>
          <div className="note" style={{ marginTop: 6 }}>{m.email}{m.phone ? ` · ${m.phone}` : ''}</div></div>
        <select className="select" style={{ width: 150 }} aria-label="Role" value={m.role} onChange={(e) => { const role = e.target.value as StaffRole; confirm.ask({ title: `Make ${m.name} ${ROLE_TEXT[role].label}?`, text: `${ROLE_TEXT[role].blurb} They are signed out and use the new role at their next sign-in.`, confirm: 'Yes, change role' }, () => go(() => post(`/admin/team/${m.id}/role`, { role }), done('Role changed. They sign in again to use it.'))); }}>
          {(Object.keys(ROLE_TEXT) as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_TEXT[r].label}</option>)}</select>
        <button className="btn ghost" disabled={act.busy} onClick={() => confirm.ask({ title: `Reset ${m.name}'s password?`, text: 'Their current password stops working and they are signed out. You get a one-time password to pass on.', confirm: 'Yes, reset' }, () => go(async () => { const r = await post<{ temporaryPassword: string }>(`/admin/team/${m.id}/reset-password`); setShown(r.temporaryPassword); }))}>Reset password</button>
        {m.active
          ? <button className="btn outline-red" disabled={act.busy} onClick={() => confirm.ask({ title: `Switch off ${m.name}?`, text: 'They are signed out and cannot sign in until you restore access.', confirm: 'Yes, switch off', danger: true }, () => go(() => post(`/admin/team/${m.id}/active`, { active: false }), done('Access switched off')))}>Switch off</button>
          : <button className="btn" disabled={act.busy} onClick={() => confirm.ask({ title: `Restore access for ${m.name}?`, text: 'They can sign in again with their current password.', confirm: 'Yes, restore' }, () => go(() => post(`/admin/team/${m.id}/active`, { active: true }), done('Access restored')))}>Restore access</button>}
      </div>
      {act.error && <div className="banner error" role="alert" style={{ marginTop: 14 }}>{act.error}</div>}
      <div className="pilltabs" style={{ marginTop: 14 }}>
        {(['profile', 'activity', 'permissions'] as const).map((t) => <button key={t} className={'pilltab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{title(t)}</button>)}
      </div>
      {tab === 'profile' && (
        <div className="grid g2">
          <div className="card"><h3>Security and access</h3>
            <div className="line"><span className="note">Account status</span><span>{stateOf(m)}</span></div>
            <div className="line"><span className="note">Role</span><span>{ROLE_TEXT[m.role].label}</span></div>
            <div className="line"><span className="note">Last sign-in</span><span>{m.lastLoginAt ? dateTime(m.lastLoginAt) : 'Never'}</span></div></div>
          <div className="card"><h3>Personal information</h3>
            <div className="line"><span className="note">Full name</span><span>{m.name}</span></div>
            <div className="line"><span className="note">Email</span><span>{m.email}</span></div>
            <div className="line"><span className="note">Phone</span><span>{m.phone ?? '-'}</span></div>
            <div className="line"><span className="note">Joined</span><span>{dateTime(m.createdAt)}</span></div></div>
        </div>
      )}
      {tab === 'activity' && (
        <div className="card" style={{ padding: 0 }}>
          {m.recent.length === 0 ? <div className="empty">No changes made yet.</div> : (
            <table><thead><tr><th>When</th><th>Request</th><th>Result</th></tr></thead><tbody>
              {m.recent.map((l, i) => <tr key={i}><td>{dateTime(l.at)}</td><td className="note" style={{ fontFamily: 'ui-monospace, monospace' }}>{l.method} {l.path.replace(/\?.*$/, '')}</td><td>{l.status != null && l.status < 400 ? <span className="chip">Done</span> : <span className="chip red">Refused {l.status ?? ''}</span>}</td></tr>)}
            </tbody></table>
          )}
        </div>
      )}
      {tab === 'permissions' && <div className="card"><h3>{ROLE_TEXT[m.role].label}</h3><p style={{ marginTop: 6 }}>{ROLE_TEXT[m.role].blurb}</p><p className="note" style={{ marginTop: 10 }}>See Roles for the full list of what each role can open.</p></div>}
      {confirm.node}
      {shown && <PasswordModal who={m.name} password={shown} onClose={() => setShown(null)} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- roles (fixed in the server)

const MODULES: [string, Record<StaffRole, string>][] = [
  ['Dashboard and live operations', { admin: 'View', support: 'View', finance: '-' }],
  ['Safety Center (SOS)', { admin: 'View and act', support: 'View and act', finance: '-' }],
  ['Drivers and onboarding', { admin: 'View and act', support: 'View and act', finance: '-' }],
  ['Customers, vehicles and trips', { admin: 'View', support: 'View', finance: '-' }],
  ['Suspend and reinstate accounts', { admin: 'Yes', support: 'Yes', finance: '-' }],
  ['Request refunds and adjustments', { admin: 'Yes', support: 'Yes', finance: 'Yes' }],
  ['Approve adjustments and payouts', { admin: 'Yes', support: '-', finance: 'Yes' }],
  ['Wallet, reconciliation and payment exceptions', { admin: 'View and act', support: '-', finance: 'View and act' }],
  ['Trip fees', { admin: 'View', support: 'View', finance: '-' }],
  ['Team and roles', { admin: 'Yes', support: '-', finance: '-' }],
  ['Activity logs', { admin: 'View', support: '-', finance: '-' }],
];

export function Roles() {
  const { data } = useLoad<Member[]>('/admin/team');
  const roles = Object.keys(ROLE_TEXT) as StaffRole[];
  return (
    <>
      <div className="head"><div><h1>Roles &amp; Permissions</h1><div className="sub">What each role can open on the platform</div></div></div>
      <div className="banner">These three roles are enforced by the server, so they cannot be edited here. Custom roles would need server changes first.</div>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        {roles.map((r) => (
          <div className="card" key={r}><div className="cardhead"><div><h3>{ROLE_TEXT[r].label}</h3><div className="hint">{ROLE_TEXT[r].blurb}</div></div></div>
            <div className="total" style={{ fontSize: 22 }}>{data ? data.filter((m) => m.role === r && m.active).length : '-'}<span className="note" style={{ fontWeight: 500 }}> active</span></div></div>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table><thead><tr><th>Area</th>{roles.map((r) => <th key={r}>{ROLE_TEXT[r].label}</th>)}</tr></thead><tbody>
          {MODULES.map(([name, access]) => (
            <tr key={name}><td>{name}</td>{roles.map((r) => <td key={r}>{access[r] === '-' ? <span className="note">No access</span> : <span className="chip">{access[r]}</span>}</td>)}</tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}

