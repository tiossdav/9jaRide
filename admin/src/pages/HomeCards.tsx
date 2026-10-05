import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { call, del } from '../api';
import { Toast, go, useAction, useConfirm } from '../bits';
import { Loading, Modal, Pill, dateTime, naira, title, useLoad } from '../ui';

interface Card { id: string; kind: string; title: string; body: string; amountKobo: number | null; active: boolean; sortOrder: number; updatedAt: string }

const KINDS: [string, string][] = [['invite', 'Invite & Earn'], ['announcement', 'Announcement'], ['safety', 'Safety tip'], ['promo', 'Promotion'], ['feature', 'New feature']];

/** The "For you" cards riders see under the booking box. Staff can read them; an admin changes them. */
export default function HomeCards() {
  const { me } = useOutletContext<{ me: { role: string } | null }>();
  const canEdit = me?.role === 'admin';
  const { data, error, reload } = useLoad<{ items: Card[] }>('/admin/home-cards');
  const [editing, setEditing] = useState<Card | 'new' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useConfirm();
  const act = useAction();
  return (
    <>
      <div className="head"><div><h1>Rider home content</h1><div className="sub">The cards in the &quot;For you&quot; strip on the rider home screen. Use {'{amount}'} in an Invite &amp; Earn title to show its reward.</div></div><div className="grow" />
        {canEdit && <button className="btn" onClick={() => setEditing('new')}>Add card</button>}</div>
      {act.error && <div className="banner error" role="alert">{act.error}</div>}
      {!data ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          <table><thead><tr><th>Order</th><th>Type</th><th>Title</th><th>Text</th><th>Reward</th><th>Shown</th><th>Updated</th><th /></tr></thead><tbody>
            {data.items.map((c) => (
              <tr key={c.id}>
                <td className="num">{c.sortOrder}</td><td>{title(c.kind)}</td><td style={{ fontWeight: 600 }}>{c.title}</td>
                <td className="note" style={{ maxWidth: 320 }}>{c.body}</td><td className="num">{c.amountKobo == null ? '-' : naira(c.amountKobo)}</td>
                <td>{c.active ? <Pill tone="green">Shown</Pill> : <Pill tone="amber">Hidden</Pill>}</td><td className="note">{dateTime(c.updatedAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{canEdit && <>
                  <button className="btn ghost" style={{ height: 28 }} onClick={() => setEditing(c)}>Edit</button>{' '}
                  <button className="btn ghost" style={{ height: 28 }} onClick={() => confirm.ask({ title: `Delete "${c.title}"?`, text: 'Riders stop seeing it straight away.', confirm: 'Yes, delete', danger: true }, () => go(() => del(`/admin/home-cards/${c.id}`), () => { setToast('Card deleted'); reload(); }))}>Delete</button></>}</td>
              </tr>
            ))}
            {data.items.length === 0 && <tr><td colSpan={8} className="empty">No cards yet. Riders see a short built-in set until one is added.</td></tr>}
          </tbody></table>
        </div>
      )}
      {editing && <CardForm card={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setToast('Saved'); reload(); }} />}
      {confirm.node}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function CardForm({ card, onClose, onDone }: { card: Card | null; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState(card?.kind ?? 'announcement');
  const [titleText, setTitle] = useState(card?.title ?? '');
  const [body, setBody] = useState(card?.body ?? '');
  const [amount, setAmount] = useState(card?.amountKobo != null ? String(card.amountKobo / 100) : '');
  const [active, setActive] = useState(card?.active ?? true);
  const [order, setOrder] = useState(String(card?.sortOrder ?? 100));
  const { busy, error, run } = useAction();
  const kobo = amount.trim() === '' ? null : Math.round(Number(amount) * 100);
  const bad = !titleText.trim() || !body.trim() || (kind === 'invite' && kobo != null && (!Number.isFinite(kobo) || kobo < 0));
  const payload = { kind, title: titleText.trim(), body: body.trim(), amountKobo: kind === 'invite' ? kobo : null, active, sortOrder: Math.max(0, Math.round(Number(order) || 0)) };
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{card ? 'Edit card' : 'Add a card'}</h3>
      <div className="field"><label htmlFor="hk">Type</label>
        <select id="hk" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor="ht">Title</label><input id="ht" className="input" maxLength={80} value={titleText} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'invite' ? 'Invite & Earn {amount}' : 'A short heading'} /></div>
      <div className="field"><label htmlFor="hb">Text</label><textarea id="hb" className="input" maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      {kind === 'invite' && <div className="field"><label htmlFor="ha">Reward (naira)</label><input id="ha" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="1000" /></div>}
      <div className="field"><label htmlFor="ho">Order (smaller shows first)</label><input id="ho" className="input" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value.replace(/[^0-9]/g, ''))} /></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Show this card to riders</label>
      {error && <div className="error" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || bad} onClick={() => run(() => (card ? call('PUT', `/admin/home-cards/${card.id}`, payload) : call('POST', '/admin/home-cards', payload)), () => { onDone(); onClose(); })}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}
