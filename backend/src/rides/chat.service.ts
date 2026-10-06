import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';
import { PushService } from '../push/push.service';

/** Writing is open only while the driver is on their way, at the pickup, or driving. */
const ACTIVE = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED'];
const MAX_PER_MINUTE = 30;
const PAGE = 100;

export interface ChatMessage { id: number; mine: boolean; text: string; at: string }
export interface ChatView { messages: ChatMessage[]; open: boolean; unread: number; with: string }

/**
 * Chat between the rider and the driver of one ride. It rides on the same "hold the request until something happens" pattern
 * as the ride status (one request about every 20 seconds, answered the moment a message arrives), so no second real-time system
 * is needed. A phone that is not looking gets a push notification instead.
 */
@Injectable()
export class ChatService {
  private readonly waiting = new Map<string, Set<() => void>>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Optional() private readonly push?: PushService,
  ) {}

  /** Who this person is on this ride, or a refusal. Only its own rider and driver may look. */
  private async seat(userId: string, rideId: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.status, r.rider_id, r.driver_id, rd.full_name AS rider_name, dr.full_name AS driver_name
         FROM rides r JOIN users rd ON rd.id = r.rider_id LEFT JOIN users dr ON dr.id = r.driver_id WHERE r.id = $1`, [rideId]);
    const r = rows[0];
    if (!r) throw new NotFoundException('ride not found');
    if (userId !== r.rider_id && userId !== r.driver_id) throw new ForbiddenException('this is not your ride');
    const asRider = userId === r.rider_id;
    return {
      status: r.status as string, open: !!r.driver_id && ACTIVE.includes(r.status),
      otherId: (asRider ? r.driver_id : r.rider_id) as string | null,
      otherName: String((asRider ? r.driver_name : r.rider_name) ?? '').split(' ')[0] || (asRider ? 'Driver' : 'Rider'),
      myName: String((asRider ? r.rider_name : r.driver_name) ?? '').split(' ')[0],
    };
  }

  async unread(userId: string, rideId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM ride_messages m
        WHERE m.ride_id = $1 AND m.sender_id <> $2 AND m.id > COALESCE((SELECT last_read_id FROM ride_chat_reads WHERE ride_id = $1 AND user_id = $2), 0)`,
      [rideId, userId]);
    return rows[0].n;
  }

  private present(userId: string, r: any): ChatMessage {
    return { id: Number(r.id), mine: r.sender_id === userId, text: r.body, at: new Date(r.created_at).toISOString() };
  }

  /**
   * Messages after `after`. With `waitSeconds` the answer is held until a new message arrives or the time is up, so a phone
   * watching the chat makes about three requests a minute and still sees a message at once.
   */
  async list(userId: string, rideId: string, after: number, waitSeconds: number): Promise<ChatView> {
    const seat = await this.seat(userId, rideId);
    const fetch = async () => (await this.pool.query(`SELECT id, sender_id, body, created_at FROM ride_messages WHERE ride_id = $1 AND id > $2 ORDER BY id LIMIT ${PAGE}`, [rideId, after])).rows;
    let rows = await fetch();
    const until = Date.now() + Math.min(waitSeconds, 25) * 1000;
    while (!rows.length && Date.now() < until) {
      await this.untilSomethingArrives(rideId, until - Date.now());
      rows = await fetch();
    }
    return { messages: rows.map((r) => this.present(userId, r)), open: seat.open, unread: await this.unread(userId, rideId), with: seat.otherName };
  }

  /** Resolves when a message is written for this ride, or after `ms`. Another server instance is covered by the timer. */
  private untilSomethingArrives(rideId: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const set = this.waiting.get(rideId) ?? new Set();
      const done = () => { clearTimeout(timer); set.delete(done); if (!set.size) this.waiting.delete(rideId); resolve(); };
      const timer = setTimeout(done, Math.min(ms, 5000)); // short enough that a message from another instance is seen within seconds
      set.add(done);
      this.waiting.set(rideId, set);
    });
  }

  async send(userId: string, rideId: string, text: string, clientId?: string): Promise<ChatMessage> {
    const seat = await this.seat(userId, rideId);
    if (!seat.open || !seat.otherId) throw new ConflictException({ code: 'chat_closed', message: 'Chat is only open while the trip is on.' });
    const body = text.trim();
    if (!body) throw new BadRequestException({ code: 'empty', message: 'Write a message first.' });
    // a person cannot flood the other: thirty messages a minute on one ride is plenty
    const key = `chat:rate:${rideId}:${userId}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 60);
    if (n > MAX_PER_MINUTE) throw new HttpException({ code: 'slow_down', message: 'You are sending too fast. Wait a moment.' }, HttpStatus.TOO_MANY_REQUESTS);

    const ins = await this.pool.query(
      `INSERT INTO ride_messages (ride_id, sender_id, body, client_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (ride_id, sender_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id, sender_id, body, created_at`,
      [rideId, userId, body.slice(0, 500), clientId ?? null]);
    let row = ins.rows[0];
    if (!row) { // the same message sent again after a dropped connection: hand back the one already stored
      row = (await this.pool.query(`SELECT id, sender_id, body, created_at FROM ride_messages WHERE ride_id = $1 AND sender_id = $2 AND client_id = $3`, [rideId, userId, clientId])).rows[0];
    } else {
      // whoever is waiting on this ride hears at once; a phone that is not looking gets a notification
      for (const wake of [...(this.waiting.get(rideId) ?? [])]) wake();
      void this.push?.toUser(seat.otherId, { type: 'chat', title: seat.myName || 'New message', body: body.slice(0, 120), data: { rideId } });
    }
    await this.markRead(userId, rideId, Number(row.id)); // my own message is read by me
    return this.present(userId, row);
  }

  async markRead(userId: string, rideId: string, upTo: number): Promise<void> {
    await this.seat(userId, rideId);
    await this.pool.query(
      `INSERT INTO ride_chat_reads (ride_id, user_id, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (ride_id, user_id) DO UPDATE SET last_read_id = GREATEST(ride_chat_reads.last_read_id, EXCLUDED.last_read_id)`,
      [rideId, userId, upTo]);
  }
}
