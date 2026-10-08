import { useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { sendForm } from '../api';
import { Pager, PlateInput, SearchBox, Segmented, Toast, go, useConfirm } from '../bits';
import { post } from '../api';
import { AuthImage, Loading, Modal, Pill, Stat, formatPlate, isValidPlate, plateProblem, title, useLoad } from '../ui';

export interface FleetVehicle {
  id: string; plate: string; makeModel: string; colour: string; category: string; year: number | null; status: string; photoFileId: string | null;
  business: { id: string; name: string } | null; driver: { id: string; name: string } | null; deductionBps: number | null; available: boolean;
}
interface List { total: number; page: number; pageSize: number; counts: { total: number; pending: number; available: number; assigned: number }; items: FleetVehicle[] }
export interface Business { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; defaultDeductionBps: number; status: string; vehicles: number; drivers: number; collectedKobo: number }

const STATUS = [['all', 'All'], ['pending', 'Waiting to be verified'], ['verified', 'Verified'], ['suspended', 'Suspended'], ['retired', 'Retired']] as const;
const CATEGORIES = [['', 'Any category'], ['regular', 'Regular'], ['comfort', 'Comfort'], ['package', 'Send Package']] as const;

export const vehicleChip = (v: { status: string; driver: unknown; available?: boolean }) =>
  v.status === 'pending' ? <Pill tone="amber">Waiting to be verified</Pill> : v.status === 'suspended' ? <Pill tone="red">Suspended</Pill> : v.status === 'retired' ? <Pill>Retired</Pill>
    : v.driver ? <Pill tone="blue">With a driver</Pill> : <Pill tone="green">Available</Pill>;

export default function Fleet() {
  const nav = useNavigate();
  const { me } = useOutletContext<{ me: { role: string } | null }>();
  const isBusiness = me?.role === 'business';
  const canEdit = me?.role === 'admin' || isBusiness;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS)[number][0]>('all');
  const [category, setCategory] = useState('');
  const [business, setBusiness] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page), status, ...(search ? { search } : {}), ...(category ? { category } : {}), ...(business ? { businessId: business } : {}), ...(onlyFree ? { available: 'true' } : {}) });
  const { data: d, error, reload } = useLoad<List>(`/fleet/vehicles?${qs}`);
  const { data: businesses } = useLoad<Business[]>('/fleet/businesses');
  const done = (text: string) => { setToast(text); reload(); };

  return (
    <>
      <div className="head">
        <div><h1>Fleet</h1><div className="sub">{isBusiness ? 'Your vehicles and who drives them' : 'Vehicles supplied by businesses, and who drives them'}</div></div>
        <div className="grow" />
        {canEdit && <><button className="btn ghost" onClick={() => setImporting(true)}>Import from Excel or CSV</button><button className="btn" onClick={() => setAdding(true)}>Add vehicle</button></>}
      </div>
      {!d ? <Loading error={error} retry={reload} /> : (
        <>
          <div className="stats">
            <Stat icon="car" label="Vehicles" value={d.counts.total} />
            <Stat icon="clock" label="Waiting to be verified" value={d.counts.pending} tone={d.counts.pending ? 'amber' : undefined} />
            <Stat icon="check" label="Available to give out" value={d.counts.available} tone="green" />
            <Stat icon="steer" label="With a driver" value={d.counts.assigned} tone="blue" />
          </div>
          <div style={{ display: 'flex', gap: 12, margin: '14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchBox placeholder="Search plate, model, colour or business" onSearch={(s) => { setSearch(s); setPage(1); }} />
            <Segmented options={STATUS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
            <select className="select" style={{ width: 150 }} aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {!isBusiness && businesses && <select className="select" style={{ width: 180 }} aria-label="Business" value={business} onChange={(e) => { setBusiness(e.target.value); setPage(1); }}><option value="">All businesses</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" checked={onlyFree} onChange={(e) => { setOnlyFree(e.target.checked); setPage(1); }} /> Only vehicles that are free</label>
          </div>
          <div className="card" style={{ padding: 0 }}>
            {d.items.length === 0 ? <div className="empty">{d.counts.total === 0 ? 'No vehicles yet. Add one, or import a list from Excel or CSV.' : 'No vehicles match.'}</div> : (
              <table><thead><tr><th /><th>Plate</th><th>Vehicle</th><th>Category</th>{!isBusiness && <th>Business</th>}<th>Driver</th><th>State</th></tr></thead><tbody>
                {d.items.map((v) => (
                  <tr key={v.id} className="link" onClick={() => nav(`/fleet/${v.id}`)}>
                    <td style={{ width: 56 }}><AuthImage fileId={v.photoFileId} alt={`${formatPlate(v.plate)} picture`} size={44} /></td>
                    <td><b>{formatPlate(v.plate)}</b></td><td>{v.colour} {v.makeModel}{v.year ? <div className="note">{v.year}</div> : null}</td><td>{title(v.category)}</td>
                    {!isBusiness && <td>{v.business?.name ?? '-'}</td>}
                    <td>{v.driver ? <>{v.driver.name}{v.deductionBps ? <div className="note">{v.deductionBps / 100}% of earnings</div> : null}</> : <span className="note">Nobody</span>}</td>
                    <td>{vehicleChip(v)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </div>
        </>
      )}
      {adding && <AddVehicle businesses={businesses ?? []} isBusiness={isBusiness} onClose={() => setAdding(false)} onDone={() => done('Vehicle added')} />}
      {importing && <ImportVehicles businesses={businesses ?? []} isBusiness={isBusiness} onClose={() => setImporting(false)} onDone={(n) => done(`${n} vehicle${n === 1 ? '' : 's'} imported`)} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

function BusinessPick({ businesses, value, onChange }: { businesses: Business[]; value: string; onChange: (v: string) => void }) {
  return <div className="field"><label htmlFor="fb">Business</label><select id="fb" className="select" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose a business</option>{businesses.filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>;
}

function AddVehicle({ businesses, isBusiness, onClose, onDone }: { businesses: Business[]; isBusiness: boolean; onClose: () => void; onDone: () => void }) {
  const [biz, setBiz] = useState(''); const [plate, setPlate] = useState(''); const [model, setModel] = useState(''); const [colour, setColour] = useState('');
  const [category, setCategory] = useState('regular'); const [year, setYear] = useState(''); const [notes, setNotes] = useState('');
  const confirm = useConfirm();
  const ok = (isBusiness || biz) && isValidPlate(plate) && model.trim().length >= 2 && colour.trim().length >= 2;
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Add a vehicle</h3>
      <div className="note">It starts as waiting to be verified. Verify it once you have checked it; only verified vehicles can be given to drivers.</div>
      {!isBusiness && <BusinessPick businesses={businesses} value={biz} onChange={setBiz} />}
      <div className="grid g2">
        <div className="field"><label htmlFor="fp">Plate number</label><PlateInput id="fp" value={plate} onChange={setPlate} />{plateProblem(plate) && <div className="note" style={{ color: 'var(--red, #d64545)' }}>{plateProblem(plate)}</div>}</div>
        <div className="field"><label htmlFor="fc">Category</label><select id="fc" className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="regular">Regular</option><option value="comfort">Comfort</option><option value="package">Send Package</option></select></div>
        <div className="field"><label htmlFor="fm">Make and model</label><input id="fm" className="input" placeholder="Toyota Corolla" value={model} onChange={(e) => setModel(e.target.value)} /></div>
        <div className="field"><label htmlFor="fo">Colour</label><input id="fo" className="input" placeholder="Silver" value={colour} onChange={(e) => setColour(e.target.value)} /></div>
        <div className="field"><label htmlFor="fy">Year (optional)</label><input id="fy" className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></div>
        <div className="field"><label htmlFor="fn">Notes (optional)</label><input id="fn" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => confirm.ask({ title: `Add ${formatPlate(plate)}?`, text: 'It is added to the fleet list as waiting to be verified.', confirm: 'Yes, add' },
          () => go(() => post('/fleet/vehicles', { ...(isBusiness ? {} : { businessId: biz }), plate, makeModel: model.trim(), colour: colour.trim(), category, ...(year.length === 4 ? { year: Number(year) } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }), () => { onDone(); onClose(); }))}>Add vehicle</button>
      </div>
      {confirm.node}
    </Modal>
  );
}

interface Report { dryRun: boolean; lines: number; valid: number; imported: number; rejected: number; errors: { row: number; plate: string | null; message: string }[] }

/** Import in two steps: check the file first and see every problem, then import what is good. */
function ImportVehicles({ businesses, isBusiness, onClose, onDone }: { businesses: Business[]; isBusiness: boolean; onClose: () => void; onDone: (n: number) => void }) {
  const [biz, setBiz] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file); form.append('dryRun', String(dryRun));
      if (!isBusiness) form.append('businessId', biz);
      const r = await sendForm<Report>('/fleet/vehicles/import', form);
      setReport(r);
      if (!dryRun) onDone(r.imported);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ready = !!file && (isBusiness || !!biz);
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>Import vehicles</h3>
      <div className="note">Use an Excel (.xlsx) or CSV file with the columns plate, make_model, colour and category (year, vin and notes are optional). <a href={`${(import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'}/fleet/template.csv`} style={{ color: 'var(--accent)' }} onClick={async (e) => { e.preventDefault(); const { download } = await import('../api'); await download('/fleet/template.csv', 'vehicles-template.csv'); }}>Download a blank file</a></div>
      {!isBusiness && <BusinessPick businesses={businesses} value={biz} onChange={(v) => { setBiz(v); setReport(null); }} />}
      <div className="field"><label htmlFor="ff">File</label>
        <input id="ff" ref={input} className="input" type="file" accept=".csv,.xlsx,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(null); }} /></div>
      {error && <div className="banner error" role="alert">{error}</div>}
      {report && (
        <div>
          <div className="banner" role="status" style={{ marginBottom: 8 }}>
            {report.dryRun ? <><b>{report.valid}</b> of {report.lines} lines are good{report.rejected ? <>; <b>{report.rejected}</b> need fixing</> : ''}. Nothing has been saved yet.</> : <><b>{report.imported}</b> vehicle{report.imported === 1 ? '' : 's'} imported{report.rejected ? <>; <b>{report.rejected}</b> skipped</> : ''}.</>}
          </div>
          {report.errors.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table><thead><tr><th>Line</th><th>Plate</th><th>What is wrong</th></tr></thead><tbody>
                {report.errors.map((x, i) => <tr key={i}><td>{x.row}</td><td>{x.plate ? formatPlate(x.plate) : '-'}</td><td>{x.message}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>{report && !report.dryRun ? 'Close' : 'Cancel'}</button>
        {!(report && !report.dryRun) && <button className="btn ghost" disabled={!ready || busy} onClick={() => send(true)}>{busy && !report ? 'Checking…' : 'Check the file'}</button>}
        {report?.dryRun && report.valid > 0 && <button className="btn" disabled={busy} onClick={() => send(false)}>{busy ? 'Importing…' : `Import ${report.valid} vehicle${report.valid === 1 ? '' : 's'}`}</button>}
      </div>
    </Modal>
  );
}
