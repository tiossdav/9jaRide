import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { OtpService } from './otp.service';
import { normalisePhone } from './phone';
import { Principal, Role, TokenPair } from './auth.types';
import { TokensService } from './tokens.service';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const LOGIN_LOCK = { failures: 5, minutes: 15 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}
// A real-looking hash to compare against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export interface Registration {
  role: 'rider' | 'driver';
  fullName: string;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
  ) {}

  private readonly signupChecks = new Map<string, number[]>();

  /**
   * Ask for a code. For a sign-up the number is checked FIRST: one that already has an account is refused with a plain message and no
   * text is sent (so nobody is charged for, or confused by, a code they cannot use). The check is limited per source address so it
   * cannot be used to list who is registered.
   */
  async requestOtp(phone: string, channel: 'sms' | 'voice', ip: string | null, purpose: 'signin' | 'signup' = 'signin') {
    if (purpose === 'signup') {
      const normal = normalisePhone(phone);
      if (!normal) throw new BadRequestException('enter a valid Nigerian mobile number');
      this.limitSignupChecks(ip ?? 'unknown');
      const taken = await this.pool.query(`SELECT 1 FROM users WHERE phone = $1`, [normal]);
      if (taken.rowCount) {
        throw new ConflictException({ message: 'This number already has an account. Please sign in instead.', code: 'phone_registered' });
      }
    }
    return this.otp.request(phone, channel, ip);
  }

  private limitSignupChecks(who: string): void {
    const now = Date.now();
    const recent = (this.signupChecks.get(who) ?? []).filter((t) => now - t < 600_000);
    if (recent.length >= 20) throw new HttpException('too many attempts, try again later', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.signupChecks.set(who, recent);
    if (this.signupChecks.size > 5000) for (const [k, v] of this.signupChecks) if (!v.some((t) => now - t < 600_000)) this.signupChecks.delete(k);
  }

  /**
   * Sign in with a code. A number with no account gets a 422 carrying a short-lived registration ticket: the code is
   * already spent, so the app finishes sign-up with POST /auth/register instead of asking for a second SMS.
   */
  async verifyOtp(rawPhone: string, code: string): Promise<{ tokens: TokenPair; isNewUser: boolean; role: Role }> {
    const phone = await this.otp.verify(rawPhone, code);
    const found = await this.pool.query(`SELECT id, role, status FROM users WHERE phone = $1`, [phone]);
    if (!found.rows[0]) {
      throw new HttpException(
        { message: 'registration required', code: 'registration_required', registrationTicket: this.tokens.signRegistrationTicket(phone) },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.signIn(found.rows[0], false);
  }

  /** Finish sign-up for a number that passed the code check. The role is fixed from then on. */
  async register(ticket: string, registration: Registration): Promise<{ tokens: TokenPair; isNewUser: boolean; role: Role }> {
    const phone = this.tokens.verifyRegistrationTicket(ticket);
    let isNewUser = true;
    let user: any;
    try {
      const created = await this.pool.query(
        `INSERT INTO users (phone, full_name, role) VALUES ($1, $2, $3) RETURNING id, role, status`,
        [phone, registration.fullName.trim(), registration.role],
      );
      user = created.rows[0];
    } catch (e: any) {
      if (e?.code !== '23505') throw e;
      // Registered a moment ago (a double tap, or two devices): sign in to the existing account, never change its role.
      user = (await this.pool.query(`SELECT id, role, status FROM users WHERE phone = $1`, [phone])).rows[0];
      isNewUser = false;
    }
    return this.signIn(user, isNewUser);
  }

  private async signIn(user: { id: string; role: Role; status: string }, isNewUser: boolean) {
    if (user.status !== 'active') throw new ForbiddenException('this account is suspended');
    const tokens = await this.tokens.startSession({ id: user.id, kind: 'user', role: user.role });
    return { tokens, isNewUser, role: user.role };
  }

  /** The principal as it is right now, or null if the account is gone or suspended. Used on refresh. */
  private async currentPrincipal(kind: 'user' | 'staff', id: string): Promise<Principal | null> {
    if (kind === 'user') {
      const { rows } = await this.pool.query(`SELECT role FROM users WHERE id = $1 AND status = 'active'`, [id]);
      return rows[0] ? { id, kind, role: rows[0].role } : null;
    }
    const { rows } = await this.pool.query(`SELECT role FROM staff_users WHERE id = $1 AND active`, [id]);
    return rows[0] ? { id, kind, role: rows[0].role } : null;
  }

  /** Who is signed in: the token's identity plus the name and phone the apps show. */
  async profile(p: Principal) {
    const { rows } =
      p.kind === 'user'
        ? await this.pool.query(`SELECT full_name AS name, phone FROM users WHERE id = $1`, [p.id])
        : await this.pool.query(`SELECT full_name AS name, email, must_change_password FROM staff_users WHERE id = $1`, [p.id]);
    return { id: p.id, kind: p.kind, role: p.role, name: rows[0]?.name ?? null, phone: rows[0]?.phone ?? null, email: rows[0]?.email ?? null, mustChangePassword: rows[0]?.must_change_password ?? false };
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, (k, id) => this.currentPrincipal(k, id));
  }

  logout(refreshToken: string) {
    return this.tokens.revokeFamilyOf(refreshToken);
  }

  logoutEverywhere(p: Principal) {
    return this.tokens.revokeAll(p.kind, p.id);
  }

  // ------------------------------------------------------------------ staff

  async staffLogin(rawEmail: string, password: string): Promise<{ tokens: TokenPair; role: Role; mustChangePassword: boolean }> {
    const email = rawEmail.trim().toLowerCase();
    const { rows } = await this.pool.query(
      `SELECT id, role, password_hash, active, must_change_password, locked_until > now() AS locked FROM staff_users WHERE email = $1`,
      [email],
    );
    const staff = rows[0];
    const ok = await checkPassword(password, staff?.password_hash ?? DUMMY_HASH);
    const bad = () => new UnauthorizedException('wrong email or password');

    if (!staff) throw bad();
    if (staff.locked) throw new HttpException('too many failed attempts, try again later', HttpStatus.TOO_MANY_REQUESTS);
    if (!ok || !staff.active) {
      await this.pool.query(
        `UPDATE staff_users
            SET failed_logins = failed_logins + 1,
                locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1`,
        [staff.id, LOGIN_LOCK.failures, LOGIN_LOCK.minutes],
      );
      throw bad();
    }
    await this.pool.query(`UPDATE staff_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [staff.id]);
    const tokens = await this.tokens.startSession({ id: staff.id, kind: 'staff', role: staff.role });
    return { tokens, role: staff.role, mustChangePassword: staff.must_change_password };
  }

  /** Staff change their own password. Every session is ended, so the caller signs in again with the new one. */
  async changeStaffPassword(staffId: string, current: string, next: string): Promise<void> {
    if (next.length < 12) throw new BadRequestException('the new password must be at least 12 characters');
    if (next === current) throw new BadRequestException('the new password must be different from the current one');
    if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) throw new BadRequestException('use letters and numbers in the new password');
    const { rows } = await this.pool.query(`SELECT password_hash FROM staff_users WHERE id = $1 AND active`, [staffId]);
    if (!rows[0] || !(await checkPassword(current, rows[0].password_hash))) throw new UnauthorizedException('the current password is wrong');
    await this.pool.query(`UPDATE staff_users SET password_hash = $2, must_change_password = false WHERE id = $1`, [staffId, await hashPassword(next)]);
    await this.tokens.revokeAll('staff', staffId);
  }

  async createStaff(email: string, fullName: string, role: 'support' | 'finance' | 'admin', password: string): Promise<string> {
    if (password.length < 12) throw new RangeError('staff password must be at least 12 characters');
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO staff_users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email.trim().toLowerCase(), fullName, role, await hashPassword(password)],
      );
      return rows[0].id;
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('a staff member with that email already exists');
      throw e;
    }
  }
}
