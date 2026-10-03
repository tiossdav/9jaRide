import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api';
import { ReasonModal, Toast, kv, useAction, useConfirm } from '../bits';
import { Loading, Pill, dateTime, title, useLoad } from '../ui';

interface App {
  id: string; driverId: string; driverName: string; phone: string; status: string; accountStatus: string;
  vehicle: { category: string; make: string; colour: string; plate: string };
  reviewNote: string | null; submittedAt: string; reviewedAt: string | null;
  documents: { kind: string; fileRef: string; expiresOn: string | null; expired: boolean }[];
  missingDocuments: string[];
}

export default function OnboardingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: a, error, reload } = useLoad<App>(`/admin/driver-applications/${id}`);
  const [ask, setAsk] = useState<'changes' | 'reject' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  const confirm = useConfirm();
  if (!a) return <Loading error={error} retry={reload} />;
  const open = a.status === 'SUBMITTED';
  const blocked = a.missingDocuments.length > 0 || a.documents.some((d) => d.expired);

  return (
    <>
      <div className="head">
        <div><Link to="/drivers" className="note">← Drivers</Link><h1>{a.driverName}</h1><div className="sub">Application submitted {dateTime(a.submittedAt)} · {a.phone}</div></div>
        <div className="grow" /><Pill tone={a.status === 'APPROVED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'amber'}>{title(a.status)}</Pill>
      </div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      <div className="grid g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>Vehicle</h3>
            {kv('Plate', a.vehicle.plate)}{kv('Make', a.vehicle.make)}{kv('Colour', a.vehicle.colour)}{kv('Category', title(a.vehicle.category))}</div>
          <div className="card"><h3>Documents</h3>
            {a.documents.map((d) => kv(title(d.kind), <>{d.expiresOn ? `Expires ${d.expiresOn.slice(0, 10)} ` : ''}{d.expired ? <span className="chip red">Expired</span> : <span className="chip">On file</span>}</>))}
            {a.missingDocuments.map((m) => kv(title(m), <span className="chip red">Missing</span>))}
            <div className="note" style={{ marginTop: 10 }}>File upload is not built yet: each document shows the reference stored with the application.</div></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {a.reviewNote && <div className="card"><h3>Reviewer note</h3><p style={{ marginTop: 8 }}>{a.reviewNote}</p>{a.reviewedAt && <div className="note" style={{ marginTop: 6 }}>{dateTime(a.reviewedAt)}</div>}</div>}
          {open ? (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3>Decision</h3>
              {blocked && <div className="note">Approval is blocked until every required document is present and in date.</div>}
              <button className="btn" disabled={act.busy || blocked} onClick={() => confirm.ask({ title: `Approve ${a.driverName}?`, text: 'They can go online and take trips as soon as you confirm. This creates their vehicle record.', confirm: 'Yes, approve' }, () => act.run(() => post(`/admin/driver-applications/${a.id}/approve`), () => { setToast('Driver approved'); reload(); }))}>Approve driver</button>
              <button className="btn ghost" onClick={() => setAsk('changes')}>Request changes</button>
              <button className="btn outline-red" onClick={() => setAsk('reject')}>Reject</button>
            </div>
          ) : <div className="card"><h3>Decision</h3><div className="note" style={{ marginTop: 6 }}>This application is closed. {a.status === 'APPROVED' && <Link to={`/people/${a.driverId}`} style={{ color: 'var(--accent)' }}>Open the driver</Link>}</div></div>}
        </div>
      </div>
      {ask === 'changes' && <ReasonModal title="Request changes" text="The driver sees this note and can fix and resubmit." confirm="Send request" onClose={() => setAsk(null)} onSubmit={async (note) => { await post(`/admin/driver-applications/${a.id}/request-changes`, { note }); reload(); }} />}
      {ask === 'reject' && <ReasonModal title="Reject application" confirm="Reject" danger onClose={() => setAsk(null)} onSubmit={async (reason) => { await post(`/admin/driver-applications/${a.id}/reject`, { reason }); nav('/drivers'); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}
