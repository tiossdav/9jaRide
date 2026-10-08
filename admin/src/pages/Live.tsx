import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { LiveMap, Loading, MapDot, Pill, Stat, duration, useLoad } from '../ui';

interface Live {
  onlineDrivers: number;
  activeDrivers: number;
  drivers: { id: string; status: string; lat: number; lng: number }[];
  activeRides: { id: string; code: string; status: string; category: string; driver: string | null; driverId: string | null; rider: string; changedAt: string | null; pickup: { lat: number; lng: number } }[];
  searching: { count: number; longestWaitSeconds: number };
  noDriverLastHour: number;
}

export default function LiveOperations() {
  const { data: d, error, reload } = useLoad<Live>('/admin/console/live', 5_000);
  // Drivers where their phones are. Riders waiting for a car are shown at their pickup point (the rider app does not share its
  // position); once the trip starts the rider is in the car, so the driver's dot says who is on board.
  const dots = useMemo<MapDot[]>(() => {
    const rides = d?.activeRides ?? [];
    const drivers = (d?.drivers ?? []).map((x) => {
      const ride = rides.find((r) => r.driverId === x.id);
      return { lat: x.lat, lng: x.lng, color: x.status === 'in_transit' ? '#d4a237' : '#34c759', label: ride ? `${ride.driver ?? 'Driver'}${ride.status === 'IN_TRANSIT' ? ` with ${ride.rider}` : ` going to ${ride.rider}`}` : x.status === 'in_transit' ? 'On trip' : 'Online' };
    });
    const waiting = rides.filter((r) => r.status !== 'IN_TRANSIT' && r.pickup?.lat != null).map((r) => ({ lat: r.pickup.lat, lng: r.pickup.lng, color: '#3b82f6', label: `Rider ${r.rider} waiting (${r.code})` }));
    return [...drivers, ...waiting];
  }, [d]);
  if (!d) return <Loading error={error} retry={reload} />;
  const toPickup = d.activeRides.filter((r) => r.status !== 'IN_TRANSIT').length;
  return (
    <>
      <div className="head"><div><h1>Live operations</h1><div className="sub">Drivers and rides right now. Updates every few seconds.</div></div></div>
      {error && <div className="banner">Could not refresh: {error}. Showing the last update.</div>}
      <div className="stats">
        <Stat icon="user" label="Online drivers" value={d.onlineDrivers} note={`of ${d.activeDrivers} active`} />
        <Stat icon="pin" label="Active rides" value={d.activeRides.length} note={`${toPickup} to pickup · ${d.activeRides.length - toPickup} in transit`} />
        <Stat icon="search" label="Searching" value={d.searching.count} note={`longest wait ${duration(d.searching.longestWaitSeconds)}`} />
        <Stat icon="warn" label="No driver found (1 h)" value={d.noDriverLastHour} />
      </div>
      <div className="grid g21" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Live map</h3>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}><Pill tone="green">● Online</Pill><Pill tone="amber">● In transit</Pill></div>
          <LiveMap dots={dots} />
        </div>
        <div className="card">
          <h3>Active rides</h3>
          {d.activeRides.length === 0 ? <div className="empty">No rides in progress.</div> : (
            <div className="mini-table"><table><thead><tr><th>Trip</th><th>Driver</th><th>Rider</th><th>State</th></tr></thead><tbody>
              {d.activeRides.map((r) => (
                <tr key={r.id}><td><Link to={`/trips/${r.id}`}>{r.code}</Link></td><td>{r.driver ?? '-'}</td><td>{r.rider}</td><td><span className={r.status === 'IN_TRANSIT' ? 'chip blue' : 'chip amber'}>{({ DRIVER_ASSIGNED: 'To pickup', DRIVER_ARRIVED: 'Arrived', IN_TRANSIT: 'In trip' } as Record<string, string>)[r.status] ?? r.status}</span></td></tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      </div>
    </>
  );
}
