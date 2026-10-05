import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';

export const CARD_KINDS = ['invite', 'announcement', 'safety', 'promo', 'feature'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export interface CardInput { kind: CardKind; title: string; body: string; amountKobo?: number | null; active?: boolean; sortOrder?: number }

const present = (r: any) => ({
  id: r.id, kind: r.kind as CardKind, title: r.title, body: r.body, amountKobo: r.amount_kobo == null ? null : Number(r.amount_kobo),
  active: r.active, sortOrder: r.sort_order, updatedAt: r.updated_at,
});

/** The cards of the rider home screen. "{amount}" in a title or text becomes the card's reward amount, so it is changed in one place. */
@Injectable()
export class HomeContentService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private naira(kobo: number) { return '₦' + (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 }); }

  /** What the rider app shows: active cards only, in order, with the amount filled in. */
  async forRiders() {
    const { rows } = await this.pool.query(`SELECT * FROM home_cards WHERE active ORDER BY sort_order, created_at LIMIT 30`);
    return rows.map((r) => {
      const c = present(r);
      const amount = c.amountKobo == null ? '' : this.naira(c.amountKobo);
      return { id: c.id, kind: c.kind, title: c.title.replace('{amount}', amount).trim(), body: c.body.replace('{amount}', amount), amountKobo: c.amountKobo };
    });
  }

  async list() {
    const { rows } = await this.pool.query(`SELECT * FROM home_cards ORDER BY sort_order, created_at`);
    return rows.map(present);
  }

  async create(input: CardInput) {
    this.check(input);
    const { rows } = await this.pool.query(
      `INSERT INTO home_cards (kind, title, body, amount_kobo, active, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.kind, input.title.trim(), input.body.trim(), input.amountKobo ?? null, input.active ?? true, input.sortOrder ?? 100],
    );
    return present(rows[0]);
  }

  async update(id: string, input: CardInput) {
    this.check(input);
    const { rows } = await this.pool.query(
      `UPDATE home_cards SET kind = $2, title = $3, body = $4, amount_kobo = $5, active = $6, sort_order = $7, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, input.kind, input.title.trim(), input.body.trim(), input.amountKobo ?? null, input.active ?? true, input.sortOrder ?? 100],
    );
    if (!rows[0]) throw new NotFoundException('card not found');
    return present(rows[0]);
  }

  async remove(id: string) {
    const res = await this.pool.query(`DELETE FROM home_cards WHERE id = $1`, [id]);
    if (!res.rowCount) throw new NotFoundException('card not found');
  }

  private check(i: CardInput) {
    if (!i.title?.trim() || !i.body?.trim()) throw new BadRequestException('a card needs a title and some words');
    if (i.kind !== 'invite' && i.amountKobo != null) throw new BadRequestException('only an invite card has a reward amount');
  }
}
