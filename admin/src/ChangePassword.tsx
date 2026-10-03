import { useState } from 'react';
import { login, post } from './api';
import { useAction } from './bits';
import { Icon, Modal } from './ui';

/**
 * Change password, as in the design. Changing it ends every session on the server, so the portal signs straight back in
 * with the new password. `forced` is set for a new invitee: they cannot close it until they have chosen their own.
 */
export function ChangePassword({ email, forced, onClose, onDone }: { email: string; forced?: boolean; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, run } = useAction();
  const problem = next && (next.length < 12 ? 'Use at least 12 characters.' : !/[A-Za-z]/.test(next) || !/[0-9]/.test(next) ? 'Use letters and numbers.' : next === current ? 'Choose a password you have not used.' : again && again !== next ? 'The two new passwords do not match.' : null);
  const ok = current && next && again === next && !problem;
  return (
    <Modal onClose={forced ? () => undefined : onClose}>
      <div style={{ display: 'flex', alignItems: 'center' }}><h3 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Change Password</h3>{!forced && <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, background: 'var(--raised)', borderRadius: 10 }}>
        <Icon name="shield" size={18} /><div><div style={{ fontWeight: 700 }}>{forced ? 'Choose your own password' : 'Update your account credentials'}</div>
          <div className="note">{forced ? 'You signed in with a one-time password. Pick one only you know.' : 'Choose a strong new password you have not used before.'}</div></div>
      </div>
      <div className="field"><label htmlFor="cp1">Current password *</label><input id="cp1" className="input" type="password" autoComplete="current-password" placeholder="Enter your current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></div>
      <div className="field"><label htmlFor="cp2">New password *</label><input id="cp2" className="input" type="password" autoComplete="new-password" placeholder="At least 12 characters" value={next} onChange={(e) => setNext(e.target.value)} /></div>
      <div className="note">Use a mix of letters, numbers and symbols.</div>
      <div className="field"><label htmlFor="cp3">Confirm new password *</label><input id="cp3" className="input" type="password" autoComplete="new-password" placeholder="Re-enter your new password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
      {(problem || error) && <div className="error" role="alert">{problem ?? error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {!forced && <button className="btn ghost" onClick={onClose}>Cancel</button>}
        <button className="btn" disabled={busy || !ok} onClick={() => run(async () => {
          await post('/auth/staff/change-password', { currentPassword: current, newPassword: next });
          await login(email, next); // every session was ended: sign in again with the new password
        }, onDone)}>{busy ? 'Updating…' : 'Update Password'}</button>
      </div>
    </Modal>
  );
}
