import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AdjustModal } from '../adjust';
import { Toast } from '../bits';
import { Loading, dateTime, duration, naira, paymentChip, statusChip, timeOnly, title, useLoad } from '../ui';

interface Trip {
  id: string; code: string; status: string; paymentStatus: string; method: string; category: string; createdAt: string; scheduledFor: string | null;
  pickup: { address: string | null }; dropoff: { address: string | null };
  rider: { id: string; name: string; phone: string };
  driver: { id: string; name: string; phone: string; vehicle: string | null } | null;
  fare: { totalKobo: number; distanceM: number; durationS: number; waitingS: number; outsideEstimate: boolean; lines: { kind: string; label: string; amountKobo: number }[]; rates: { category: string; effectiveFrom: string } | null } | null;
  estimate: { lowKobo: number; highKobo: number } | null;
  timeline: { status: string; reason: string | null; at: string }[];
}

export default function TripDetail() {
  const { id } = useParams();
  const { data: t, error, reload } = useLoad<Trip>(`/admin/console/trips/${id}`);
  const [adjust, setAdjust] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  if (!t) return <Loading error={error} retry={reload} />;
  return (
    <>
      <div className="head">
        <div><Link to="/trips" className="note">← Trips</Link><h1>Trip {t.code}</h1><div className="sub">{dateTime(t.createdAt)} · {title(t.category)} · {title(t.method)}</div></div>
        <div className="grow" />{statusChip(t.status)}{paymentChip(t.paymentStatus)}
        {t.status === 'TRIP_COMPLETED' && <button className="btn ghost" onClick={() => setAdjust(true)}>Refund or adjust</button>}
      </div>
      <div className="grid g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card"><h3>Route</h3>
            <div className="line"><span className="note">Pickup</span><span>{t.pickup.address ?? 'Coordinates only'}</span></div>
            <div className="line"><span className="note">Drop-off</span><span>{t.dropoff.address ?? 'Coordinates only'}</span></div>
            {t.fare && <div className="line"><span className="note">Distance</span><span>{(t.fare.distanceM / 1000).toFixed(1)} km</span></div>}</div>
          <div className="card"><h3>People</h3>
            <div className="line"><span className="note">Rider</span><span><Link to={`/people/${t.rider.id}`} style={{ color: 'var(--accent)' }}>{t.rider.name}</Link> · {t.rider.phone}</span></div>
            <div className="line"><span className="note">Driver</span><span>{t.driver ? <><Link to={`/people/${t.driver.id}`} style={{ color: 'var(--accent)' }}>{t.driver.name}</Link> · {t.driver.phone}</> : 'Not assigned'}</span></div>
            {t.driver?.vehicle && <div className="line"><span className="note">Vehicle</span><span>{t.driver.vehicle}</span></div>}</div>
          <div className="card"><h3>Timeline</h3>
            <div className="timeline" style={{ marginTop: 8 }}>{t.timeline.map((h, i) => (
              <div className="tl" key={i}><span className="note">{timeOnly(h.at)}</span><span>{title(h.status)}</span><span className="note">{h.reason ?? ''}</span></div>))}</div></div>
        </div>
        <div className="card" style={{ alignSelf: 'start' }}>
          <h3>Fare snapshot</h3>
          {t.fare ? (
            <>
              {t.fare.rates && <div className="hint">Rates used: {title(t.fare.rates.category)} · effective {dateTime(t.fare.rates.effectiveFrom)}</div>}
              <div style={{ marginTop: 8 }}>
                {t.fare.lines.map((l) => <div className="line" key={l.kind}><span>{l.label}</span><span>{naira(l.amountKobo, true)}</span></div>)}
                <div className="line total"><span>Total</span><span>{naira(t.fare.totalKobo)}</span></div>
              </div>
              {t.estimate && <div className="note" style={{ marginTop: 8 }}>{t.fare.outsideEstimate ? 'Outside' : 'Within'} estimate {naira(t.estimate.lowKobo)} - {naira(t.estimate.highKobo)}</div>}
              <div className="note" style={{ marginTop: 4 }}>Trip time {duration(t.fare.durationS)} · waiting {duration(t.fare.waitingS)}</div>
            </>
          ) : (
            <div className="hint" style={{ marginTop: 8 }}>No fare yet: the trip has not been completed.{t.estimate ? ` Estimate ${naira(t.estimate.lowKobo)} - ${naira(t.estimate.highKobo)}.` : ''}</div>
          )}
        </div>
      </div>
      {adjust && <AdjustModal userId={t.rider.id} rideId={t.id} who={`trip ${t.code}`} onClose={() => setAdjust(false)} onDone={() => setToast('Sent for approval')} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}
