import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { VehiclePlansService } from '../vehicle-plans/vehicle-plans.service';

const TZ = `'Africa/Lagos'`;
const ACTIVE = `('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED')`;
const CANCELLED = `('CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM', 'NO_DRIVER_FOUND')`;

export interface TripQuery {
  search?: string;
  status?: 'completed' | 'cancelled' | 'active' | 'scheduled';
  page: number;
  pageSize: number;
}

/** Read-only numbers and lists behind the admin portal. Money is integer kobo, as everywhere else. */
@Injectable()
export class ConsoleService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS) private readonly redis: Redis, private readonly plans: VehiclePlansService) {}

  private async q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params)).rows;
  }

  /** Drivers whose app has pinged in the last 20 seconds, with where they are. */
  private async onlineDrivers(): Promise<{ id: string; status: string; lat: number; lng: number }[]> {
    const out: { id: string; status: string; lat: number; lng: number }[] = [];
    let cursor = '0';
    do {
      const [next, found] = await this.redis.scan(cursor, 'MATCH', 'driver:*:state', 'COUNT', 200);
      cursor = next;
      for (const key of found) {
        const s = await this.redis.hgetall(key);
        if (s.lat && s.lng) out.push({ id: key.split(':')[1], status: s.status ?? 'idle', lat: Number(s.lat), lng: Number(s.lng) });
      }
    } while (cursor !== '0');
    return out;
  }

  // ------------------------------------------------------------------ dashboard

  async dashboard() {
    const [people] = await this.q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE role = 'driver')::int AS drivers,
              count(*) FILTER (WHERE role = 'rider')::int AS riders,
              count(*) FILTER (WHERE role = 'driver' AND status = 'active')::int AS active_drivers,
              count(*) FILTER (WHERE status = 'suspended')::int AS suspended
         FROM users`,
    );
    const [vehicles] = await this.q(`SELECT count(*)::int AS total FROM vehicles WHERE active`);
    const online = await this.onlineDrivers();
    const [safety] = await this.q(
      `SELECT count(*) FILTER (WHERE status <> 'RESOLVED')::int AS open,
              count(*) FILTER (WHERE status = 'OPEN' AND created_at < now() - interval '60 seconds')::int AS slow
         FROM sos_events`,
    );
    const months = await this.q(
      `SELECT extract(month FROM created_at AT TIME ZONE ${TZ})::int AS m,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'TRIP_COMPLETED')::int AS completed,
              count(*) FILTER (WHERE status IN ${CANCELLED})::int AS cancelled
         FROM rides
        WHERE created_at AT TIME ZONE ${TZ} >= date_trunc('year', now() AT TIME ZONE ${TZ})
        GROUP BY 1 ORDER BY 1`,
    );
    const revenue = await this.q(
      `SELECT extract(month FROM r.created_at AT TIME ZONE ${TZ})::int AS m, sum(f.total_kobo)::bigint AS kobo
         FROM rides r JOIN ride_fares f ON f.ride_id = r.id
        WHERE r.status = 'TRIP_COMPLETED' AND r.created_at AT TIME ZONE ${TZ} >= date_trunc('year', now() AT TIME ZONE ${TZ})
        GROUP BY 1 ORDER BY 1`,
    );
    const [activity] = await this.q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at AT TIME ZONE ${TZ} >= date_trunc('month', now() AT TIME ZONE ${TZ}))::int AS this_month,
              count(*) FILTER (WHERE created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ}))::int AS today,
              count(*) FILTER (WHERE created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ}) AND status IN ${CANCELLED})::int AS today_cancelled,
              count(*) FILTER (WHERE status IN ${ACTIVE})::int AS ongoing
         FROM rides`,
    );
    // "Today" is always the Lagos calendar day, worked out from the clock each time, so the numbers start again from zero at
    // midnight without anything being reset. A trip counts on the day it finished, not the day it was booked.
    const [today] = await this.q(
      `SELECT COALESCE(sum(f.total_kobo), 0)::bigint AS kobo, count(*)::int AS completed
         FROM rides r JOIN ride_fares f ON f.ride_id = r.id
        WHERE r.status = 'TRIP_COMPLETED' AND f.created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ})`,
    );
    const [fresh] = await this.q(
      `SELECT (SELECT count(*) FROM users WHERE role = 'rider' AND created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ}))::int AS riders,
              (SELECT count(*) FROM users WHERE role = 'driver' AND created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ}))::int AS drivers,
              (SELECT count(*) FROM sos_events WHERE created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ}))::int AS sos`,
    );
    const [payouts] = await this.q(
      `SELECT COALESCE(sum(amount_kobo), 0)::bigint AS kobo, count(*)::int AS n FROM payout_requests WHERE status IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING')`,
    );
    const [awaiting] = await this.q(`SELECT count(*)::int AS n FROM payout_requests WHERE status = 'PENDING_APPROVAL'`);

    return {
      users: { total: people.total, drivers: people.drivers, customers: people.riders, activeDrivers: people.active_drivers, suspended: people.suspended },
      vehicles: { total: vehicles.total, online: online.length },
      safety: { openAlerts: safety.open, slowToAcknowledge: safety.slow },
      tripsByMonth: months.map((r) => ({ month: r.m, total: r.total, completed: r.completed, cancelled: r.cancelled })),
      revenueByMonth: revenue.map((r) => ({ month: r.m, kobo: Number(r.kobo) })),
      activity: {
        total: activity.total, thisMonth: activity.this_month, today: activity.today,
        completedToday: today.completed, cancelledToday: activity.today_cancelled, ongoing: activity.ongoing,
      },
      newToday: { riders: fresh.riders, drivers: fresh.drivers, sos: fresh.sos },
      finance: { todayKobo: Number(today.kobo), pendingPayoutKobo: Number(payouts.kobo), pendingPayouts: payouts.n, awaitingApproval: awaiting.n },
    };
  }

  // ------------------------------------------------------------------ live operations

  async live() {
    const online = await this.onlineDrivers();
    const [totals] = await this.q(`SELECT count(*)::int AS n FROM users WHERE role = 'driver' AND status = 'active'`);
    const active = await this.q(
      `SELECT r.id, r.short_code, r.status, r.category, r.created_at, d.full_name AS driver_name,
              (SELECT max(created_at) FROM ride_status_history h WHERE h.ride_id = r.id) AS changed_at,
              ST_Y(r.pickup::geometry) AS plat, ST_X(r.pickup::geometry) AS plng,
              ST_Y(r.dropoff::geometry) AS dlat, ST_X(r.dropoff::geometry) AS dlng
         FROM rides r LEFT JOIN users d ON d.id = r.driver_id
        WHERE r.status IN ${ACTIVE} ORDER BY r.created_at`,
    );
    const [searching] = await this.q(
      `SELECT count(*)::int AS n, COALESCE(extract(epoch FROM now() - min(search_started_at)), 0)::int AS longest
         FROM rides WHERE status IN ('REQUESTED', 'SEARCHING_DRIVER')`,
    );
    const [noDriver] = await this.q(
      `SELECT count(*)::int AS n FROM rides WHERE status = 'NO_DRIVER_FOUND' AND updated_at > now() - interval '1 hour'`,
    );
    return {
      onlineDrivers: online.length,
      activeDrivers: totals.n,
      drivers: online,
      activeRides: active.map((r) => ({
        id: r.id, code: r.short_code, status: r.status, category: r.category, driver: r.driver_name, changedAt: r.changed_at,
        pickup: { lat: r.plat, lng: r.plng }, dropoff: { lat: r.dlat, lng: r.dlng },
      })),
      searching: { count: searching.n, longestWaitSeconds: searching.longest },
      noDriverLastHour: noDriver.n,
    };
  }

  // ------------------------------------------------------------------ trips

  private statusFilter(status?: TripQuery['status']): string {
    switch (status) {
      case 'completed': return `r.status = 'TRIP_COMPLETED'`;
      case 'cancelled': return `r.status IN ${CANCELLED}`;
      case 'active': return `r.status IN ${ACTIVE} OR r.status IN ('REQUESTED', 'SEARCHING_DRIVER')`;
      case 'scheduled': return `r.status = 'SCHEDULED'`;
      default: return 'TRUE';
    }
  }

  async tripsOverview() {
    const [t] = await this.q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'TRIP_COMPLETED')::int AS completed,
              count(*) FILTER (WHERE status IN ${CANCELLED})::int AS cancelled,
              count(*) FILTER (WHERE status IN ${ACTIVE} OR status IN ('REQUESTED', 'SEARCHING_DRIVER'))::int AS in_progress,
              count(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled
         FROM rides`,
    );
    const [scheduledBooked] = await this.q(`SELECT count(*)::int AS n FROM rides WHERE scheduled_for IS NOT NULL`);
    const byDay = await this.q(
      `SELECT d::date AS day, COALESCE(sum(f.total_kobo), 0)::bigint AS kobo
         FROM generate_series((now() AT TIME ZONE ${TZ})::date - 6, (now() AT TIME ZONE ${TZ})::date, interval '1 day') d
         LEFT JOIN rides r ON (r.created_at AT TIME ZONE ${TZ})::date = d::date AND r.status = 'TRIP_COMPLETED'
         LEFT JOIN ride_fares f ON f.ride_id = r.id
        GROUP BY 1 ORDER BY 1`,
    );
    return {
      total: t.total, completed: t.completed, cancelled: t.cancelled, inProgress: t.in_progress, scheduledAhead: t.scheduled,
      regularVsScheduled: { regular: t.total - scheduledBooked.n, scheduled: scheduledBooked.n },
      revenueLast7Days: byDay.map((r) => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), kobo: Number(r.kobo) })),
    };
  }

  async trips(query: TripQuery) {
    const params: unknown[] = [];
    let where = `(${this.statusFilter(query.status)})`;
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      where += ` AND (r.short_code ILIKE $1 OR rd.full_name ILIKE $1 OR rd.phone ILIKE $1 OR dr.full_name ILIKE $1)`;
    }
    const [count] = await this.q(
      `SELECT count(*)::int AS n FROM rides r JOIN users rd ON rd.id = r.rider_id LEFT JOIN users dr ON dr.id = r.driver_id WHERE ${where}`, params,
    );
    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.q(
      `SELECT r.id, r.short_code, r.status, r.payment_status, r.payment_method, r.category, r.created_at, r.scheduled_for,
              rd.full_name AS rider_name, dr.full_name AS driver_name, f.total_kobo
         FROM rides r JOIN users rd ON rd.id = r.rider_id LEFT JOIN users dr ON dr.id = r.driver_id
         LEFT JOIN ride_fares f ON f.ride_id = r.id
        WHERE ${where} ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total: count.n, page: query.page, pageSize: query.pageSize,
      items: rows.map((r) => ({
        id: r.id, code: r.short_code, status: r.status, paymentStatus: r.payment_status, method: r.payment_method, category: r.category,
        at: r.created_at, scheduled: r.scheduled_for != null, rider: r.rider_name, driver: r.driver_name, totalKobo: r.total_kobo == null ? null : Number(r.total_kobo),
      })),
    };
  }

  async trip(id: string) {
    const [r] = await this.q(
      `SELECT r.*, ST_Y(r.pickup::geometry) AS plat, ST_X(r.pickup::geometry) AS plng, ST_Y(r.dropoff::geometry) AS dlat, ST_X(r.dropoff::geometry) AS dlng,
              rd.full_name AS rider_name, rd.phone AS rider_phone, dr.full_name AS driver_name, dr.phone AS driver_phone,
              v.make, v.colour, v.plate,
              f.total_kobo, f.distance_m AS f_distance, f.duration_s AS f_duration, f.waiting_s, f.outside_quote_range,
              q.low_kobo, q.high_kobo,
              pv.category AS pv_category, pv.effective_from AS pv_from
         FROM rides r JOIN users rd ON rd.id = r.rider_id LEFT JOIN users dr ON dr.id = r.driver_id
         LEFT JOIN vehicles v ON v.driver_id = r.driver_id AND v.active
         LEFT JOIN ride_fares f ON f.ride_id = r.id
         LEFT JOIN fare_quotes q ON q.id = r.fare_quote_id
         LEFT JOIN pricing_versions pv ON pv.id = COALESCE(f.pricing_version_id, r.pricing_version_id)
        WHERE r.id = $1`, [id],
    );
    if (!r) throw new NotFoundException('trip not found');
    const lines = await this.q(`SELECT kind, label, amount_kobo FROM ride_fare_lines WHERE ride_id = $1 ORDER BY position`, [id]);
    const history = await this.q(`SELECT to_status, reason, created_at FROM ride_status_history WHERE ride_id = $1 ORDER BY created_at, id`, [id]);
    return {
      id: r.id, code: r.short_code, status: r.status, paymentStatus: r.payment_status, method: r.payment_method, category: r.category,
      createdAt: r.created_at, scheduledFor: r.scheduled_for,
      pickup: { lat: r.plat, lng: r.plng, address: r.pickup_address }, dropoff: { lat: r.dlat, lng: r.dlng, address: r.dropoff_address },
      rider: { id: r.rider_id, name: r.rider_name, phone: r.rider_phone },
      driver: r.driver_name ? { id: r.driver_id, name: r.driver_name, phone: r.driver_phone, vehicle: r.plate ? `${r.colour} ${r.make} ${r.plate}` : null } : null,
      fare: r.total_kobo == null ? null : {
        totalKobo: Number(r.total_kobo), distanceM: r.f_distance, durationS: r.f_duration, waitingS: r.waiting_s, outsideEstimate: r.outside_quote_range,
        lines: lines.map((l) => ({ kind: l.kind, label: l.label, amountKobo: Number(l.amount_kobo) })),
        rates: r.pv_from ? { category: r.pv_category, effectiveFrom: r.pv_from } : null,
      },
      estimate: r.low_kobo == null ? null : { lowKobo: Number(r.low_kobo), highKobo: Number(r.high_kobo) },
      timeline: history.map((h) => ({ status: h.to_status, reason: h.reason, at: h.created_at })),
    };
  }

  // ------------------------------------------------------------------ customers

  async customers() {
    const [c] = await this.q(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'suspended')::int AS suspended
         FROM users WHERE role = 'rider'`,
    );
    const top = await this.q(
      `SELECT u.id, u.full_name, u.phone, u.status, count(r.id)::int AS trips, COALESCE(sum(f.total_kobo), 0)::bigint AS spent
         FROM users u LEFT JOIN rides r ON r.rider_id = u.id AND r.status = 'TRIP_COMPLETED' LEFT JOIN ride_fares f ON f.ride_id = r.id
        WHERE u.role = 'rider' GROUP BY u.id ORDER BY trips DESC, spent DESC LIMIT 10`,
    );
    const dupes = await this.q(`SELECT full_name, count(*)::int AS n FROM users WHERE role = 'rider' GROUP BY full_name HAVING count(*) > 1`);
    const trend = await this.q(
      `SELECT to_char(date_trunc('month', created_at AT TIME ZONE ${TZ}), 'YYYY-MM') AS month, count(*)::int AS n
         FROM users WHERE role = 'rider' GROUP BY 1 ORDER BY 1 DESC LIMIT 6`,
    );
    return {
      total: c.total, active: c.active, suspended: c.suspended,
      top: top.map((t) => ({ id: t.id, name: t.full_name, phone: t.phone, status: t.status, trips: t.trips, spentKobo: Number(t.spent) })),
      sameNames: dupes.map((d) => ({ name: d.full_name, count: d.n })),
      registrations: trend.reverse(),
    };
  }

  // ------------------------------------------------------------------ safety

  async safety(status?: 'open' | 'acknowledged' | 'resolved') {
    const filter = status === 'open' ? `s.status = 'OPEN'` : status === 'acknowledged' ? `s.status = 'ACKNOWLEDGED'` : status === 'resolved' ? `s.status = 'RESOLVED'` : 'TRUE';
    const rows = await this.q(
      `SELECT s.id, s.status, s.raised_by_role, s.created_at, s.acknowledged_at, s.escalated_at,
              u.full_name, r.short_code, st.full_name AS ack_by
         FROM sos_events s JOIN users u ON u.id = s.raised_by
         LEFT JOIN rides r ON r.id = s.ride_id LEFT JOIN staff_users st ON st.id = s.acknowledged_by
        WHERE ${filter} ORDER BY (s.status = 'OPEN') DESC, s.created_at DESC LIMIT 200`,
    );
    const [k] = await this.q(
      `SELECT count(*) FILTER (WHERE status <> 'RESOLVED')::int AS open,
              count(*) FILTER (WHERE status = 'OPEN' AND created_at < now() - interval '60 seconds')::int AS slow,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM acknowledged_at - created_at))
                FILTER (WHERE acknowledged_at IS NOT NULL AND created_at > now() - interval '30 days'), NULL)::int AS median_ack
         FROM sos_events`,
    );
    return {
      openAlerts: k.open, unacknowledged: k.slow, medianAckSeconds: k.median_ack,
      items: rows.map((s, i) => ({
        id: s.id, status: s.status, role: s.raised_by_role, person: s.full_name, trip: s.short_code, at: s.created_at, acknowledgedBy: s.ack_by, escalated: s.escalated_at != null,
      })),
    };
  }

  async sos(id: string) {
    const [s] = await this.q(
      `SELECT s.*, ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
              u.full_name AS raiser, u.phone AS raiser_phone, r.short_code, r.category, r.rider_id, r.driver_id,
              v.plate
         FROM sos_events s JOIN users u ON u.id = s.raised_by LEFT JOIN rides r ON r.id = s.ride_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.id = $1`, [id],
    );
    if (!s) throw new NotFoundException('alert not found');
    const other = s.ride_id
      ? (await this.q(`SELECT id, full_name, phone, role FROM users WHERE id = ANY($1::uuid[])`, [[s.rider_id, s.driver_id].filter(Boolean)]))
      : [];
    const timeline = await this.q(
      `SELECT t.kind, t.detail, t.created_at, st.full_name AS actor
         FROM sos_timeline t LEFT JOIN staff_users st ON st.id = t.actor_id WHERE t.sos_id = $1 ORDER BY t.created_at, t.id`, [id],
    );
    return {
      id: s.id, status: s.status, role: s.raised_by_role, createdAt: s.created_at, acknowledgedAt: s.acknowledged_at, resolvedAt: s.resolved_at,
      location: s.lat == null ? null : { lat: s.lat, lng: s.lng },
      raisedBy: { name: s.raiser, phone: s.raiser_phone },
      trip: s.short_code ? { code: s.short_code, category: s.category, rideId: s.ride_id, plate: s.plate } : null,
      people: other.map((p) => ({ id: p.id, name: p.full_name, phone: p.phone, role: p.role })),
      timeline: timeline.map((t) => ({ kind: t.kind, detail: t.detail, at: t.created_at, by: t.actor })),
    };
  }

  // ------------------------------------------------------------------ pricing

  async pricing() {
    const rows = await this.q(
      `SELECT id, category, zone, effective_from, base_kobo, per_km_kobo, per_minute_kobo, waiting_per_minute_kobo, free_waiting_seconds,
              tax_kobo, rounding_step_kobo, estimate_low_bps, estimate_high_bps, approved_at, created_at,
              (approved_at IS NOT NULL AND effective_from <= now()
                 AND effective_from = max(effective_from) FILTER (WHERE approved_at IS NOT NULL AND effective_from <= now()) OVER (PARTITION BY category, zone)) AS live
         FROM pricing_versions ORDER BY category, effective_from DESC`,
    );
    return rows.map((r) => ({
      id: r.id, category: r.category, zone: r.zone, effectiveFrom: r.effective_from,
      baseKobo: Number(r.base_kobo), perKmKobo: Number(r.per_km_kobo), perMinuteKobo: Number(r.per_minute_kobo),
      waitingPerMinuteKobo: Number(r.waiting_per_minute_kobo), freeWaitingSeconds: r.free_waiting_seconds, taxKobo: Number(r.tax_kobo),
      roundingStepKobo: Number(r.rounding_step_kobo), estimateLowBps: r.estimate_low_bps, estimateHighBps: r.estimate_high_bps,
      state: r.approved_at == null ? 'pending' : r.live ? 'live' : new Date(r.effective_from) > new Date() ? 'scheduled' : 'superseded',
    }));
  }

  // ------------------------------------------------------------------ people

  private pageArgs(page = 1, pageSize = 20) { return { limit: pageSize, offset: (page - 1) * pageSize }; }

  async drivers(q: { search?: string; status?: string; page: number; pageSize: number }) {
    const [k] = await this.q(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
              (SELECT count(*)::int FROM driver_applications WHERE status = 'SUBMITTED') AS pending
         FROM users WHERE role = 'driver'`,
    );
    const params: unknown[] = [];
    let where = `u.role = 'driver'`;
    if (q.status === 'active' || q.status === 'suspended') { params.push(q.status); where += ` AND u.status = $${params.length}`; }
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); where += ` AND (u.full_name ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR v.plate ILIKE $${params.length})`; }
    const [count] = await this.q(`SELECT count(*)::int AS n FROM users u LEFT JOIN vehicles v ON v.driver_id = u.id AND v.active WHERE ${where}`, params);
    const { limit, offset } = this.pageArgs(q.page, q.pageSize);
    params.push(limit, offset);
    const rows = await this.q(
      `SELECT u.id, u.full_name, u.phone, u.status, u.created_at, v.plate, v.make, v.colour, v.category,
              COALESCE(v.arrangement, (SELECT a.arrangement FROM driver_applications a WHERE a.driver_id = u.id ORDER BY a.submitted_at DESC LIMIT 1)) AS arrangement,
              (SELECT count(*)::int FROM rides r WHERE r.driver_id = u.id AND r.status = 'TRIP_COMPLETED') AS trips,
              (SELECT round(avg(rt.stars)::numeric, 1)::float8 FROM ride_ratings rt JOIN rides r ON r.id = rt.ride_id WHERE r.driver_id = u.id) AS rating
         FROM users u LEFT JOIN vehicles v ON v.driver_id = u.id AND v.active
        WHERE ${where} ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      counts: { total: k.total, active: k.active, suspended: k.suspended, pendingApplications: k.pending },
      total: count.n, page: q.page, pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id, name: r.full_name, phone: r.phone, status: r.status, joinedAt: r.created_at, trips: r.trips, rating: r.rating,
        arrangement: r.arrangement,
        vehicle: r.plate ? { plate: r.plate, make: r.make, colour: r.colour, category: r.category } : null,
      })),
    };
  }

  /** A driver or a customer: who they are, how they have done, and why their account is in its current state. */
  async person(id: string) {
    const [u] = await this.q(`SELECT id, full_name, phone, role, status, created_at FROM users WHERE id = $1`, [id]);
    if (!u) throw new NotFoundException('user not found');
    const col = u.role === 'driver' ? 'driver_id' : 'rider_id';
    const [t] = await this.q(
      `SELECT count(*) FILTER (WHERE r.status = 'TRIP_COMPLETED')::int AS completed, count(*) FILTER (WHERE r.status IN ${CANCELLED})::int AS cancelled,
              COALESCE(sum(f.total_kobo) FILTER (WHERE r.status = 'TRIP_COMPLETED'), 0)::bigint AS kobo
         FROM rides r LEFT JOIN ride_fares f ON f.ride_id = r.id WHERE r.${col} = $1`, [id],
    );
    const [rt] = u.role === 'driver'
      ? await this.q(`SELECT round(avg(rt.stars)::numeric, 2)::float8 AS avg, count(*)::int AS n FROM ride_ratings rt JOIN rides r ON r.id = rt.ride_id WHERE r.driver_id = $1`, [id])
      : [{ avg: null, n: 0 }];
    const vehicles = await this.q(`SELECT id, category, make, colour, plate, active, arrangement, owner_name, owner_phone FROM vehicles WHERE driver_id = $1 ORDER BY active DESC`, [id]);
    const recent = await this.q(
      `SELECT r.id, r.short_code, r.status, r.created_at, f.total_kobo FROM rides r LEFT JOIN ride_fares f ON f.ride_id = r.id WHERE r.${col} = $1 ORDER BY r.created_at DESC LIMIT 8`, [id],
    );
    const history = await this.q(
      `SELECT e.status, e.reason, e.created_at, s.full_name AS actor FROM user_status_events e LEFT JOIN staff_users s ON s.id = e.actor_id WHERE e.user_id = $1 ORDER BY e.id DESC LIMIT 10`, [id],
    );
    const [bal] = await this.q(
      `SELECT COALESCE(b.balance_kobo, 0)::bigint AS kobo FROM ledger_accounts a LEFT JOIN ledger_balances b ON b.account_id = a.id WHERE a.code = $1`, [`wallet:${id}`],
    );
    const [app] = u.role === 'driver'
      ? await this.q(`SELECT id, status, arrangement FROM driver_applications WHERE driver_id = $1 ORDER BY submitted_at DESC LIMIT 1`, [id])
      : [null];
    return {
      id: u.id, name: u.full_name, phone: u.phone, role: u.role, status: u.status, joinedAt: u.created_at,
      completedTrips: t.completed, cancelledTrips: t.cancelled, totalKobo: Number(t.kobo), rating: rt.avg, ratings: rt.n,
      walletKobo: bal ? Number(bal.kobo) : 0, vehicles,
      application: app ? { id: app.id, status: app.status, arrangement: app.arrangement } : null,
      vehiclePlan: u.role === 'driver' ? await this.plans.forDriver(id) : null,
      recentTrips: recent.map((r) => ({ id: r.id, code: r.short_code, status: r.status, at: r.created_at, totalKobo: r.total_kobo == null ? null : Number(r.total_kobo) })),
      statusHistory: history.map((h) => ({ status: h.status, reason: h.reason, at: h.created_at, by: h.actor })),
    };
  }

  async vehicles(q: { search?: string; page: number; pageSize: number }) {
    const online = new Set((await this.onlineDrivers()).map((d) => d.id));
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); where = `(v.plate ILIKE $1 OR v.make ILIKE $1 OR u.full_name ILIKE $1)`; }
    const [count] = await this.q(`SELECT count(*)::int AS n FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE ${where}`, params);
    const [k] = await this.q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active FROM vehicles`);
    const { limit, offset } = this.pageArgs(q.page, q.pageSize);
    params.push(limit, offset);
    const rows = await this.q(
      `SELECT v.id, v.plate, v.make, v.colour, v.category, v.active, v.suspended_at, v.arrangement, u.id AS driver_id, u.full_name, u.status
         FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE ${where} ORDER BY v.active DESC, v.plate LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return {
      total: count.n, page: q.page, pageSize: q.pageSize, counts: { total: k.total, active: k.active, online: online.size },
      items: rows.map((r) => ({ id: r.id, plate: r.plate, make: r.make, colour: r.colour, category: r.category, arrangement: r.arrangement, active: r.active, suspended: r.suspended_at != null, driverId: r.driver_id, driver: r.full_name, driverStatus: r.status, online: online.has(r.driver_id) })),
    };
  }

  // ------------------------------------------------------------------ money overview

  async finance() {
    const rows = await this.q(
      `SELECT a.kind, a.code, COALESCE(b.balance_kobo, 0)::bigint AS kobo FROM ledger_accounts a LEFT JOIN ledger_balances b ON b.account_id = a.id`,
    );
    const sum = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.kobo), 0);
    const platform = rows.filter((r) => r.kind !== 'wallet').map((r) => ({ code: r.code, kind: r.kind, kobo: Number(r.kobo) }));
    const [p] = await this.q(
      `SELECT count(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int AS pending, COALESCE(sum(amount_kobo) FILTER (WHERE status = 'PENDING_APPROVAL'), 0)::bigint AS pending_kobo,
              COALESCE(sum(amount_kobo) FILTER (WHERE status = 'PAID'), 0)::bigint AS paid_kobo, count(*) FILTER (WHERE status = 'FAILED')::int AS failed FROM payout_requests`,
    );
    const [a] = await this.q(`SELECT count(*)::int AS n FROM ledger_adjustments WHERE status = 'PENDING_APPROVAL'`);
    const [topups] = await this.q(`SELECT COALESCE(sum(amount_kobo) FILTER (WHERE status = 'SUCCESS'), 0)::bigint AS kobo, count(*) FILTER (WHERE status = 'AMOUNT_MISMATCH')::int AS mismatch FROM payment_intents`);
    const [r] = await this.q(`SELECT started_at FROM reconciliation_runs ORDER BY started_at DESC LIMIT 1`);
    return {
      walletsKobo: sum('wallet'), commissionKobo: sum('commission'), taxKobo: sum('tax'), bonusKobo: sum('bonus'),
      payouts: { pending: p.pending, pendingKobo: Number(p.pending_kobo), paidKobo: Number(p.paid_kobo), failed: p.failed },
      pendingAdjustments: a.n, topupsKobo: Number(topups.kobo), topupMismatches: topups.mismatch,
      lastReconciliation: r ? { startedAt: r.started_at } : null,
      platform,
    };
  }

  // ------------------------------------------------------------------ activity log

  async activity(q: { search?: string; page: number; pageSize: number }) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); where = `(l.path ILIKE $1 OR s.full_name ILIKE $1 OR s.email ILIKE $1)`; }
    const [count] = await this.q(`SELECT count(*)::int AS n FROM staff_audit_log l LEFT JOIN staff_users s ON s.id = l.staff_id WHERE ${where}`, params);
    const { limit, offset } = this.pageArgs(q.page, q.pageSize);
    params.push(limit, offset);
    const rows = await this.q(
      `SELECT l.id, l.method, l.path, l.params, l.status_code, l.ip, l.created_at, s.full_name, s.email, s.role
         FROM staff_audit_log l LEFT JOIN staff_users s ON s.id = l.staff_id WHERE ${where} ORDER BY l.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return {
      total: count.n, page: q.page, pageSize: q.pageSize,
      items: rows.map((r) => ({ id: Number(r.id), method: r.method, path: r.path, status: r.status_code, ip: r.ip, at: r.created_at, staff: r.full_name, email: r.email, role: r.role })),
    };
  }

  // ------------------------------------------------------------------ revenue

  async revenue(days: number) {
    const byDay = await this.q(
      `SELECT d::date AS day,
              COALESCE(sum(f.total_kobo), 0)::bigint AS fares,
              count(r.id)::int AS trips,
              COALESCE((SELECT sum(e.amount_kobo) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
                         WHERE a.code = 'platform:commission' AND (e.created_at AT TIME ZONE ${TZ})::date = d::date), 0)::bigint AS commission,
              COALESCE((SELECT sum(e.amount_kobo) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
                         WHERE a.code = 'platform:tax' AND (e.created_at AT TIME ZONE ${TZ})::date = d::date), 0)::bigint AS tax
         FROM generate_series((now() AT TIME ZONE ${TZ})::date - ($1::int - 1), (now() AT TIME ZONE ${TZ})::date, interval '1 day') d
         LEFT JOIN rides r ON (r.created_at AT TIME ZONE ${TZ})::date = d::date AND r.status = 'TRIP_COMPLETED'
         LEFT JOIN ride_fares f ON f.ride_id = r.id
        GROUP BY d ORDER BY d`,
      [days],
    );
    const byCategory = await this.q(
      `SELECT r.category, count(*)::int AS trips, COALESCE(sum(f.total_kobo), 0)::bigint AS fares
         FROM rides r JOIN ride_fares f ON f.ride_id = r.id
        WHERE r.status = 'TRIP_COMPLETED' AND r.created_at > now() - make_interval(days => $1) GROUP BY r.category ORDER BY fares DESC`, [days],
    );
    const byMethod = await this.q(
      `SELECT r.payment_method AS method, count(*)::int AS trips, COALESCE(sum(f.total_kobo), 0)::bigint AS fares
         FROM rides r JOIN ride_fares f ON f.ride_id = r.id
        WHERE r.status = 'TRIP_COMPLETED' AND r.created_at > now() - make_interval(days => $1) GROUP BY r.payment_method`, [days],
    );
    const sum = (k: 'fares' | 'commission' | 'tax' | 'trips') => byDay.reduce((s, r) => s + Number(r[k]), 0);
    return {
      days, faresKobo: sum('fares'), commissionKobo: sum('commission'), taxKobo: sum('tax'), trips: sum('trips'),
      byDay: byDay.map((r) => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), faresKobo: Number(r.fares), commissionKobo: Number(r.commission), taxKobo: Number(r.tax), trips: r.trips })),
      byCategory: byCategory.map((r) => ({ category: r.category, trips: r.trips, faresKobo: Number(r.fares) })),
      byMethod: byMethod.map((r) => ({ method: r.method, trips: r.trips, faresKobo: Number(r.fares) })),
    };
  }

  // ------------------------------------------------------------------ ledger (read-only)

  async ledger(q: { search?: string; kind?: string; page: number; pageSize: number }) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q.kind) { params.push(q.kind); where += ` AND t.kind = $${params.length}`; }
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); where += ` AND (t.reference ILIKE $${params.length} OR t.memo ILIKE $${params.length})`; }
    const [count] = await this.q(`SELECT count(*)::int AS n FROM ledger_transactions t WHERE ${where}`, params);
    const kinds = await this.q(`SELECT kind, count(*)::int AS n FROM ledger_transactions GROUP BY kind ORDER BY n DESC`);
    const { limit, offset } = this.pageArgs(q.page, q.pageSize);
    params.push(limit, offset);
    const rows = await this.q(
      `SELECT t.id, t.kind, t.reference, t.memo, t.created_at,
              (SELECT COALESCE(sum(amount_kobo) FILTER (WHERE amount_kobo > 0), 0) FROM ledger_entries e WHERE e.transaction_id = t.id)::bigint AS moved,
              (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id = t.id)::int AS entries
         FROM ledger_transactions t WHERE ${where} ORDER BY t.created_at DESC, t.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return {
      total: count.n, page: q.page, pageSize: q.pageSize, kinds,
      items: rows.map((r) => ({ id: r.id, kind: r.kind, reference: r.reference, memo: r.memo, at: r.created_at, movedKobo: Number(r.moved), entries: r.entries })),
    };
  }

  async ledgerEntries(id: string) {
    const rows = await this.q(
      `SELECT a.code, a.kind, e.amount_kobo FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = $1 ORDER BY e.amount_kobo`, [id],
    );
    if (rows.length === 0) throw new NotFoundException('transaction not found');
    return rows.map((r) => ({ account: r.code, kind: r.kind, amountKobo: Number(r.amount_kobo) }));
  }

  // ------------------------------------------------------------------ driver ratings

  async ratings() {
    const [s] = await this.q(`SELECT round(avg(stars)::numeric, 2)::float8 AS avg, count(*)::int AS n FROM ride_ratings`);
    const dist = await this.q(`SELECT stars, count(*)::int AS n FROM ride_ratings GROUP BY stars`);
    const recent = await this.q(
      `SELECT rt.stars, rt.tags, rt.created_at, r.id AS ride_id, r.short_code, d.id AS driver_id, d.full_name AS driver, u.full_name AS rider
         FROM ride_ratings rt JOIN rides r ON r.id = rt.ride_id JOIN users u ON u.id = rt.rater_id LEFT JOIN users d ON d.id = r.driver_id
        ORDER BY rt.created_at DESC LIMIT 30`,
    );
    const low = await this.q(
      `SELECT d.id, d.full_name, round(avg(rt.stars)::numeric, 2)::float8 AS avg, count(*)::int AS n
         FROM ride_ratings rt JOIN rides r ON r.id = rt.ride_id JOIN users d ON d.id = r.driver_id
        GROUP BY d.id, d.full_name HAVING count(*) >= 3 ORDER BY avg ASC LIMIT 5`,
    );
    return {
      average: s.avg, total: s.n,
      distribution: [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: dist.find((d) => d.stars === n)?.n ?? 0 })),
      lowestRated: low.map((l) => ({ id: l.id, name: l.full_name, average: l.avg, ratings: l.n })),
      recent: recent.map((r) => ({ stars: r.stars, tags: r.tags, at: r.created_at, rideId: r.ride_id, code: r.short_code, driverId: r.driver_id, driver: r.driver, rider: r.rider })),
    };
  }

  // ------------------------------------------------------------------ CSV for the finance team

  private csv(rows: (string | number | null)[][]): string {
    const cell = (v: string | number | null) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a spreadsheet must never run a name as a formula
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
  }

  async tripsCsv(status?: TripQuery['status']): Promise<string> {
    const rows = await this.q(
      `SELECT r.short_code, r.created_at, r.status, r.payment_status, r.payment_method, r.category, rd.full_name AS rider, dr.full_name AS driver, f.total_kobo
         FROM rides r JOIN users rd ON rd.id = r.rider_id LEFT JOIN users dr ON dr.id = r.driver_id LEFT JOIN ride_fares f ON f.ride_id = r.id
        WHERE (${this.statusFilter(status)}) ORDER BY r.created_at DESC LIMIT 5000`,
    );
    return this.csv([
      ['Trip code', 'Date (UTC)', 'Status', 'Payment', 'Method', 'Category', 'Rider', 'Driver', 'Fare (NGN)'],
      ...rows.map((r) => [r.short_code, new Date(r.created_at).toISOString(), r.status, r.payment_status, r.payment_method, r.category, r.rider, r.driver, r.total_kobo == null ? '' : (Number(r.total_kobo) / 100).toFixed(2)]),
    ]);
  }

  async activityCsv(): Promise<string> {
    const rows = await this.q(
      `SELECT l.created_at, s.full_name, s.email, l.method, l.path, l.status_code, l.ip FROM staff_audit_log l LEFT JOIN staff_users s ON s.id = l.staff_id ORDER BY l.id DESC LIMIT 5000`,
    );
    return this.csv([['When (UTC)', 'Staff', 'Email', 'Method', 'Path', 'Result', 'IP'], ...rows.map((r) => [new Date(r.created_at).toISOString(), r.full_name, r.email, r.method, r.path, r.status_code, r.ip])]);
  }
}
