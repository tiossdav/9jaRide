import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';

export interface AssetType { code: string; label: string; active: boolean; sortOrder: number }

/** The ride categories ("asset types"). Admins add, rename and switch them on or off; codes never change once made. */
@Injectable()
export class AssetTypesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** What a rider may book now: switched on, and with approved fees already in force. */
  async offered(): Promise<{ code: string; label: string }[]> {
    const { rows } = await this.pool.query(
      `SELECT a.code, a.label FROM asset_types a
        WHERE a.active AND EXISTS (SELECT 1 FROM pricing_versions p WHERE p.category = a.code AND p.approved_at IS NOT NULL AND p.effective_from <= now())
        ORDER BY a.sort_order, a.code`,
    );
    return rows;
  }

  /** Each type with how many vehicles use it and whether it can be booked yet. */
  async list() {
    const { rows } = await this.pool.query(
      `SELECT a.code, a.label, a.active, a.sort_order, a.created_at,
              (SELECT count(*)::int FROM vehicles v WHERE v.category = a.code) AS vehicles,
              (SELECT count(*)::int FROM vehicles v WHERE v.category = a.code AND v.active AND v.suspended_at IS NULL) AS vehicles_active,
              EXISTS (SELECT 1 FROM pricing_versions p WHERE p.category = a.code AND p.approved_at IS NOT NULL AND p.effective_from <= now()) AS has_fees
         FROM asset_types a ORDER BY a.sort_order, a.code`,
    );
    return rows.map((r) => ({
      code: r.code, label: r.label, active: r.active, sortOrder: r.sort_order, createdAt: r.created_at,
      vehicles: r.vehicles, vehiclesInUse: r.vehicles_active, hasFees: r.has_fees, bookable: r.active && r.has_fees,
    }));
  }

  async create(input: { code: string; label: string }): Promise<void> {
    const code = input.code.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) throw new BadRequestException('the code must be 2 to 30 lowercase letters, numbers or underscores, starting with a letter');
    const label = input.label.trim();
    if (label.length < 2 || label.length > 40) throw new BadRequestException('the name must be 2 to 40 characters');
    try {
      await this.pool.query(`INSERT INTO asset_types (code, label, sort_order) VALUES ($1, $2, COALESCE((SELECT max(sort_order) + 10 FROM asset_types), 10))`, [code, label]);
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('a category with that code already exists');
      throw e;
    }
  }

  async update(code: string, patch: { label?: string; active?: boolean }): Promise<void> {
    if (patch.label !== undefined && (patch.label.trim().length < 2 || patch.label.trim().length > 40)) throw new BadRequestException('the name must be 2 to 40 characters');
    if (patch.active === false) {
      const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM asset_types WHERE active AND code <> $1`, [code]);
      if (rows[0].n === 0) throw new ConflictException({ code: 'last_category', message: 'at least one category must stay switched on, or nobody can book' });
    }
    const { rowCount } = await this.pool.query(
      `UPDATE asset_types SET label = COALESCE($2, label), active = COALESCE($3, active) WHERE code = $1`,
      [code, patch.label?.trim() ?? null, patch.active ?? null],
    );
    if (!rowCount) throw new NotFoundException('category not found');
  }

  /** A driver's vehicle or application may only use a category that is switched on. */
  async assertActive(code: string): Promise<void> {
    const { rows } = await this.pool.query(`SELECT active FROM asset_types WHERE code = $1`, [code]);
    if (!rows[0]) throw new BadRequestException('unknown category');
    if (!rows[0].active) throw new ConflictException({ code: 'category_off', message: 'that category is switched off' });
  }
}
