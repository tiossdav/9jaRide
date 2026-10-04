import { useState } from 'react';
import { newKey, post } from './api';
import { go, useConfirm } from './bits';
import { Modal, moneyInput, toKobo } from './ui';

export type AdjustKind = 'refund' | 'credit' | 'debit' | 'topup_correction';

const KINDS: [AdjustKind, string, string][] = [
  ['refund', 'Refund a trip', 'Money back to the rider for a completed trip, paid by the platform.'],
  ['credit', 'Credit a wallet', 'Goodwill or a correction in the person\'s favour, paid by the platform.'],
  ['debit', 'Debit a wallet', 'Recover money from a wallet, for example a driver who owes the platform.'],
  ['topup_correction', 'Fix a top-up', 'A real Paystack payment that was never credited correctly.'],
];

/**
 * Asks for a manual money movement. Nothing moves until a different finance or admin person approves it
 * on the Adjustments page, so this only files the request.
 */
export function AdjustModal({ userId, rideId, kind: start = 'credit', who, onClose, onDone }: {
  userId?: string; rideId?: string; kind?: AdjustKind; who?: string; onClose: () => void; onDone: () => void;
}) {
  const [kind, setKind] = useState<AdjustKind>(rideId ? 'refund' : start);
  const [user, setUser] = useState(userId ?? '');
  const [ride, setRide] = useState(rideId ?? '');
  const [ref, setRef] = useState('');
  const [naira, setNaira] = useState('');
  const [reason, setReason] = useState('');
  const [key] = useState(newKey);
  const confirm = useConfirm();
  const kobo = toKobo(naira);
  const valid = /^[0-9a-f-]{36}$/i.test(user) && kobo > 0 && reason.trim().length >= 3 && (kind !== 'refund' || /^[0-9a-f-]{36}$/i.test(ride)) && (kind !== 'topup_correction' || ref.length >= 6);

  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Refund or adjust{who ? ` · ${who}` : ''}</h3>
      <div className="field"><label htmlFor="kind">What do you want to do?</label>
        <select id="kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as AdjustKind)}>{KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
        <div className="note">{KINDS.find((k) => k[0] === kind)?.[2]}</div></div>
      {!userId && <div className="field"><label htmlFor="uid">Person&apos;s ID</label><input id="uid" className="input" placeholder="Copy it from their profile address" value={user} onChange={(e) => setUser(e.target.value.trim())} /></div>}
      {kind === 'refund' && !rideId && <div className="field"><label htmlFor="rid">Trip ID</label><input id="rid" className="input" value={ride} onChange={(e) => setRide(e.target.value.trim())} /></div>}
      {kind === 'topup_correction' && <div className="field"><label htmlFor="ref">Paystack reference</label><input id="ref" className="input" value={ref} onChange={(e) => setRef(e.target.value.trim())} /></div>}
      <div className="field"><label htmlFor="amt">Amount (₦)</label><input id="amt" className="input" inputMode="decimal" placeholder="0.00" value={naira} onChange={(e) => setNaira(moneyInput(e.target.value))} /></div>
      <div className="field"><label htmlFor="why">Reason</label><textarea id="why" className="input" placeholder="What happened and why this is right" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
      <div className="note">A second person must approve this before any money moves.</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!valid} onClick={() => confirm.ask({ title: `Send ₦${kobo / 100} for approval?`, text: 'A second person must approve it before any money moves.', confirm: 'Yes, send' }, () => go(() => post('/admin/adjustments', {
          kind, userId: user, amountKobo: kobo, reason: reason.trim(), ...(kind === 'refund' ? { rideId: ride } : {}), ...(kind === 'topup_correction' ? { providerReference: ref } : {}),
        }, { 'Idempotency-Key': key }), () => { onDone(); onClose(); }))}>Send for approval</button>
      </div>
      {confirm.node}
    </Modal>
  );
}
