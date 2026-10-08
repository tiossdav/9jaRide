import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { Client, Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';

export type PushApp = 'rider' | 'driver';
export interface PushMessage {
  /** What the app does with it: "offer" rings the booking alert; anything else is shown as a notification. */
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** What the rider is told when their ride changes. Statuses not listed are not announced. */
const RIDER_MESSAGES: Record<string, (driver: string) => { title: string; body: string }> = {
  DRIVER_ASSIGNED: (d) => ({ title: 'Your driver is on the way', body: `${d} accepted your ride.` }),
  DRIVER_ARRIVED: (d) => ({ title: 'Your driver has arrived', body: `${d} is at the pickup point.` }),
  IN_TRANSIT: () => ({ title: 'You are in transit', body: 'Enjoy your ride with 9jaRide.' }),
  TRIP_COMPLETED: () => ({ title: 'You have arrived', body: 'Your trip is complete. Tap to rate your driver.' }),
  CANCELLED_BY_DRIVER: () => ({ title: 'Ride cancelled', body: 'Your driver cancelled. Open 9jaRide to book again.' }),
  CANCELLED_BY_SYSTEM: () => ({ title: 'Ride cancelled', body: 'Your ride was cancelled. Open 9jaRide to book again.' }),
  NO_DRIVER_FOUND: () => ({ title: 'No driver found', body: 'No driver was free nearby. Please try again.' }),
};

/**
 * Push notifications through Firebase Cloud Messaging. Off until a service account is configured
 * (FIREBASE_SERVICE_ACCOUNT holding the JSON, or FIREBASE_SERVICE_ACCOUNT_FILE pointing to it); while off, nothing is sent
 * and nothing fails. Messages are data-only so the apps decide how to show them, even when closed.
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PushService.name);
  private messaging: import('firebase-admin/messaging').Messaging | null = null;
  private listener: Client | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  get enabled() { return this.messaging !== null; }

  async onModuleInit() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim()
      || (process.env.FIREBASE_SERVICE_ACCOUNT_FILE ? readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8') : '');
    if (!raw) { this.log.log('push notifications are off (no FIREBASE_SERVICE_ACCOUNT)'); return; }
    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(raw)) });
      this.messaging = getMessaging(app);
      await this.listen();
      this.log.log('push notifications are on');
    } catch (e) {
      this.log.error(`push notifications could not start: ${e}`);
      this.messaging = null;
    }
  }

  async onModuleDestroy() {
    await this.listener?.end().catch(() => undefined);
  }

  /** Remembers which phone belongs to whom. Signing in on a phone moves its token to the new person. */
  async register(userId: string, token: string, app: PushApp): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_tokens (token, user_id, app) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, app = EXCLUDED.app, updated_at = now()`,
      [token, userId, app],
    );
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.pool.query(`DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`, [token, userId]);
  }

  /** Sends to every phone the person is signed in on. Never throws: a notification is a courtesy, not part of the transaction. */
  async toUser(userId: string, msg: PushMessage, app?: PushApp): Promise<number> {
    if (!this.messaging) return 0;
    try {
      const tokens = (await this.pool.query(`SELECT token FROM push_tokens WHERE user_id = $1 AND ($2::text IS NULL OR app = $2)`, [userId, app ?? null])).rows.map((r) => r.token as string);
      if (!tokens.length) return 0;
      const res = await this.messaging.sendEachForMulticast({
        tokens,
        data: { type: msg.type, title: msg.title, body: msg.body, ...(msg.data ?? {}) },
        android: { priority: 'high', ttl: msg.type === 'offer' ? 30_000 : 3_600_000 },
      });
      // phones that uninstalled the app or signed out of Google: forget them
      const dead = res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? '') ? tokens[i] : null)).filter((t): t is string => !!t);
      if (dead.length) await this.pool.query(`DELETE FROM push_tokens WHERE token = ANY($1::text[])`, [dead]);
      return res.successCount;
    } catch (e) {
      this.log.error(`push to ${userId} failed: ${e}`);
      return 0;
    }
  }

  /** Follows ride status changes (announced by the database) and tells the rider. */
  private async listen() {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.on('error', (e) => { this.log.error(`push listener lost its connection: ${e}`); this.listener = null; setTimeout(() => this.listen().catch(() => undefined), 5_000); });
    await c.connect();
    await c.query('LISTEN ride_status');
    c.on('notification', (n) => { if (n.payload) this.onRideStatus(n.payload).catch((e) => this.log.error(`ride status push failed: ${e}`)); });
    this.listener = c;
  }

  private async onRideStatus(payload: string) {
    const [rideId, status] = payload.split(':');
    const make = RIDER_MESSAGES[status];
    if (!make) return;
    const r = (await this.pool.query(`SELECT r.rider_id, d.full_name AS driver FROM rides r LEFT JOIN users d ON d.id = r.driver_id WHERE r.id = $1`, [rideId])).rows[0];
    if (!r) return;
    const m = make(String(r.driver ?? 'Your driver').split(' ')[0]);
    await this.toUser(r.rider_id, { type: 'ride', title: m.title, body: m.body, data: { rideId, status } }, 'rider');
  }
}
