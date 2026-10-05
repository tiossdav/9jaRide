import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { Pager, SearchBox, Segmented } from '../bits';
import { LineChart, Loading, Pill, Stat, dateTime, initials, naira, title, useLoad } from '../ui';

// ---------------------------------------------------------------- revenue

interface Rev {
  days: number; faresKobo: number; commissionKobo: number; taxKobo: number; trips: number;
  byDay: { day: string; faresKobo: number; commissionKobo: number; taxKobo: number; trips: number }[];
  byCategory: { category: string; trips: number; faresKobo: number }[];
  byMethod: { method: string; trips: number; faresKobo: number }[];
}

export function Revenue() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { data: d, error, reload } = useLoad<Rev>(`/admin/console/revenue?days=${days}`);
  return (
    <>
      <div className="head"><div><h1>Revenue</h1><div className="sub">Completed trips only. Fares are what riders paid; the 9jaRide service charge and tax are what the platform kept or owes.</div></div><div className="grow" />
        <Segmented options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const} value={days} onChange={setDays} /></div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <>
          <div className="stats">
            <Stat icon="pin" label="Completed trips" value={d.trips} />
            <Stat icon="wallet" label="Fares paid" value={naira(d.faresKobo)} />
            <Stat icon="trend" label="9jaRide service charge" value={naira(d.commissionKobo, true)} tone="green" />
            <Stat icon="book" label="Tax collected" value={naira(d.taxKobo, true)} />
          </div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <div className="card"><div className="cardhead"><div><h3>Fares by day</h3><div className="hint">Last {d.days} days</div></div><Pill>{days} days</Pill></div>
              <LineChart letters={false} labels={d.byDay.map((r) => new Date(r.day + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} values={d.byDay.map((r) => r.faresKobo)} format={(n) => naira(n)} /></div>
            <div className="card"><div className="cardhead"><div><h3>Service charge by day</h3><div className="hint">Platform share of each fare</div></div><Pill tone="green">{days} days</Pill></div>
              <LineChart letters={false} labels={d.byDay.map((r) => new Date(r.day + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} values={d.byDay.map((r) => r.commissionKobo)} format={(n) => naira(n, true)} /></div>
          </div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <div className="card" style={{ padding: 0 }}><div style={{ padding: '16px 18px 4px' }}><h3>By category</h3></div>
              <table><thead><tr><th>Category</th><th className="num">Trips</th><th className="num">Fares</th></tr></thead><tbody>
                {d.byCategory.length === 0 && <tr><td colSpan={3} className="empty">No trips in this period.</td></tr>}
                {d.byCategory.map((c) => <tr key={c.category}><td>{title(c.category)}</td><td className="num">{c.trips}</td><td className="num">{naira(c.faresKobo)}</td></tr>)}</tbody></table></div>
            <div className="card" style={{ padding: 0 }}><div style={{ padding: '16px 18px 4px' }}><h3>By payment method</h3></div>
              <table><thead><tr><th>Method</th><th className="num">Trips</th><th className="num">Fares</th></tr></thead><tbody>
                {d.byMethod.length === 0 && <tr><td colSpan={3} className="empty">No trips in this period.</td></tr>}
                {d.byMethod.map((c) => <tr key={c.method}><td>{title(c.method)}</td><td className="num">{c.trips}</td><td className="num">{naira(c.faresKobo)}</td></tr>)}</tbody></table></div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- ledger

interface Ledger { total: number; page: number; pageSize: number; kinds: { kind: string; n: number }[]; items: { id: string; kind: string; reference: string; memo: string | null; at: string; movedKobo: number; entries: number }[] }
interface Entry { account: string; kind: string; amountKobo: number }

export function LedgerPage() {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry[] | string>>({});
  const qs = new URLSearchParams({ page: String(page), ...(search ? { search } : {}), ...(kind ? { kind } : {}) });
  const { data: d, error, reload } = useLoad<Ledger>(`/admin/console/ledger?${qs}`);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!entries[id]) { try { setEntries({ ...entries, [id]: await get<Entry[]>(`/admin/console/ledger/${id}`) }); } catch (e) { setEntries({ ...entries, [id]: (e as Error).message }); } }
  }

  return (
    <>
      <div className="head"><div><h1>Ledger</h1><div className="sub">Every money movement, in pairs that add up to zero. Nothing here can be edited or deleted.</div></div></div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchBox placeholder="Search reference or memo" onSearch={(s) => { setSearch(s); setPage(1); }} />
        <select className="select" style={{ width: 200 }} aria-label="Type" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">All types</option>{(d?.kinds ?? []).map((k) => <option key={k.kind} value={k.kind}>{title(k.kind)} ({k.n})</option>)}</select>
      </div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 0 }}>
          {d.items.length === 0 ? <div className="empty">No transactions match.</div> : (
            <table><thead><tr><th>When</th><th>Type</th><th>Reference</th><th>Memo</th><th className="num">Moved</th></tr></thead><tbody>
              {d.items.map((t) => (
                <Fragment key={t.id}>
                  <tr className="link" onClick={() => toggle(t.id)}><td>{dateTime(t.at)}</td><td><Pill>{title(t.kind)}</Pill></td><td className="note">{t.reference}</td><td>{t.memo ?? '-'}</td><td className="num">{naira(t.movedKobo, true)}</td></tr>
                  {open === t.id && (
                    <tr><td colSpan={5} style={{ background: 'var(--raised)' }}>
                      {typeof entries[t.id] === 'string' ? <span className="error">{entries[t.id] as string}</span> : !entries[t.id] ? 'Loading…' : (
                        <table><tbody>{(entries[t.id] as Entry[]).map((e, i) => <tr key={i}><td>{e.account}</td><td className="num" style={{ color: e.amountKobo < 0 ? 'var(--red)' : 'var(--accent)' }}>{e.amountKobo < 0 ? '−' : '+'}{naira(Math.abs(e.amountKobo), true)}</td></tr>)}</tbody></table>
                      )}</td></tr>
                  )}
                </Fragment>
              ))}
            </tbody></table>
          )}
          <Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- driver ratings

interface Ratings {
  direction: 'rider_to_driver' | 'driver_to_rider';
  average: number | null; total: number; withComment: number; distribution: { stars: number; count: number }[];
  lowestRated: { id: string; name: string; average: number; ratings: number }[];
  topComments: { tag: string; count: number; average: number }[];
  recent: { stars: number; tags: string[]; comment: string | null; at: string; rideId: string; code: string; rateeId: string | null; ratee: string | null; rater: string }[];
}

export function RatingsTab() {
  const [dir, setDir] = useState<'rider_to_driver' | 'driver_to_rider'>('rider_to_driver');
  const { data: d, error, reload } = useLoad<Ratings>(`/admin/console/ratings?direction=${dir}`);
  const who = dir === 'rider_to_driver' ? 'drivers' : 'riders';
  const picker = <div style={{ marginBottom: 14 }}><Segmented options={[['rider_to_driver', 'Riders rating drivers'], ['driver_to_rider', 'Drivers rating riders']] as const} value={dir} onChange={setDir} /></div>;
  if (!d) return <>{picker}<Loading error={error} retry={reload} /></>;
  const max = Math.max(1, ...d.distribution.map((x) => x.count));
  const topMax = Math.max(1, ...d.topComments.map((x) => x.count));
  return (
    <>
      {picker}
      <div className="stats">
        <Stat icon="activity" label="Average rating" value={d.average ?? '-'} note={`${d.total} rating${d.total === 1 ? '' : 's'}`} />
        <Stat icon="warn" label={`Low-rated ${who} (under 4.0)`} value={d.lowestRated.filter((l) => l.average < 4).length} tone={d.lowestRated.some((l) => l.average < 4) ? 'amber' : undefined} note="with 3 or more ratings" />
        <Stat icon="help" label="With a written comment" value={d.withComment} note={d.total ? `${Math.round((d.withComment / d.total) * 100)}% of ratings` : ''} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card"><h3>{dir === 'rider_to_driver' ? 'How riders rate drivers' : 'How drivers rate riders'}</h3>
          {d.distribution.map((x) => (
            <div key={x.stars} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ width: 48 }}>{x.stars} star{x.stars === 1 ? '' : 's'}</span>
              <div style={{ flex: 1, height: 10, background: 'var(--raised)', borderRadius: 999 }}><div style={{ width: `${(x.count / max) * 100}%`, height: '100%', background: x.stars >= 4 ? 'var(--accent)' : x.stars === 3 ? 'var(--gold)' : 'var(--red)', borderRadius: 999 }} /></div>
              <span className="note" style={{ width: 28, textAlign: 'right' }}>{x.count}</span>
            </div>
          ))}
        </div>
        <div className="card"><h3>What people pick most</h3><div className="hint">Quick comments, with the average stars of the ratings that chose them</div>
          {d.topComments.length === 0 ? <div className="empty">No quick comments yet.</div> : d.topComments.slice(0, 10).map((x) => (
            <div key={x.tag} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9 }}>
              <span style={{ width: 170, fontSize: 13 }}>{x.tag}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--raised)', borderRadius: 999 }}><div style={{ width: `${(x.count / topMax) * 100}%`, height: '100%', background: x.average >= 4 ? 'var(--accent)' : x.average >= 3 ? 'var(--gold)' : 'var(--red)', borderRadius: 999 }} /></div>
              <span className="note" style={{ width: 62, textAlign: 'right' }}>{x.count} · {x.average}★</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ padding: 0, marginTop: 14 }}><div style={{ padding: '16px 18px 4px' }}><h3>Lowest rated {who}</h3><div className="hint">At least 3 ratings</div></div>
        {d.lowestRated.length === 0 ? <div className="empty">Not enough ratings yet.</div> : (
          <table><tbody>{d.lowestRated.map((l) => <tr key={l.id}><td><Link to={`/people/${l.id}`} style={{ color: 'var(--accent)' }}>{l.name}</Link></td><td className="num">{l.average} <span className="note">({l.ratings})</span></td></tr>)}</tbody></table>
        )}</div>
      <div className="card" style={{ padding: 0, marginTop: 14 }}><div style={{ padding: '16px 18px 4px' }}><h3>Recent ratings and feedback</h3></div>
        {d.recent.length === 0 ? <div className="empty">No ratings yet.</div> : (
          <table><thead><tr><th>When</th><th>{dir === 'rider_to_driver' ? 'Driver' : 'Rider'}</th><th>{dir === 'rider_to_driver' ? 'Rated by' : 'Rated by driver'}</th><th>Trip</th><th>Stars</th><th>Quick comments</th><th>Comment</th></tr></thead><tbody>
            {d.recent.map((r, i) => (
              <tr key={i}><td>{dateTime(r.at)}</td>
                <td>{r.rateeId ? <Link to={`/people/${r.rateeId}`} style={{ color: 'var(--accent)' }}><span className="avatar" style={{ display: 'inline-flex', marginRight: 6 }}>{initials(r.ratee)}</span>{r.ratee}</Link> : '-'}</td>
                <td>{r.rater}</td><td><Link to={`/trips/${r.rideId}`} style={{ color: 'var(--accent)' }}>{r.code}</Link></td>
                <td><span className={'chip' + (r.stars <= 2 ? ' red' : r.stars === 3 ? ' amber' : '')}>{r.stars} ★</span></td><td className="note">{r.tags.join(', ') || '-'}</td><td style={{ maxWidth: 260 }}>{r.comment || <span className="note">-</span>}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
