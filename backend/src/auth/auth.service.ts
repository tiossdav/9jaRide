import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { OtpService } from './otp.service';
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

  requestOtp(phone: string, channel: 'sms' | 'voice', ip: string | null) {
    return this.otp.request(phone, channel, ip);
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

  async staffLogin(rawEmail: string, password: string): Promise<{ tokens: TokenPair; role: Role }> {
    const email = rawEmail.trim().toLowerCase();
    const { rows } = await this.pool.query(
      `SELECT id, role, password_hash, active, locked_until > now() AS locked FROM staff_users WHERE email = $1`,
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
    await this.pool.query(`UPDATE staff_users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [staff.id]);
    const tokens = await this.tokens.startSession({ id: staff.id, kind: 'staff', role: staff.role });
    return { tokens, role: staff.role };
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
