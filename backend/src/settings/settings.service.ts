import { ConflictException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { DEFAULTS, SettingKey, SettingValues, validate } from './settings.types';

const CACHE_MS = 10_000;

/**
 * Rules an admin can change. Reading is cheap (a short cache); writing is propose-then-approve by two different
 * admins, with a start time, so a trip can always be explained by the rules in force when it began.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The value in force at `at` (now by default). Falls back to the built-in default only if the table is empty. */
  async effective<K extends SettingKey>(key: K, at?: Date, client?: Pool | PoolClient): Promise<SettingValues[K]> {
    const useCache = !at && !client;
    const hit = this.cache.get(key);
    if (useCache && hit && Date.now() - hit.at < CACHE_MS) return hit.value as SettingValues[K];
    const { rows } = await (client ?? this.pool).query(
      `SELECT value FROM setting_versions WHERE key = $1 AND approved_at IS NOT NULL AND effective_from <= COALESCE($2::timestamptz, now())
        ORDER BY effective_from DESC LIMIT 1`,
      [key, at ?? null],
    );
    const value = (rows[0]?.value ?? DEFAULTS[key]) as SettingValues[K];
    if (useCache) this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  forget() { this.cache.clear(); }

  async list(key: SettingKey) {
    const { rows } = await this.pool.query(
      `SELECT v.id, v.value, v.effective_from, v.approved_at, v.created_at, c.full_name AS created_by_name, a.full_name AS approved_by_name,
              (v.approved_at IS NOT NULL AND v.effective_from <= now()
                 AND v.effective_from = max(v.effective_from) FILTER (WHERE v.approved_at IS NOT NULL AND v.effective_from <= now()) OVER ()) AS live
         FROM setting_versions v LEFT JOIN staff_users c ON c.id = v.created_by LEFT JOIN staff_users a ON a.id = v.approved_by
        WHERE v.key = $1 ORDER BY v.effective_from DESC LIMIT 100`,
      [key],
    );
    return rows.map((r) => ({
      id: r.id, value: r.value, effectiveFrom: r.effective_from, createdAt: r.created_at, createdBy: r.created_by_name ?? 'System', approvedBy: r.approved_by_name ?? (r.approved_at ? 'System' : null),
      state: r.approved_at == null ? 'pending' : r.live ? 'live' : new Date(r.effective_from) > new Date() ? 'scheduled' : 'superseded',
    }));
  }

  async propose(staffId: string, key: SettingKey, raw: unknown, effectiveFrom: Date): Promise<{ id: string }> {
    const value = validate(key, raw);
    if (effectiveFrom.getTime() < Date.now() + 10 * 60_000) throw new BadRequestException('the new rules must start at least 10 minutes from now');
    try {
      const { rows } = await this.pool.query(`INSERT INTO setting_versions (key, value, effective_from, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [key, JSON.stringify(value), effectiveFrom, staffId]);
      return { id: rows[0].id };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('rules for that setting already start at that exact time');
      throw e;
    }
  }

  async approve(staffId: string, id: string): Promise<void> {
    const { rows } = await this.pool.query(`SELECT created_by, approved_at, effective_from FROM setting_versions WHERE id = $1`, [id]);
    const v = rows[0];
    if (!v) throw new NotFoundException('that version does not exist');
    if (v.approved_at) throw new ConflictException({ code: 'wrong_state', message: 'that version is already approved' });
    if (v.created_by === staffId) throw new ConflictException({ code: 'same_person', message: 'a different admin must approve your change' });
    if (new Date(v.effective_from).getTime() < Date.now() + 60_000) throw new ConflictException({ code: 'too_late', message: 'its start time has passed or is about to: discard it and propose a new one' });
    await this.pool.query(`UPDATE setting_versions SET approved_by = $2, approved_at = now() WHERE id = $1 AND approved_at IS NULL`, [id, staffId]);
    this.forget();
  }

  async discard(id: string): Promise<void> {
    const { rowCount } = await this.pool.query(`DELETE FROM setting_versions WHERE id = $1 AND approved_at IS NULL`, [id]);
    if (!rowCount) throw new ConflictException({ code: 'wrong_state', message: 'only a version waiting for approval can be discarded' });
  }
}
