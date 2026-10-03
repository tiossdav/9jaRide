import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { setExpiredHandler, signedIn } from './api';
import Layout from './Layout';
import Customers from './pages/Customers';
import Activity from './pages/Activity';
import Dashboard from './pages/Dashboard';
import Drivers from './pages/Drivers';
import { Adjustments, Payouts, Reconciliation, Wallet } from './pages/Finance';
import OnboardingDetail from './pages/OnboardingDetail';
import Person from './pages/Person';
import { LedgerPage, Revenue } from './pages/Insights';
import VehicleDetail from './pages/VehicleDetail';
import Vehicles from './pages/Vehicles';
import { AssetTypes, StakeholderPayouts } from './pages/Catalog';
import Promos from './pages/Promos';
import { CancellationPolicy, RevenueSetup } from './pages/Rules';
import { SupportQueue, TicketDetail } from './pages/SupportDesk';
import { MemberDetail, Members, Roles } from './pages/Team';
import Live from './pages/Live';
import Login from './pages/Login';
import Pricing from './pages/Pricing';
import Safety from './pages/Safety';
import SosDetail from './pages/SosDetail';
import TripDetail from './pages/TripDetail';
import Trips from './pages/Trips';

export default function App() {
  const nav = useNavigate();
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('theme') ?? 'dark'; } catch { return 'dark'; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* not saved in a private window */ }
  }, [theme]);
  useEffect(() => { setExpiredHandler(() => nav('/login')); }, [nav]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={signedIn() ? <Layout toggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} /> : <Navigate to="/login" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="live" element={<Live />} />
        <Route path="safety" element={<Safety />} />
        <Route path="safety/:id" element={<SosDetail />} />
        <Route path="customers" element={<Customers />} />
        <Route path="trips" element={<Trips />} />
        <Route path="trips/:id" element={<TripDetail />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="onboarding/:id" element={<OnboardingDetail />} />
        <Route path="people/:id" element={<Person />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="finances/wallet" element={<Wallet />} />
        <Route path="finances/payouts" element={<Payouts />} />
        <Route path="finances/adjustments" element={<Adjustments />} />
        <Route path="finances/reconciliation" element={<Reconciliation />} />
        <Route path="finances/revenue" element={<Revenue />} />
        <Route path="finances/ledger" element={<LedgerPage />} />
        <Route path="setup/asset-types" element={<AssetTypes />} />
        <Route path="setup/revenue" element={<RevenueSetup />} />
        <Route path="setup/cancellation" element={<CancellationPolicy />} />
        <Route path="finances/stakeholders" element={<StakeholderPayouts />} />
        <Route path="promo" element={<Promos />} />
        <Route path="support" element={<SupportQueue />} />
        <Route path="support/:id" element={<TicketDetail />} />
        <Route path="activity" element={<Activity />} />
        <Route path="team" element={<Members />} />
        <Route path="team/:id" element={<MemberDetail />} />
        <Route path="team/roles" element={<Roles />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
