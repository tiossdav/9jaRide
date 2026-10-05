import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api';
import { ReasonModal, Segmented, Toast, useAction, useConfirm, go } from '../bits';
import { AdjustModal } from '../adjust';
import { Loading, Pill, Stat, dateTime, naira, title, useLoad } from '../ui';

// ---------------------------------------------------------------- overview (Wallet)

interface Fin {
  walletsKobo: number; commissionKobo: number; taxKobo: number; bonusKobo: number;
  payouts: { pending: number; pendingKobo: number; paidKobo: number; failed: number };
  pendingAdjustments: number; topupsKobo: number; topupMismatches: number; lastReconciliation: { startedAt: string } | null;
  platform: { code: string; kind: string; kobo: number }[];
}

export function Wallet() {
  const { data: d, error, reload } = useLoad<Fin>('/admin/console/finance', 30_000);
  if (!d) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="head"><div><h1>Wallet</h1><div className="sub">Where the money sits right now</div></div></div>
      <div className="stats">
        <Stat icon="wallet" label="Held in user wallets" value={naira(d.walletsKobo)} />
        <Stat icon="trend" label="9jaRide service charge" value={naira(d.commissionKobo)} tone="green" />
        <Stat icon="book" label="Tax to remit" value={naira(d.taxKobo)} />
        <Stat icon="card" label="Paid to drivers" value={naira(d.payouts.paidKobo)} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card"><h3>Needs attention</h3>
          <div className="line"><span>Payouts waiting for approval</span><Link to="/finances/payouts" style={{ color: 'var(--accent)', fontWeight: 600 }}>{d.payouts.pending} · {naira(d.payouts.pendingKobo)}</Link></div>
          <div className="line"><span>Adjustments waiting for approval</span><Link to="/finances/adjustments" style={{ color: 'var(--accent)', fontWeight: 600 }}>{d.pendingAdjustments}</Link></div>
          <div className="line"><span>Failed payouts</span><span>{d.payouts.failed}</span></div>
          <div className="line"><span>Top-ups with a wrong amount</span><span>{d.topupMismatches}</span></div>
          <div className="line"><span>Last reconciliation</span><span>{d.lastReconciliation ? dateTime(d.lastReconciliation.startedAt) : 'Never run'}</span></div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 18px 4px' }}><h3>Platform accounts</h3><div className="hint">Positive means the platform holds it; negative means it was paid out.</div></div>
          <table><thead><tr><th>Account</th><th className="num">Balance</th></tr></thead><tbody>
            {d.platform.map((a) => <tr key={a.code}><td>{title(a.code.replace(':', ' '))}</td><td className="num">{naira(a.kobo, true)}</td></tr>)}
          </tbody></table>
        </div>
      </div>
      <div className="note" style={{ marginTop: 12 }}>Top-ups credited so far: {naira(d.topupsKobo)}.</div>
    </>
  );
}

// ---------------------------------------------------------------- payouts

interface Payout { id: string; driverId: string; amountKobo: number; bankCode: string; accountNumber: string; accountName: string; status: string; createdAt: string; settledAt: string | null; rejectedReason: string | null; failureReason: string | null }
const PAYOUT_STATUS = [['PENDING_APPROVAL', 'Waiting'], ['APPROVED', 'Approved'], ['PROCESSING', 'Processing'], ['PAID', 'Paid'], ['FAILED', 'Failed'], ['REJECTED', 'Rejected']] as const;
const tone = (s: string) => (s === 'PAID' ? 'green' : s === 'FAILED' || s === 'REJECTED' ? 'red' : s === 'PENDING_APPROVAL' ? 'amber' : 'blue') as 'green' | 'red' | 'amber' | 'blue';

