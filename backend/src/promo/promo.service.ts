import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { percentOf } from '../common/money';

export interface PromoRow {
  id: string; code: string; description: string; kind: 'percent' | 'fixed'; value: number; max_discount_kobo: number | null; min_fare_kobo: number;
  categories: string[] | null; starts_at: Date; ends_at: Date | null; max_uses: number | null; per_rider_limit: number; active: boolean;
}

/** What taking a code off a fare comes to. Never more than the fare, never more than the code's own cap. */
export function discountFor(p: Pick<PromoRow, 'kind' | 'value' | 'max_discount_kobo' | 'min_fare_kobo'>, fareKobo: number): number {
  if (fareKobo <= 0 || fareKobo < Number(p.min_fare_kobo)) return 0;
  let d = p.kind === 'percent' ? percentOf(fareKobo, Number(p.value)) : Number(p.value);
  if (p.max_discount_kobo != null) d = Math.min(d, Number(p.max_discount_kobo));
  return Math.max(0, Math.min(d, fareKobo));
}

const refuse = (m: string) => new UnprocessableEntityException({ code: 'promo_invalid', message: m });
const LIVE_RIDE = `r.status NOT IN ('CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM', 'NO_DRIVER_FOUND')`;

@Injectable()
export class PromoService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async uses(db: Pick<Pool, 'query'>, promoId: string, riderId?: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM rides r WHERE r.promo_code_id = $1 AND ${LIVE_RIDE} AND ($2::uuid IS NULL OR r.rider_id = $2)`, [promoId, riderId ?? null],
    );
    return rows[0].n;
  }

  /** Every reason a code may be refused, in the words a rider should read. `db` is the transaction when reserving. */
  async check(db: Pick<Pool, 'query'>, riderId: string, rawCode: string, category: string, expectedFareKobo: number, lock = false) {
    const code = rawCode.trim().toUpperCase();
    const { rows } = await db.query(`SELECT *, now() AS db_now FROM promo_codes WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`, [code]);
    const p = rows[0] as (PromoRow & { db_now: Date }) | undefined;
    if (!p || !p.active) throw refuse('That code is not valid.');
    // The database's clock decides, so a small difference between this server and the database cannot flip a code on or off.
    const now = new Date(p.db_now).getTime();
    if (new Date(p.starts_at).getTime() > now) throw refuse('That code is not active yet.');
    if (p.ends_at && new Date(p.ends_at).getTime() <= now) throw refuse('That code has expired.');
    if (p.categories && !p.categories.includes(category)) throw refuse('That code does not apply to this kind of ride.');
    if (p.max_uses != null && (await this.uses(db, p.id)) >= p.max_uses) throw refuse('That code has been used up.');
    if ((await this.uses(db, p.id, riderId)) >= p.per_rider_limit) throw refuse(p.per_rider_limit === 1 ? 'You have already used that code.' : `You can use that code ${p.per_rider_limit} times, and you have.`);
    if (expectedFareKobo < Number(p.min_fare_kobo)) throw refuse(`That code needs a fare of at least ₦${(Number(p.min_fare_kobo) / 100).toLocaleString('en-NG')}.`);
    return { promo: p, discountKobo: discountFor(p, expectedFareKobo) };
  }

  /** In the ride-request transaction: lock the code, check it again, and tie it to the ride so it counts as used. */
  async reserve(client: PoolClient, rideId: string, riderId: string, code: string, category: string, expectedFareKobo: number): Promise<void> {
    const { promo } = await this.check(client, riderId, code, category, expectedFareKobo, true);
    await client.query(`UPDATE rides SET promo_code_id = $2 WHERE id = $1`, [rideId, promo.id]);
  }

  /** At settlement: the discount on the final fare, kept on the ride so the receipt and the ledger agree. */
  async settle(client: PoolClient, rideId: string, fareKobo: number): Promise<number> {
    const { rows } = await client.query(
      `SELECT p.kind, p.value, p.max_discount_kobo, p.min_fare_kobo, r.promo_discount_kobo FROM rides r JOIN promo_codes p ON p.id = r.promo_code_id WHERE r.id = $1`, [rideId],
    );
    if (!rows[0]) return 0;
    if (rows[0].promo_discount_kobo != null) return Number(rows[0].promo_discount_kobo); // settled before: same answer on a retry
    const d = discountFor(rows[0], fareKobo);
    await client.query(`UPDATE rides SET promo_discount_kobo = $2 WHERE id = $1`, [rideId, d]);
    return d;
  }

  // ------------------------------------------------------------------ admin

  async list() {
    const { rows } = await this.pool.query(
      `SELECT p.*, now() AS db_now,
              (SELECT count(*)::int FROM rides r WHERE r.promo_code_id = p.id AND ${LIVE_RIDE}) AS uses,
              (SELECT COALESCE(sum(r.promo_discount_kobo), 0)::bigint FROM rides r WHERE r.promo_code_id = p.id AND r.status = 'TRIP_COMPLETED') AS given
         FROM promo_codes p ORDER BY p.created_at DESC LIMIT 300`,
    );
    return rows.map((p) => this.present(p, p.uses, Number(p.given), new Date(p.db_now).getTime()));
  }

  private present(p: PromoRow, uses = 0, givenKobo = 0, now = Date.now()) {
    const state = !p.active ? 'off' : new Date(p.starts_at).getTime() > now ? 'scheduled' : p.ends_at && new Date(p.ends_at).getTime() <= now ? 'expired' : p.max_uses != null && uses >= p.max_uses ? 'used_up' : 'live';
    return {
      id: p.id, code: p.code, description: p.description, kind: p.kind, value: Number(p.value), maxDiscountKobo: p.max_discount_kobo == null ? null : Number(p.max_discount_kobo),
      minFareKobo: Number(p.min_fare_kobo), categories: p.categories, startsAt: p.starts_at, endsAt: p.ends_at, maxUses: p.max_uses, perRiderLimit: p.per_rider_limit,
      active: p.active, uses, givenKobo, state,
    };
  }

  async redemptions(promoId: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.short_code, r.status, r.created_at, r.promo_discount_kobo, u.full_name FROM rides r JOIN users u ON u.id = r.rider_id
        WHERE r.promo_code_id = $1 ORDER BY r.created_at DESC LIMIT 200`, [promoId],
    );
    return rows.map((r) => ({ rideId: r.id, code: r.short_code, status: r.status, at: r.created_at, rider: r.full_name, discountKobo: r.promo_discount_kobo == null ? null : Number(r.promo_discount_kobo) }));
  }

  private clean(i: any, creating: boolean) {
    const out: Record<string, unknown> = {};
    if (creating || i.code !== undefined) {
      const code = String(i.code ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new BadRequestException('the code must be 3 to 20 letters or numbers');
      out.code = code;
    }
    if (creating) {
      if (i.kind !== 'percent' && i.kind !== 'fixed') throw new BadRequestException('choose percent or a fixed amount');
      out.kind = i.kind;
    }
    if (creating || i.value !== undefined) {
      const kind = (creating ? i.kind : i.kind) ?? undefined;
      if (!Number.isSafeInteger(i.value) || i.value <= 0) throw new BadRequestException('the discount must be more than zero');
      if (kind === 'percent' && i.value > 10_000) throw new BadRequestException('a percentage cannot be more than 100%');
      out.value = i.value;
    }
    for (const k of ['maxDiscountKobo', 'minFareKobo'] as const) {
      if (i[k] !== undefined && i[k] !== null && (!Number.isSafeInteger(i[k]) || i[k] < 0)) throw new BadRequestException(`${k === 'maxDiscountKobo' ? 'the cap' : 'the minimum fare'} must be a whole amount in kobo`);
    }
    if (i.maxDiscountKobo !== undefined) out.max_discount_kobo = i.maxDiscountKobo || null;
    if (i.minFareKobo !== undefined) out.min_fare_kobo = i.minFareKobo ?? 0;
    if (i.maxUses !== undefined) { if (i.maxUses !== null && (!Number.isSafeInteger(i.maxUses) || i.maxUses < 1)) throw new BadRequestException('total uses must be at least 1'); out.max_uses = i.maxUses; }
    if (i.perRiderLimit !== undefined) { if (!Number.isSafeInteger(i.perRiderLimit) || i.perRiderLimit < 1) throw new BadRequestException('uses per rider must be at least 1'); out.per_rider_limit = i.perRiderLimit; }
    if (i.categories !== undefined) out.categories = i.categories && i.categories.length ? i.categories : null;
    if (i.startsAt !== undefined) out.starts_at = i.startsAt;
    if (i.endsAt !== undefined) out.ends_at = i.endsAt;
    if (i.description !== undefined) out.description = String(i.description).slice(0, 200);
    if (i.active !== undefined) out.active = !!i.active;
    return out;
  }

  async create(staffId: string, input: any): Promise<{ id: string }> {
    const v = this.clean(input, true);
    if (v.ends_at && v.starts_at && new Date(v.ends_at as string) <= new Date(v.starts_at as string)) throw new BadRequestException('it must end after it starts');
    const cols = Object.keys(v);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO promo_codes (${cols.join(', ')}, created_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
        [...cols.map((c) => v[c]), staffId],
      );
      return { id: rows[0].id };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('that code already exists');
      if (e?.code === '23514') throw new BadRequestException('those limits do not make sense together');
      throw e;
    }
  }

  async update(id: string, input: any): Promise<void> {
    const { rows } = await this.pool.query(`SELECT kind FROM promo_codes WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('promo code not found');
    const v = this.clean({ ...input, kind: input.value !== undefined ? rows[0].kind : undefined }, false);
    delete v.code; // a code never changes once riders may have it
    const cols = Object.keys(v);
    if (!cols.length) return;
    try {
      await this.pool.query(`UPDATE promo_codes SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => v[c])]);
    } catch (e: any) {
      if (e?.code === '23514') throw new BadRequestException('those limits do not make sense together');
      throw e;
    }
  }
}
