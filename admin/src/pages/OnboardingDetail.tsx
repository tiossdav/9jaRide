import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { openFile, post } from '../api';
import { ReasonModal, Toast, go, kv, useAction, useConfirm } from '../bits';
import { Loading, Modal, Pill, arrangementLabel, dateTime, title, useLoad } from '../ui';
import { AssignModal } from './AssignVehicle';

interface App {
  id: string; driverId: string; driverName: string; phone: string; status: string; accountStatus: string;
  arrangement: string; owner: { name: string; phone: string } | null;
  vehicle: { category: string; make: string | null; colour: string | null; plate: string | null };
  approvedCategory: string | null;
  personal: {
    email: string | null; contactPreference: string | null; dateOfBirth: string | null; nin: string | null; lassdri: string | null; address: string | null;
    nextOfKin: { name: string | null; phone: string | null; relationship: string | null; address: string | null };
  };
  reviewNote: string | null; submittedAt: string; reviewedAt: string | null;
  documents: { kind: string; number: string | null; fileId: string | null; expiresOn: string | null; expired: boolean }[];
  missingDocuments: string[];
}

const CATEGORIES = [['regular', 'Regular'], ['comfort', 'Comfort'], ['package', 'Send Package']] as const;
const label = (c?: string | null) => CATEGORIES.find(([k]) => k === c)?.[1] ?? (c ? title(c) : '-');

export default function OnboardingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: a, error, reload } = useLoad<App>(`/admin/driver-applications/${id}`);
  const [ask, setAsk] = useState<'changes' | 'reject' | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  if (!a) return <Loading error={error} retry={reload} />;
  const open = a.status === 'SUBMITTED';
  const platform = a.arrangement === 'platform_plan';
  const blocked = a.missingDocuments.length > 0 || a.documents.some((d) => d.expired);
  const p = a.personal;

  return (
    <>
      <div className="head">
        <div><Link to="/drivers" className="note">← Drivers</Link><h1>{a.driverName}</h1><div className="sub">Application submitted {dateTime(a.submittedAt)} · {a.phone}</div></div>
        <div className="grow" /><Pill tone={a.status === 'APPROVED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'amber'}>{title(a.status)}</Pill>
      </div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      <div className="grid g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>Personal information</h3>
            {kv('Name', a.driverName)}{kv('Phone number', a.phone)}{kv('Email', p.email ?? '-')}{kv('Contact by', p.contactPreference ? title(p.contactPreference) : '-')}
            {kv('Date of birth', p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '-')}{kv('NIN', p.nin ?? '-')}{kv('LASSDRI number', p.lassdri ?? '-')}{kv('Address', p.address ?? '-')}</div>
          <div className="card"><h3>Next of kin</h3>
            {kv('Name', p.nextOfKin.name ?? '-')}{kv('Phone number', p.nextOfKin.phone ?? '-')}{kv('Relationship', p.nextOfKin.relationship ?? '-')}{kv('Address', p.nextOfKin.address ?? '-')}</div>
          <div className="card"><h3>Vehicle</h3>
            {kv('Arrangement', arrangementLabel(a.arrangement))}
            {platform ? <div className="note" style={{ margin: '6px 0' }}>The driver asked for a platform vehicle. Choose the car and set the payment plan when you approve.</div>
              : <>{kv('Plate number', a.vehicle.plate)}{kv('Model', a.vehicle.make)}{kv('Colour', a.vehicle.colour)}{kv('Owner', a.owner ? `${a.owner.name} · ${a.owner.phone}` : `${a.driverName} (the driver)`)}</>}
            {kv('Category asked for', label(a.vehicle.category))}
            {a.approvedCategory && kv('Category confirmed', <b>{label(a.approvedCategory)}</b>)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {a.reviewNote && <div className="card"><h3>Reviewer note</h3><p style={{ marginTop: 8 }}>{a.reviewNote}</p>{a.reviewedAt && <div className="note" style={{ marginTop: 6 }}>{dateTime(a.reviewedAt)}</div>}</div>}
          <div className="card"><h3>Documents</h3>
            {a.documents.map((d) => kv(title(d.kind), <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {d.number && <span className="note">{d.number}</span>}{d.expiresOn && <span className="note">expires {d.expiresOn.slice(0, 10)}</span>}
              {d.expired ? <span className="chip red">Expired</span> : <span className="chip">On file</span>}
              {d.fileId && <button className="btn ghost" style={{ height: 26, padding: '0 10px' }} onClick={() => act.run(() => openFile(`/files/${d.fileId}`))}>View</button>}</span>))}
            {a.missingDocuments.map((m) => kv(title(m), <span className="chip red">Missing</span>))}</div>
          {open ? (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3>Decision</h3>
              {blocked && <div className="note">Approval is blocked until every required document is present and in date.</div>}
              <button className="btn" disabled={act.busy || blocked} onClick={() => (platform ? setAssigning(true) : setApproving(true))}>{platform ? 'Assign vehicle and approve' : 'Inspect and approve'}</button>
              <button className="btn ghost" onClick={() => setAsk('changes')}>Request changes</button>
              <button className="btn outline-red" onClick={() => setAsk('reject')}>Reject</button>
            </div>
          ) : <div className="card"><h3>Decision</h3><div className="note" style={{ marginTop: 6 }}>This application is closed. {a.status === 'APPROVED' && <Link to={`/people/${a.driverId}`} style={{ color: 'var(--accent)' }}>Open the driver</Link>}</div></div>}
        </div>
      </div>
      {ask === 'changes' && <ReasonModal title="Request changes" text="The driver sees this note and can fix and resubmit." confirm="Send request" onClose={() => setAsk(null)} onSubmit={async (note) => { await post(`/admin/driver-applications/${a.id}/request-changes`, { note }); reload(); }} />}
      {ask === 'reject' && <ReasonModal title="Reject application" confirm="Reject" danger onClose={() => setAsk(null)} onSubmit={async (reason) => { await post(`/admin/driver-applications/${a.id}/reject`, { reason }); nav('/drivers'); }} />}
      {assigning && <AssignModal app={a} onClose={() => setAssigning(false)} onDone={() => { setToast('Driver approved and vehicle assigned'); reload(); }} />}
      {approving && <InspectModal app={a} onClose={() => setApproving(false)} onDone={() => { setToast('Driver approved'); reload(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

/** The reviewer looks at the vehicle and confirms (or corrects) the category the driver asked for. */
function InspectModal({ app, onClose, onDone }: { app: App; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState(app.vehicle.category);
  const [inspected, setInspected] = useState(false);
  const confirm = useConfirm();
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Inspect and approve {app.driverName}</h3>
      <div className="note">{app.vehicle.colour} {app.vehicle.make} · {app.vehicle.plate}. The driver asked for <b>{label(app.vehicle.category)}</b>. Confirm the category after you have looked at the vehicle, its photo and its inspection certificate.</div>
      <div className="field"><label htmlFor="ic">Confirmed category</label>
        <select id="ic" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {category !== app.vehicle.category && <div className="banner" role="status">This is different from what the driver asked for. Trips and fares for this driver will follow {label(category)}.</div>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={inspected} onChange={(e) => setInspected(e.target.checked)} /> I have inspected this vehicle and its documents.</label>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!inspected} onClick={() => confirm.ask(
          { title: `Approve ${app.driverName} as ${label(category)}?`, text: 'They can go online and take trips as soon as you confirm. This creates their vehicle record.', confirm: 'Yes, approve' },
          () => go(() => post(`/admin/driver-applications/${app.id}/approve`, { category }), () => { onDone(); onClose(); }),
        )}>Approve driver</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