export function Payouts() {
  const [status, setStatus] = useState<(typeof PAYOUT_STATUS)[number][0]>('PENDING_APPROVAL');
  const { data, error, reload } = useLoad<Payout[]>(`/admin/payouts?status=${status}`);
  const [rejecting, setRejecting] = useState<Payout | null>(null);
  const confirm = useConfirm();
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  return (
    <>
      <div className="head"><div><h1>Driver payouts</h1><div className="sub">Approve or reject withdrawal requests. You cannot approve a request you made yourself.</div></div></div>
      <div style={{ marginBottom: 14 }}><Segmented options={PAYOUT_STATUS} value={status} onChange={setStatus} /></div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      {!data ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {data.length === 0 ? <div className="empty">No payouts with this status.</div> : (
            <table><thead><tr><th>Requested</th><th>Account</th><th className="num">Amount</th><th>Status</th><th /></tr></thead><tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>{dateTime(p.createdAt)}<div className="note"><Link to={`/people/${p.driverId}`} style={{ color: 'var(--accent)' }}>Driver profile</Link></div></td>
                  <td>{p.accountName}<div className="note">{p.accountNumber} · bank {p.bankCode}</div></td>
                  <td className="num">{naira(p.amountKobo)}</td>
                  <td><Pill tone={tone(p.status)}>{title(p.status)}</Pill>{(p.rejectedReason || p.failureReason) && <div className="note">{p.rejectedReason ?? p.failureReason}</div>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.status === 'PENDING_APPROVAL' && <>
                    <button className="btn" style={{ height: 30 }} disabled={act.busy} onClick={() => confirm.ask({ title: `Approve ${naira(p.amountKobo)}?`, text: `Money is sent to ${p.accountName}, ${p.accountNumber}. It cannot be taken back once the transfer starts.`, confirm: 'Yes, approve payout' }, () => go(() => post(`/admin/payouts/${p.id}/approve`), () => { setToast('Payout approved'); reload(); }))}>Approve</button>{' '}
                    <button className="btn outline-red" style={{ height: 30 }} onClick={() => setRejecting(p)}>Reject</button></>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}
      {rejecting && <ReasonModal title="Reject payout" text={`${naira(rejecting.amountKobo)} to ${rejecting.accountName}. The money goes back to the driver's wallet.`} confirm="Reject payout" danger onClose={() => setRejecting(null)}
        onSubmit={async (reason) => { await post(`/admin/payouts/${rejecting.id}/reject`, { reason }); setToast('Payout rejected'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- adjustments

interface Adj { id: string; kind: string; userId: string; rideId: string | null; amountKobo: number; reason: string; status: string; createdAt: string; rejectedReason: string | null; providerReference: string | null }
const ADJ_STATUS = [['PENDING_APPROVAL', 'Waiting'], ['POSTED', 'Posted'], ['REJECTED', 'Rejected']] as const;

export function Adjustments() {
  const [status, setStatus] = useState<(typeof ADJ_STATUS)[number][0]>('PENDING_APPROVAL');
  const { data, error, reload } = useLoad<Adj[]>(`/admin/adjustments?status=${status}`);
  const [rejecting, setRejecting] = useState<Adj | null>(null);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  return (
    <>
      <div className="head"><div><h1>Refunds and adjustments</h1><div className="sub">Manual money movements. A second person approves each one.</div></div><div className="grow" /><button className="btn" onClick={() => setCreating(true)}>New adjustment</button></div>
      <div style={{ marginBottom: 14 }}><Segmented options={ADJ_STATUS} value={status} onChange={setStatus} /></div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      {!data ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {data.length === 0 ? <div className="empty">Nothing here.</div> : (
            <table><thead><tr><th>Requested</th><th>Type</th><th>For</th><th className="num">Amount</th><th>Reason</th><th /></tr></thead><tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{dateTime(a.createdAt)}</td><td>{title(a.kind)}</td>
                  <td><Link to={`/people/${a.userId}`} style={{ color: 'var(--accent)' }}>Profile</Link>{a.rideId && <> · <Link to={`/trips/${a.rideId}`} style={{ color: 'var(--accent)' }}>Trip</Link></>}</td>
                  <td className="num">{naira(a.amountKobo, true)}</td><td style={{ maxWidth: 280 }}>{a.reason}{a.rejectedReason && <div className="note">Rejected: {a.rejectedReason}</div>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{a.status === 'PENDING_APPROVAL' && <>
                    <button className="btn" style={{ height: 30 }} disabled={act.busy} onClick={() => confirm.ask({ title: `Approve ${naira(a.amountKobo, true)} ${title(a.kind).toLowerCase()}?`, text: 'The money moves as soon as you confirm. It is written to the ledger and cannot be edited.', confirm: 'Yes, approve and post' }, () => go(() => post(`/admin/adjustments/${a.id}/approve`), () => { setToast('Adjustment approved and posted'); reload(); }))}>Approve</button>{' '}
                    <button className="btn outline-red" style={{ height: 30 }} onClick={() => setRejecting(a)}>Reject</button></>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}
      {rejecting && <ReasonModal title="Reject adjustment" confirm="Reject" danger onClose={() => setRejecting(null)} onSubmit={async (reason) => { await post(`/admin/adjustments/${rejecting.id}/reject`, { reason }); setToast('Adjustment rejected'); reload(); }} />}
      {creating && <AdjustModal onClose={() => setCreating(false)} onDone={() => { setToast('Sent for approval'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- reconciliation and exceptions

interface Exc { sourceKind: 'intent' | 'finding' | 'payout'; sourceId: string; kind: string; reference: string | null; detail: Record<string, unknown>; firstSeenAt: string }

export function Reconciliation() {
  const { data, error, reload } = useLoad<Exc[]>('/admin/payment-exceptions');
  const confirm = useConfirm();
  const [resolving, setResolving] = useState<Exc | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const act = useAction();
  return (
    <>
      <div className="head"><div><h1>Reconciliation</h1><div className="sub">Problems found when our books are checked against Paystack, plus failed payouts. Each needs a decision.</div></div><div className="grow" />
        <button className="btn ghost" disabled={act.busy} onClick={() => confirm.ask({ title: 'Run reconciliation now?', text: 'This checks our books against Paystack. It can take a minute.', confirm: 'Yes, run it' }, () => go(() => post('/admin/reconciliation/run'), () => { setToast('Reconciliation finished'); reload(); }))}>{act.busy ? 'Running…' : 'Run now'}</button></div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      {!data ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {data.length === 0 ? <div className="empty">Nothing needs a decision. The books agree with Paystack.</div> : (
            <table><thead><tr><th>First seen</th><th>Problem</th><th>Reference</th><th>Detail</th><th /></tr></thead><tbody>
              {data.map((e) => (
                <tr key={e.sourceKind + e.sourceId}>
                  <td>{dateTime(e.firstSeenAt)}</td><td><Pill tone="red">{title(e.kind)}</Pill></td><td className="note">{e.reference ?? '-'}</td>
                  <td className="note" style={{ maxWidth: 320 }}>{Object.entries(e.detail).map(([k, v]) => `${title(k)}: ${typeof v === 'number' && /kobo/i.test(k) ? naira(v) : String(v)}`).join(' · ')}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost" style={{ height: 30 }} onClick={() => setResolving(e)}>Resolve</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}
      {resolving && <ResolveModal exc={resolving} onClose={() => setResolving(null)} onDone={() => { setToast('Marked as resolved'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function ResolveModal({ exc, onClose, onDone }: { exc: Exc; onClose: () => void; onDone: () => void }) {
  const [resolution, setResolution] = useState<'dismissed' | 'contacted_user' | 'corrected'>('dismissed');
  const [note, setNote] = useState('');
  const [adj, setAdj] = useState('');
  const { busy, error, run } = useAction();
  const ok = note.trim().length >= 3 && (resolution !== 'corrected' || adj.length >= 30);
  return (
    <div className="scrim" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Resolve: {title(exc.kind)}</h3>
      <div className="field"><label htmlFor="res">What was done?</label>
        <select id="res" className="select" value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
          <option value="dismissed">Dismiss: not a real problem</option><option value="contacted_user">Contacted the person</option><option value="corrected">Corrected with an adjustment</option></select></div>
      {resolution === 'corrected' && <div className="field"><label htmlFor="adj">Adjustment ID</label><input id="adj" className="input" placeholder="Must already be approved and posted" value={adj} onChange={(e) => setAdj(e.target.value.trim())} /></div>}
      <div className="field"><label htmlFor="note">Note</label><textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !ok} onClick={() => run(() => post('/admin/payment-exceptions/resolve', { sourceKind: exc.sourceKind, sourceId: exc.sourceId, resolution, note: note.trim(), ...(resolution === 'corrected' ? { adjustmentId: adj } : {}) }), () => { onDone(); onClose(); })}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div></div>
  );
}
