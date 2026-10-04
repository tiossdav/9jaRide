import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, wakeServer } from '../api';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wake, setWake] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); nav('/', { replace: true }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="left">
        <div className="logo">9ja<b>Ride</b></div>
        <div style={{ color: '#bfe3c6', fontSize: 16, fontWeight: 600, marginTop: 6 }}>Admin portal</div>
        <div style={{ color: '#9fd1a8', fontSize: 15, fontWeight: 500, maxWidth: 360, marginTop: 24 }}>Run operations, safety and money for the whole fleet in one place.</div>
      </div>
      <div className="right">
        <form onSubmit={submit}>
          <h1>Sign in</h1>
          <div className="sub">Enter your work email and password.</div>
          <div className="field"><label htmlFor="email">Email address</label>
            <input id="email" className="input" type="email" autoComplete="username" placeholder="you@9jaridepro.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="current-password" placeholder="••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="note" style={{ marginTop: 10 }}>
            {wake ?? 'Slow or no connection? The server may be asleep. '}
            <a href="#wake" style={{ color: 'var(--accent)' }} onClick={async (ev) => { ev.preventDefault(); setWake('Waking the server, this can take a minute or two…'); setWake((await wakeServer()) ? 'The server is awake. You can sign in now.' : 'It is still starting. Try again in a minute.'); }}>Wake the server</a>
          </div>
          <button className="btn lg" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
