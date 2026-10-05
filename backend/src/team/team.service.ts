import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { hashPassword } from '../auth/auth.service';
import { TokensService } from '../auth/tokens.service';
import { PG_POOL } from '../common/infra.module';

export type StaffRole = 'support' | 'finance' | 'admin' | 'business';

/**
 * Staff accounts, managed by admins. Inviting creates the account with a one-time password that is shown once to
 * the admin (to pass on privately) and must be changed at first sign-in. There is no email sending yet.
 */
@Injectable()
export class TeamService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly tokens: TokensService) {}

  private present(r: any) {
    return {
      id: r.id, name: r.full_name, email: r.email, phone: r.phone, role: r.role as StaffRole, active: r.active,
      pendingFirstLogin: r.must_change_password, lastLoginAt: r.last_login_at, createdAt: r.created_at, invitedBy: r.invited_by_name ?? null,
    };
  }

  async list(search?: string) {
    const { rows } = await this.pool.query(
      `SELECT s.*, i.full_name AS invited_by_name FROM staff_users s LEFT JOIN staff_users i ON i.id = s.invited_by
        WHERE s.role <> 'business' AND ($1::text IS NULL OR s.full_name ILIKE $1 OR s.email ILIKE $1) ORDER BY s.created_at DESC LIMIT 200`,
      [search?.trim() ? `%${search.trim()}%` : null],
    );
    return rows.map((r) => this.present(r));
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT s.*, i.full_name AS invited_by_name FROM staff_users s LEFT JOIN staff_users i ON i.id = s.invited_by WHERE s.id = $1`, [id],
    );
    if (!rows[0]) throw new NotFoundException('team member not found');
    const recent = await this.pool.query(`SELECT method, path, status_code, created_at FROM staff_audit_log WHERE staff_id = $1 ORDER BY id DESC LIMIT 15`, [id]);
    return { ...this.present(rows[0]), recent: recent.rows.map((l) => ({ method: l.method, path: l.path, status: l.status_code, at: l.created_at })) };
  }

  async invite(by: string, input: { email: string; fullName: string; phone?: string; role: StaffRole; businessId?: string }) {
    if ((input.role === 'business') !== !!input.businessId) throw new BadRequestException('a business account needs a business, and no other role takes one');
    const password = randomBytes(15).toString('base64url');
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO staff_users (email, full_name, phone, role, password_hash, must_change_password, invited_by, business_id)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id`,
        [input.email.trim().toLowerCase(), input.fullName.trim(), input.phone?.trim() || null, input.role, await hashPassword(password), by, input.businessId ?? null],
      );
      return { id: rows[0].id, temporaryPassword: password };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('a team member with that email already exists');
      throw e;
    }
  }

  /** The last active admin can never be demoted or switched off: that would lock everyone out of this page. */
  private async assertNotLastAdmin(id: string) {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM staff_users WHERE role = 'admin' AND active AND id <> $1`, [id]);
    if (rows[0].n === 0) throw new ConflictException({ code: 'last_admin', message: 'there must always be at least one active admin' });
  }

  async setRole(by: string, id: string, role: StaffRole) {
    if (by === id) throw new BadRequestException('you cannot change your own role');
    const { rows } = await this.pool.query(`SELECT role FROM staff_users WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('team member not found');
    if (rows[0].role === 'business' || role === 'business') throw new BadRequestException('a business account cannot change role; create a new account instead');
    if (rows[0].role === 'admin' && role !== 'admin') await this.assertNotLastAdmin(id);
    await this.pool.query(`UPDATE staff_users SET role = $2 WHERE id = $1`, [id, role]);
    await this.tokens.revokeAll('staff', id); // the new role applies on the next sign-in
  }

  async setActive(by: string, id: string, active: boolean) {
    if (by === id) throw new BadRequestException('you cannot switch off your own account');
    const { rows } = await this.pool.query(`SELECT role, active FROM staff_users WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('team member not found');
    if (!active && rows[0].role === 'admin') await this.assertNotLastAdmin(id);
    await this.pool.query(`UPDATE staff_users SET active = $2, failed_logins = 0, locked_until = NULL WHERE id = $1`, [id, active]);
    if (!active) await this.tokens.revokeAll('staff', id);
  }

  /** A new one-time password, for someone locked out. Shown once; they must change it at next sign-in. */
  async resetPassword(id: string) {
    const password = randomBytes(15).toString('base64url');
    const { rowCount } = await this.pool.query(
      `UPDATE staff_users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1`, [id, await hashPassword(password)],
    );
    if (!rowCount) throw new NotFoundException('team member not found');
    await this.tokens.revokeAll('staff', id);
    return { temporaryPassword: password };
  }
}
