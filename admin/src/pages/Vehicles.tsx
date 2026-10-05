import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pager, SearchBox } from '../bits';
import { arrangementLabel, formatPlate, Loading, Stat, title, useLoad } from '../ui';

interface List {
  total: number; page: number; pageSize: number; counts: { total: number; active: number; online: number };
  items: { id: string; plate: string; make: string; colour: string; category: string; arrangement: string; active: boolean; suspended: boolean; driverId: string; driver: string; driverStatus: string; online: boolean }[];
}

export default function Vehicles() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: d, error, reload } = useLoad<List>(`/admin/console/vehicles?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  return (
    <>
      <div className="head"><div><h1>Vehicles</h1><div className="sub">Every vehicle registered by a driver</div></div></div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <>
          <div className="stats">
            <Stat icon="car" label="Total vehicles" value={d.counts.total} />
            <Stat icon="check" label="In use" value={d.counts.active} />
            <Stat icon="user" label="Online now" value={d.counts.online} tone="blue" />
          </div>
          <div style={{ margin: '14px 0' }}><SearchBox placeholder="Search plate, make or driver" onSearch={(s) => { setSearch(s); setPage(1); }} /></div>
          <div className="card" style={{ padding: 0 }}>
            {d.items.length === 0 ? <div className="empty">No vehicles match.</div> : (
              <table><thead><tr><th>Plate</th><th>Vehicle</th><th>Category</th><th>Arrangement</th><th>Driver</th><th>State</th></tr></thead><tbody>
                {d.items.map((v) => (
                  <tr key={v.id} className="link" onClick={() => nav(`/vehicles/${v.id}`)}>
                    <td><b>{formatPlate(v.plate)}</b></td><td>{v.colour} {v.make}</td><td>{title(v.category)}</td><td>{arrangementLabel(v.arrangement)}</td><td>{v.driver}</td>
                    <td>{!v.active ? <span className="chip grey">Retired</span> : v.suspended ? <span className="chip red">Suspended</span> : v.driverStatus === 'suspended' ? <span className="chip red">Driver suspended</span> : v.online ? <span className="chip blue">Online</span> : <span className="chip">Offline</span>}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </div>
        </>
      )}
    </>
  );
}
