import { Fragment, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get, logout, signedIn } from './api';
import { NotificationBell, NotificationStack, useNotifications } from './Notifications';
import { useConfirm } from './bits';
import { ChangePassword } from './ChangePassword';
import { Icon, IconName } from './ui';

type Role = 'support' | 'finance' | 'admin' | 'business';
interface Child { label: string; icon: IconName; to?: string; roles?: Role[] }
interface Item { label: string; icon: IconName; to?: string; children?: Child[]; roles?: Role[]; end?: boolean }
const OPS: Role[] = ['support', 'admin'];
const MONEY: Role[] = ['finance', 'admin'];

// The full menu from the design. Entries without a page yet are shown but not clickable.
const NAV: { group: string; items: Item[] }[] = [
  { group: 'Overview', items: [{ label: 'Dashboard', icon: 'grid', to: '/', roles: OPS }] },
  {
    group: 'Fleet',
    items: [
      { label: 'Fleet', icon: 'car', to: '/fleet', end: true, roles: ['support', 'admin', 'business'] },
      { label: 'Businesses', icon: 'users', to: '/fleet/businesses', roles: OPS },
    ],
  },
  {
    group: 'Operations',
    items: [
      { label: 'Live operations', icon: 'map', to: '/live', roles: OPS },
      { label: 'Safety Center', icon: 'shield', to: '/safety', roles: OPS },
      { label: 'Users', icon: 'users', roles: OPS, children: [{ label: 'Drivers', icon: 'steer', to: '/drivers' }, { label: 'Customers', icon: 'users', to: '/customers' }] },
      { label: 'Vehicles', icon: 'car', to: '/vehicles', roles: OPS },
      { label: 'Trips', icon: 'pin', to: '/trips', roles: OPS },
      { label: 'Support', icon: 'help', to: '/support', roles: OPS },
    ],
  },
  {
    group: 'Finance',
    items: [
      {
        label: 'Finances', icon: 'wallet', roles: MONEY,
        children: [
          { label: 'Wallet', icon: 'wallet', to: '/finances/wallet' }, { label: 'Revenue', icon: 'trend', to: '/finances/revenue' }, { label: 'Reconciliation', icon: 'refresh', to: '/finances/reconciliation' },
          { label: 'Stakeholder payouts', icon: 'bank2', to: '/finances/stakeholders' }, { label: 'Driver payouts', icon: 'card', to: '/finances/payouts' }, { label: 'Vehicle plans', icon: 'car', to: '/finances/vehicle-plans' },
          { label: 'Adjustments', icon: 'book', to: '/finances/adjustments' }, { label: 'Ledger', icon: 'layers', to: '/finances/ledger' },
        ],
      },
      { label: 'Promo', icon: 'tag', to: '/promo', roles: MONEY },
    ],
  },
  {
    group: 'Administration',
    items: [
      {
        label: 'Setup', icon: 'gear', roles: ['support', 'finance', 'admin'],
        children: [
          { label: 'Asset Type', icon: 'layers', to: '/setup/asset-types' }, { label: 'Trip Fees', icon: 'link', to: '/pricing', roles: OPS }, { label: 'Revenue Setup', icon: 'pie', to: '/setup/revenue' },
          { label: 'Bonus Rules', icon: 'gift' }, { label: 'Bonus Awards', icon: 'award' }, { label: 'Cancellation Policy', icon: 'ban', to: '/setup/cancellation' },
        ],
      },
      { label: 'Team', icon: 'user', roles: ['admin'], children: [{ label: 'Members', icon: 'users', to: '/team' }, { label: 'Roles', icon: 'shield', to: '/team/roles' }] },
      { label: 'Referrals', icon: 'share', roles: ['admin'] },
      { label: 'Activity Logs', icon: 'activity', to: '/activity', roles: ['admin'] },
    ],
  },
];

/** Breadcrumb trail for each page, like "Dashboard / Setup / Trip Fees". */
const CRUMBS: [string, string[]][] = [
  ['/live', ['Operations', 'Live operations']], ['/finances/revenue', ['Finances', 'Revenue']], ['/finances/ledger', ['Finances', 'Ledger']], ['/safety', ['Operations', 'Safety Center']], ['/customers', ['Users', 'Customers']],
  ['/trips', ['Trips']], ['/pricing', ['Setup', 'Trip Fees']], ['/setup/asset-types', ['Setup', 'Asset Type']], ['/setup/revenue', ['Setup', 'Revenue Setup']], ['/setup/cancellation', ['Setup', 'Cancellation Policy']],
  ['/finances/stakeholders', ['Finances', 'Stakeholder payouts']], ['/promo', ['Promo']], ['/support', ['Support']], ['/drivers', ['Users', 'Drivers']], ['/onboarding', ['Users', 'Drivers', 'Onboarding']],
  ['/people', ['Users', 'Profile']], ['/vehicles', ['Vehicles']], ['/finances/wallet', ['Finances', 'Wallet']], ['/finances/payouts', ['Finances', 'Driver payouts']], ['/finances/vehicle-plans', ['Finances', 'Vehicle plans']], ['/fleet/businesses', ['Fleet', 'Businesses']], ['/fleet', ['Fleet']],
  ['/finances/adjustments', ['Finances', 'Adjustments']], ['/finances/reconciliation', ['Finances', 'Reconciliation']], ['/activity', ['Activity Logs']], ['/team/roles', ['Team', 'Roles']], ['/team', ['Team', 'Members']],
];
export interface Me { name: string; role: string; email?: string; mustChangePassword?: boolean }

