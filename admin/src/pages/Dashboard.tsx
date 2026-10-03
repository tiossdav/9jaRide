import { Link, useOutletContext } from 'react-router-dom';
import type { Me } from '../Layout';
import { Icon, LineChart, Loading, Pill, Stat, naira, useLoad } from '../ui';

interface Dash {
  users: { total: number; drivers: number; customers: number; activeDrivers: number; suspended: number };
  vehicles: { total: number; online: number };
  safety: { openAlerts: number; slowToAcknowledge: number };
  tripsByMonth: { month: number; total: number; completed: number; cancelled: number }[];
  revenueByMonth: { month: number; kobo: number }[];
  activity: { total: number; thisMonth: number; today: number; completedToday: number; cancelledToday: number; ongoing: number };
  finance: { todayKobo: number; pendingPayoutKobo: number; pendingPayouts: number; awaitingApproval: number };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthly = <T extends { month: number }>(rows: T[], pick: (r: T) => number) => MONTHS.map((_, i) => { const r = rows.find((x) => x.month === i + 1); return r ? pick(r) : 0; });

export default function Dashboard() {
  const { data: d, error, reload } = useLoad<Dash>('/admin/console/dashboard', 30_000);
  const { me, today } = useOutletContext<{ me: Me | null; today: string }>();
  if (!d) return <Loading error={error} retry={reload} />;
  const year = new Date().getFullYear();
  const total = monthly(d.tripsByMonth, (r) => r.total);
  const yearTrips = total.reduce((s, n) => s + n, 0);
  const revenue = monthly(d.revenueByMonth, (r) => r.kobo);
  const yearRevenue = revenue.reduce((s, n) => s + n, 0);
  const alerts = d.safety.openAlerts;

  return (
    <>
      <div className="head">
        <div><h1>Dashboard</h1><div className="sub">Welcome back, {me?.name ?? 'there'}. Here&apos;s what&apos;s happening today.</div></div>
        <div className="grow" /><div className="date">{today}</div>
      </div>

      <div className="stats">
        <Stat icon="users" label="Total users" value={d.users.total} note={`${d.users.drivers} drivers · ${d.users.customers} customers`} />
        <Stat icon="car" label="Total vehicles" value={d.vehicles.total} note={`${d.vehicles.online} online · ${d.vehicles.total - d.vehicles.online} offline`} />
        <Stat icon="user" label="Active drivers" value={d.users.activeDrivers} note={`${d.users.suspended} suspended`} />
      </div>

      <div className={'alert' + (alerts ? '' : ' clear')}>
        <div className={'tile' + (alerts ? ' red' : '')}><Icon name="shield" size={18} /></div>
        <div className="grow">
          <h3>Safety Center</h3>
          <div className="hint">{alerts} open SOS alert{alerts === 1 ? '' : 's'} · {d.safety.slowToAcknowledge} unacknowledged over 60 s</div>
        </div>
        <Link className={'btn ' + (alerts ? 'outline-red' : 'ghost')} to="/safety">Open Safety Center</Link>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="cardhead"><div><h3>Trip volume</h3><div className="hint">Completed, cancelled and total · monthly</div></div><Pill>{year}</Pill></div>
          <div className="total">{yearTrips}</div>
          <LineChart labels={MONTHS} values={total} />
        </div>
        <div className="card">
          <div className="cardhead"><div><h3>Total revenue</h3><div className="hint">From all completed trips · monthly</div></div><Pill>{year}</Pill></div>
          <div className="total green">{naira(yearRevenue)}</div>
          <LineChart labels={MONTHS} values={revenue} format={(n) => naira(n)} />
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Trip activity</h3>
          <div className="grid g3" style={{ marginTop: 12 }}>
            <div><div className="note">Total requests</div><div className="big">{d.activity.total}</div></div>
            <div><div className="note">This month</div><div className="big">{d.activity.thisMonth}</div></div>
            <div><div className="note">Today</div><div className="big">{d.activity.today}</div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Pill tone="green">Completed {d.activity.completedToday}</Pill><Pill tone="blue">Ongoing {d.activity.ongoing}</Pill><Pill tone="red">Cancelled {d.activity.cancelledToday}</Pill>
          </div>
        </div>
        <div className="card">
          <div className="cardhead"><div><h3>Finance snapshot</h3></div><Pill tone="green">Live</Pill></div>
          <div className="note" style={{ marginTop: 10 }}>Today&apos;s revenue</div>
          <div className="total green" style={{ marginTop: 2 }}>{naira(d.finance.todayKobo)}</div>
          <div className="note" style={{ marginTop: 8 }}>Pending payouts {naira(d.finance.pendingPayoutKobo)} · awaiting approval {d.finance.awaitingApproval}</div>
        </div>
      </div>
    </>
  );
}
