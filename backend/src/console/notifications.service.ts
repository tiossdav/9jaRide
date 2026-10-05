import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { Role } from '../auth/auth.types';
import { PG_POOL } from '../common/infra.module';

export type NoticeType = 'sos' | 'booking' | 'driver' | 'rider' | 'verification' | 'payment' | 'vehicle' | 'support';
export interface Notice {
  id: string; // stable, so the portal never shows the same event twice
  type: NoticeType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  text: string;
  at: string;
  link: string; // the portal page that deals with it
}

/** Which kinds of event each team sees. Money events go to finance and admin; the operational ones to support and admin. */
const MONEY: NoticeType[] = ['payment'];
const OPERATIONS: NoticeType[] = ['sos', 'booking', 'driver', 'rider', 'verification', 'vehicle', 'support'];
const sees = (role: Role): NoticeType[] => (role === 'admin' ? [...OPERATIONS, ...MONEY] : role === 'finance' ? MONEY : OPERATIONS);

/**
 * What happened lately, for the pop-ups at the top right of the admin portal. Built from the records themselves, so
 * nothing extra has to be written when something happens and nothing can be missed. The portal asks every few seconds.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params)).rows;
  }

  async feed(role: Role, since: Date) {
    const allowed = new Set(sees(role));
    const items: Notice[] = [];
    const add = (n: Notice) => { if (allowed.has(n.type)) items.push(n); };
    const naira = (kobo: unknown) => '₦' + (Number(kobo) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });

    if (allowed.has('sos')) {
      for (const s of await this.q(
        `SELECT s.id, s.raised_by_role, s.created_at, u.full_name, u.phone, r.short_code FROM sos_events s JOIN users u ON u.id = s.raised_by LEFT JOIN rides r ON r.id = s.ride_id
          WHERE s.created_at > $1 ORDER BY s.created_at DESC LIMIT 20`, [since],
      )) {
        add({ id: `sos:${s.id}`, type: 'sos', severity: 'critical', title: 'SOS emergency alert', text: `${s.full_name} (${s.raised_by_role}) pressed SOS${s.short_code ? ` on trip ${s.short_code}` : ''}. ${s.phone}`, at: s.created_at, link: `/safety/${s.id}` });
      }
    }
    if (allowed.has('verification')) {
      for (const a of await this.q(
        `SELECT a.id, a.submitted_at, a.arrangement, u.full_name FROM driver_applications a JOIN users u ON u.id = a.driver_id WHERE a.status = 'SUBMITTED' AND a.submitted_at > $1 ORDER BY a.submitted_at DESC LIMIT 20`, [since],
      )) add({ id: `app:${a.id}:${new Date(a.submitted_at).getTime()}`, type: 'verification', severity: 'info', title: 'Driver waiting for verification', text: `${a.full_name} submitted an application.`, at: a.submitted_at, link: `/onboarding/${a.id}` });
    }
    if (allowed.has('driver') || allowed.has('rider')) {
      for (const u of await this.q(`SELECT id, role, full_name, created_at FROM users WHERE created_at > $1 ORDER BY created_at DESC LIMIT 30`, [since])) {
        add(u.role === 'driver'
          ? { id: `user:${u.id}`, type: 'driver', severity: 'info', title: 'New driver signed up', text: `${u.full_name} created a driver account.`, at: u.created_at, link: `/people/${u.id}` }
          : { id: `user:${u.id}`, type: 'rider', severity: 'info', title: 'New rider joined', text: `${u.full_name} created an account.`, at: u.created_at, link: `/people/${u.id}` });
      }
    }
    if (allowed.has('booking')) {
      for (const r of await this.q(
        `SELECT r.id, r.short_code, r.category, r.status, r.created_at, r.updated_at, u.full_name FROM rides r JOIN users u ON u.id = r.rider_id
          WHERE r.created_at > $1 OR (r.status = 'NO_DRIVER_FOUND' AND r.updated_at > $1) ORDER BY r.updated_at DESC LIMIT 30`, [since],
      )) {
        if (r.status === 'NO_DRIVER_FOUND') add({ id: `ride-nodriver:${r.id}`, type: 'booking', severity: 'warning', title: 'No driver found', text: `Booking ${r.short_code} from ${r.full_name} found no driver.`, at: r.updated_at, link: `/trips/${r.id}` });
        if (new Date(r.created_at) > since) add({ id: `ride:${r.id}`, type: 'booking', severity: 'info', title: 'New booking', text: `${r.full_name} requested a ${r.category} ride (${r.short_code}).`, at: r.created_at, link: `/trips/${r.id}` });
      }
    }
    if (allowed.has('support')) {
      for (const t of await this.q(`SELECT t.id, t.short_code, t.topic, t.created_at, u.full_name FROM support_tickets t JOIN users u ON u.id = t.raised_by WHERE t.created_at > $1 ORDER BY t.created_at DESC LIMIT 20`, [since])) {
        add({ id: `ticket:${t.id}`, type: 'support', severity: 'info', title: 'New support report', text: `${t.full_name}: ${t.topic} (${t.short_code}).`, at: t.created_at, link: `/support/${t.id}` });
      }
    }
    if (allowed.has('vehicle')) {
      for (const v of await this.q(
        `SELECT e.id, e.status, e.reason, e.created_at, v.id AS vehicle_id, v.plate FROM vehicle_status_events e JOIN vehicles v ON v.id = e.vehicle_id WHERE e.created_at > $1 ORDER BY e.id DESC LIMIT 20`, [since],
      )) add({ id: `vehicle:${v.id}`, type: 'vehicle', severity: v.status === 'suspended' ? 'warning' : 'info', title: `Vehicle ${v.status}`, text: `${v.plate}: ${v.reason}`, at: v.created_at, link: `/vehicles/${v.vehicle_id}` });
    }
    if (allowed.has('payment')) {
      for (const p of await this.q(
        `SELECT p.id, p.amount_kobo, p.created_at, u.full_name FROM payout_requests p JOIN users u ON u.id = p.driver_id WHERE p.status = 'PENDING_APPROVAL' AND p.created_at > $1 ORDER BY p.created_at DESC LIMIT 20`, [since],
      )) add({ id: `payout:${p.id}`, type: 'payment', severity: 'info', title: 'Payout waiting for approval', text: `${p.full_name} asked for ${naira(p.amount_kobo)}.`, at: p.created_at, link: '/finances/payouts' });
      for (const a of await this.q(
        `SELECT a.id, a.kind, a.amount_kobo, a.created_at, u.full_name FROM ledger_adjustments a JOIN users u ON u.id = a.user_id WHERE a.status = 'PENDING_APPROVAL' AND a.created_at > $1 ORDER BY a.created_at DESC LIMIT 20`, [since],
      )) add({ id: `adjust:${a.id}`, type: 'payment', severity: 'info', title: 'Adjustment waiting for approval', text: `${a.kind} of ${naira(a.amount_kobo)} for ${a.full_name}.`, at: a.created_at, link: '/finances/adjustments' });
    }

    items.sort((a, b) => +new Date(b.at) - +new Date(a.at));

    // Emergencies that nobody has taken yet stay on the list however old they are, so an alert is never lost by reloading.
    const open = allowed.has('sos')
      ? (await this.q(
          `SELECT s.id, s.raised_by_role, s.created_at, s.escalated_at, u.full_name, u.phone, r.id AS ride_id, r.short_code, ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng
             FROM sos_events s JOIN users u ON u.id = s.raised_by LEFT JOIN rides r ON r.id = s.ride_id WHERE s.status = 'OPEN' ORDER BY s.created_at`,
        )).map((s) => ({
          id: s.id, at: s.created_at, role: s.raised_by_role, person: s.full_name, phone: s.phone, trip: s.short_code, tripId: s.ride_id,
          location: s.lat == null ? null : { lat: s.lat, lng: s.lng }, escalated: s.escalated_at != null,
        }))
      : [];
    const [{ now }] = await this.q<{ now: Date }>(`SELECT now() AS now`);
    return { now, items: items.slice(0, 40), openSos: open };
  }
}