const roleLabel = (r?: string) => (r === 'admin' ? 'Admin' : r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Staff');

function Soon({ icon, label, sub, collapsed }: { icon: IconName; label: string; sub?: boolean; collapsed?: boolean }) {
  return (
    <div className={'nav soon' + (sub ? ' sub' : '')} title={collapsed ? `${label} (coming soon)` : 'Coming soon'} aria-disabled="true">
      <Icon name={icon} size={sub ? 16 : 19} /><span>{label}</span>
    </div>
  );
}

export default function Layout({ toggleTheme }: { toggleTheme: () => void }) {
  const notices = useNotifications(signedIn());
  const [me, setMe] = useState<Me | null>(null);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('side') === '1'; } catch { return false; } });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState(false);
  const [changing, setChanging] = useState(false);
  const confirm = useConfirm();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { get('/me').then(setMe).catch(() => undefined); }, []);
  const [, newMinute] = useState(0);
  useEffect(() => { const t = setInterval(() => newMinute((n) => n + 1), 60_000); return () => clearInterval(t); }, []); // the date in the header moves on at midnight
  // Finance staff have no dashboard: send them to the money overview.
  useEffect(() => { if (me?.role === 'finance' && loc.pathname === '/') nav('/finances/wallet', { replace: true }); if (me?.role === 'business' && loc.pathname === '/') nav('/fleet', { replace: true }); }, [me, loc.pathname, nav]);
  useEffect(() => { try { localStorage.setItem('side', collapsed ? '1' : '0'); } catch { /* not saved */ } }, [collapsed]);
  const trail = loc.pathname === '/' ? [] : (CRUMBS.find(([p]) => loc.pathname.startsWith(p))?.[1] ?? []);
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric' });
  const initials = (me?.name ?? 'S').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="shell">
      <aside className={'side' + (collapsed ? ' collapsed' : '')}>
        <div className="brand">
          <span className="logo">9<i>ja</i>Ride<sup>Pro</sup></span>
          <span className="role">{me?.role === 'admin' ? 'SuperAdmin' : roleLabel(me?.role)}</span>
        </div>
        <nav className="menu">
          {NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || !me || i.roles.includes(me.role as Role)) })).filter((g) => g.items.length > 0).map((g) => (
            <Fragment key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((i) => {
                if (i.children) {
                  const live = i.children.some((c) => c.to && loc.pathname.startsWith(c.to));
                  const expanded = open[i.label] ?? live;
                  return (
                    <div key={i.label}>
                      <button className={'nav' + (live ? ' on' : '')} onClick={() => (collapsed ? setCollapsed(false) : setOpen({ ...open, [i.label]: !expanded }))} aria-expanded={expanded} title={collapsed ? i.label : undefined}>
                        <Icon name={i.icon} size={19} /><span>{i.label}</span>
                        <span className="chev"><Icon name={expanded ? 'chevU' : 'chevD'} size={14} /></span>
                      </button>
                      {expanded && !collapsed && (
                        <div className="sub-nav">
                          {i.children.filter((c) => !c.roles || !me || c.roles.includes(me.role as Role)).map((c) => c.to
                            ? <NavLink key={c.label} to={c.to} className={({ isActive }) => 'nav sub' + (isActive ? ' on' : '')}><Icon name={c.icon} size={16} /><span>{c.label}</span></NavLink>
                            : <Soon key={c.label} icon={c.icon} label={c.label} sub />)}
                        </div>
                      )}
                    </div>
                  );
                }
                return i.to
                  ? <NavLink key={i.label} to={i.to} end={i.to === '/' || i.end} title={collapsed ? i.label : undefined} className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}><Icon name={i.icon} size={19} /><span>{i.label}</span></NavLink>
                  : <Soon key={i.label} icon={i.icon} label={i.label} collapsed={collapsed} />;
              })}
            </Fragment>
          ))}
        </nav>
        <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name={collapsed ? 'chevR' : 'chevL'} size={16} /><span>Collapse</span>
        </button>
      </aside>
      <div className="main">
        <header className="top">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className={trail.length ? '' : 'last'}>Dashboard</span>
            {trail.map((t, n) => <Fragment key={t}><span className="sep">/</span><span className={n === trail.length - 1 ? 'last' : ''}>{t}</span></Fragment>)}
          </nav>
          <div className="grow" />
          <NotificationBell api={notices} />
          <button className="icon-btn" onClick={toggleTheme} aria-label="Switch light or dark"><Icon name="sun" /></button>
          <span className="vr" />
          <button className="user" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
            <span className="avatar">{initials}</span>
            <span className="who">{me?.name ?? 'Staff'}<span>{me ? me.role === 'admin' ? 'superadmin' : me.role : ''}</span></span>
            <Icon name="chevD" size={14} />
          </button>
          {menu && (
            <div className="menu-pop" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { setMenu(false); setChanging(true); }}><Icon name="shield" size={16} /> Change password</button>
              <button role="menuitem" onClick={() => { setMenu(false); confirm.ask({ title: 'Sign out?', text: 'You will need your email and password to get back in.', confirm: 'Yes, sign out' }, async () => { await logout(); nav('/login'); }); }}><Icon name="out" size={16} /> Sign out</button>
            </div>
          )}
        </header>
        <main className="page"><Outlet context={{ me, today }} /></main>
        <NotificationStack api={notices} />
      </div>
      {confirm.node}
      {me && (changing || me.mustChangePassword) && me.email && <ChangePassword email={me.email} forced={me.mustChangePassword && !changing} onClose={() => setChanging(false)} onDone={() => { setChanging(false); get('/me').then(setMe); }} />}
    </div>
  );
}
