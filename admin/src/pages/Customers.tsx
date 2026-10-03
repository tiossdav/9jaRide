import { useNavigate } from 'react-router-dom';
import { Bars, Loading, Stat, initials, naira, useLoad } from '../ui';

interface Customers {
  total: number; active: number; suspended: number;
  top: { id: string; name: string; phone: string; status: string; trips: number; spentKobo: number }[];
  sameNames: { name: string; count: number }[];
  registrations: { month: string; n: number }[];
}

export default function CustomersPage() {
  const nav = useNavigate();
  const { data: d, error, reload } = useLoad<Customers>('/admin/console/customers');
  if (!d) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="head"><div><h1>Customers</h1><div className="sub">All rider accounts on the platform</div></div></div>
      <div className="stats">
        <Stat icon="users" label="Total customers" value={d.total} />
        <Stat icon="users" label="Active" value={d.active} />
        <Stat icon="users" label="Suspended" value={d.suspended} />
      </div>
      <div className="grid g21" style={{ marginTop: 14 }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 18px 4px' }}><h3>Top customers</h3><div className="hint">By completed trips</div></div>
          {d.top.length === 0 ? <div className="empty">No customers yet.</div> : (
            <table><thead><tr><th>#</th><th>Customer</th><th className="num">Trips</th><th className="num">Spent</th><th>Status</th></tr></thead><tbody>
              {d.top.map((c, i) => (
                <tr key={c.id} className="link" onClick={() => nav(`/people/${c.id}`)}><td>{i + 1}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="avatar">{initials(c.name)}</div><div>{c.name}<div className="note">{c.phone}</div></div></div></td>
                  <td className="num">{c.trips}</td><td className="num">{naira(c.spentKobo)}</td>
                  <td>{c.status === 'suspended' ? <span className="chip red">Suspended</span> : <span className="chip">Active</span>}</td></tr>
              ))}
            </tbody></table>
          )}
          {d.sameNames.length > 0 && <div className="banner" style={{ margin: 14 }}>{d.sameNames.map((s) => `${s.count} customers share the name ${s.name}`).join('. ')}. Review for duplicate accounts.</div>}
        </div>
        <div className="card"><h3>Registration trend</h3><div className="hint">New customers per month</div>
          <Bars items={d.registrations.map((r) => ({ label: r.month.slice(5), value: r.n }))} /></div>
      </div>
    </>
  );
}
