import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { Modal, formatPlate, plateInput, useAnyLoading } from './ui';

/** Page n of m with Previous and Next, and the "Showing 1 to 20 of 62 results" line from the design. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
      <span className="note grow">Showing {total === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} results</span>
      <button className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="note">{page} / {pages}</span>
      <button className="btn ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

/** A search box that waits for the person to stop typing before it reports. */
export function SearchBox({ placeholder, onSearch }: { placeholder: string; onSearch: (s: string) => void }) {
  const [typed, setTyped] = useState('');
  const busy = useAnyLoading();
  const first = useRef(true);
  // Waits for a pause in typing, then searches. Nothing runs on the first render, so opening a page never resets its filters,
  // and nothing here reloads the page: only the list under the box changes.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => onSearch(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: 'relative', maxWidth: 320, width: '100%' }} role="search">
      <input className="input" style={{ width: '100%', paddingRight: 64 }} placeholder={placeholder} aria-label={placeholder} value={typed}
        onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(typed.trim()); } }} />
      {typed && <button type="button" aria-label="Clear search" onClick={() => { setTyped(''); onSearch(''); }}
        style={{ position: 'absolute', right: 8, top: 6, border: 0, background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>×</button>}
      {busy && typed && <span className="note" style={{ position: 'absolute', right: 30, top: 9, fontSize: 10.5 }}>Searching…</span>}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return <div className="seg" style={{ margin: 0 }}>{options.map(([k, label]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}</div>;
}

/** Runs a server action and keeps its busy and error state, so every button handles failure the same way. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true); setError(null);
    try { await fn(); after?.(); } catch (e) { setError((e as ApiError).message ?? 'Something went wrong.'); } finally { setBusy(false); }
  }
  return { busy, error, run, clear: () => setError(null) };
}

/** Asks for a written reason (the backend requires 3 to 500 characters for anything that changes an account or money). */
export function ReasonModal({ title, text, confirm, danger, onClose, onSubmit, children }: {
  title: string; text?: string; confirm: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown>; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
      {text && <div className="sub">{text}</div>}
      {children}
      <div className="field"><label htmlFor="reason">Reason</label>
        <textarea id="reason" className="input" placeholder="Say why. This is saved in the activity log." value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus /></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={'btn' + (danger ? ' danger' : '')} disabled={busy || reason.trim().length < 3} onClick={() => run(() => onSubmit(reason.trim()), onClose)}>{busy ? 'Working…' : confirm}</button>
      </div>
    </Modal>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return <div className="toast" role="status">{text}</div>;
}

/**
 * For the action given to `useConfirm().ask`: runs it and lets a failure reach the confirm box, which shows the reason and
 * stays open. (`useAction().run` would catch the error itself and the box would close as if it had worked.)
 */
export async function go(fn: () => Promise<unknown>, after?: () => void): Promise<void> {
  await fn();
  after?.();
}

interface ConfirmOptions { title: string; text?: string; confirm: string; danger?: boolean }

/**
 * The second click. `ask(options, action)` opens an "Are you sure?" box and runs `action` only after the confirm button.
 * Render `node` once in the page. Errors from the action are shown inside the box so nothing fails silently.
 */
export function useConfirm() {
  const [open, setOpen] = useState<{ o: ConfirmOptions; action: () => Promise<unknown> | void } | null>(null);
  const { busy, error, run, clear } = useAction();
  const close = () => { setOpen(null); clear(); };
  const node = open ? (
    <Modal onClose={close}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{open.o.title}</h3>
      {open.o.text && <div className="sub">{open.o.text}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={close} autoFocus>Go back</button>
        <button className={'btn' + (open.o.danger ? ' danger' : '')} disabled={busy} onClick={() => run(async () => { await open.action(); }, close)}>{busy ? 'Working…' : open.o.confirm}</button>
      </div>
    </Modal>
  ) : null;
  return { ask: (o: ConfirmOptions, action: () => Promise<unknown> | void) => setOpen({ o, action }), node };
}

export const kv =(label: string, value: ReactNode) => <div className="line"><span className="note">{label}</span><span>{value}</span></div>;

/**
 * A number plate box. The state holds plain capitals and digits (KJA482AB) and the box shows the dash (KJA-482AB). After
 * every change the cursor is put back where the person was typing, counted in letters and digits, so typing in the
 * middle, deleting and pasting never throw it to the end.
 */
export function PlateInput({ id, value, onChange, placeholder = 'ABC-123XY' }: { id?: string; value: string; onChange: (plain: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null); // letters and digits before the cursor
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caret.current === null) return;
    const shown = formatPlate(value);
    let seen = 0; let pos = 0;
    while (pos < shown.length && seen < caret.current) { if (shown[pos] !== '-') seen++; pos++; }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  });
  return (
    <input id={id} ref={ref} className="input" placeholder={placeholder} autoCapitalize="characters" spellCheck={false} value={formatPlate(value)}
      onKeyDown={(e) => {
        // Backspace right after the dash removes the letter before it (the dash is only for show, so deleting it would do nothing)
        const el = e.currentTarget;
        if (e.key === 'Backspace' && el.selectionStart === 4 && el.selectionEnd === 4 && formatPlate(value)[3] === '-') {
          e.preventDefault();
          caret.current = 2;
          onChange(value.slice(0, 2) + value.slice(3));
        }
      }}
      onChange={(e) => {
        const typed = e.target.value;
        const at = e.target.selectionStart ?? typed.length;
        caret.current = plateInput(typed.slice(0, at)).length;
        onChange(plateInput(typed));
      }} />
  );
}
