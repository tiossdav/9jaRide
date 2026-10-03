import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../common/infra.module';

/**
 * Vehicle actions for staff. A suspended vehicle stops its driver going online (the driver operates the vehicle):
 * the live "online" markers are cleared at once, so they leave matching without waiting for the next ping to expire.
 * A trip already under way is not interrupted.
 */
@Injectable()
export class VehiclesAdminService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS) private readonly redis: Redis) {}

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT v.*, u.full_name, u.phone, u.status AS driver_status FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE v.id = $1`, [id],
    );
    const v = rows[0];
    if (!v) throw new NotFoundException('vehicle not found');
    const [t] = (await this.pool.query(`SELECT count(*)::int AS n FROM rides WHERE driver_id = $1 AND status = 'TRIP_COMPLETED'`, [v.driver_id])).rows;
    const history = await this.pool.query(
      `SELECT e.status, e.reason, e.created_at, s.full_name AS actor FROM vehicle_status_events e LEFT JOIN staff_users s ON s.id = e.actor_id WHERE e.vehicle_id = $1 ORDER BY e.id DESC LIMIT 20`, [id],
    );
    return {
      id: v.id, plate: v.plate, make: v.make, colour: v.colour, category: v.category, inUse: v.active, suspendedAt: v.suspended_at, suspendedReason: v.suspended_reason,
      driver: { id: v.driver_id, name: v.full_name, phone: v.phone, status: v.driver_status }, driverTrips: t.n,
      history: history.rows.map((h) => ({ status: h.status, reason: h.reason, at: h.created_at, by: h.actor })),
    };
  }

  private async forgetLive(driverId: string, category: string) {
    await this.redis.del(`driver:${driverId}:category`, `driver:${driverId}:state`);
    await this.redis.zrem(`drivers:geo:${category}`, driverId);
  }

  async suspend(staffId: string, id: string, reason: string): Promise<void> {
    const { rows } = await this.pool.query(`UPDATE vehicles SET suspended_at = now(), suspended_reason = $2 WHERE id = $1 AND suspended_at IS NULL RETURNING driver_id, category`, [id, reason]);
    if (!rows[0]) {
      const exists = await this.pool.query(`SELECT 1 FROM vehicles WHERE id = $1`, [id]);
      if (!exists.rowCount) throw new NotFoundException('vehicle not found');
      throw new ConflictException({ code: 'wrong_state', message: 'that vehicle is already suspended' });
    }
    await this.pool.query(`INSERT INTO vehicle_status_events (vehicle_id, status, reason, actor_id) VALUES ($1, 'suspended', $2, $3)`, [id, reason, staffId]);
    await this.forgetLive(rows[0].driver_id, rows[0].category);
  }

  async reinstate(staffId: string, id: string, reason: string): Promise<void> {
    const { rows } = await this.pool.query(`UPDATE vehicles SET suspended_at = NULL, suspended_reason = NULL WHERE id = $1 AND suspended_at IS NOT NULL RETURNING driver_id`, [id]);
    if (!rows[0]) throw new ConflictException({ code: 'wrong_state', message: 'that vehicle is not suspended' });
    await this.pool.query(`INSERT INTO vehicle_status_events (vehicle_id, status, reason, actor_id) VALUES ($1, 'active', $2, $3)`, [id, reason, staffId]);
    await this.redis.del(`driver:${rows[0].driver_id}:category`);
  }

  /** Give a driver a new vehicle. The one they had is retired, since a driver drives one vehicle at a time. */
  async add(staffId: string, input: { driverId: string; category: string; make: string; colour: string; plate: string }): Promise<{ id: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const driver = (await client.query(`SELECT id FROM users WHERE id = $1 AND role = 'driver' FOR UPDATE`, [input.driverId])).rows[0];
      if (!driver) throw new NotFoundException('driver not found');
      const old = (await client.query(`UPDATE vehicles SET active = false WHERE driver_id = $1 AND active RETURNING id, category`, [input.driverId])).rows;
      for (const o of old) await client.query(`INSERT INTO vehicle_status_events (vehicle_id, status, reason, actor_id) VALUES ($1, 'retired', 'replaced by a new vehicle', $2)`, [o.id, staffId]);
      let created;
      try {
        created = (await client.query(`INSERT INTO vehicles (driver_id, category, make, colour, plate) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [input.driverId, input.category, input.make.trim(), input.colour.trim(), input.plate.trim().toUpperCase()])).rows[0];
      } catch (e: any) {
        if (e?.code === '23505') throw new ConflictException('that plate number is already registered');
        throw e;
      }
      await client.query(`INSERT INTO vehicle_status_events (vehicle_id, status, reason, actor_id) VALUES ($1, 'active', 'added by staff', $2)`, [created.id, staffId]);
      await client.query('COMMIT');
      for (const o of old) await this.forgetLive(input.driverId, o.category);
      return { id: created.id };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
