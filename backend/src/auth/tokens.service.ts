import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import {
  ACCESS_TOKEN_SECONDS,
  Principal,
  Role,
  STAFF_REFRESH_SECONDS,
  TokenPair,
  USER_REFRESH_SECONDS,
} from './auth.types';

const ISSUER = '9jaride';
const AUDIENCE = '9jaride-api';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class TokensService {
  private readonly secret: string;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      // Refuse to start rather than sign tokens with a guessable key.
      throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
    }
    this.secret = secret;
  }

  signAccess(p: Principal): string {
    return jwt.sign({ kind: p.kind, role: p.role }, this.secret, {
      algorithm: 'HS256',
      subject: p.id,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: ACCESS_TOKEN_SECONDS,
    });
  }

  verifyAccess(token: string): Principal {
    try {
      // The algorithm is pinned: a token claiming "none" or another algorithm is rejected.
      const c = jwt.verify(token, this.secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE }) as jwt.JwtPayload;
      if (c.purpose || !c.sub || (c.kind !== 'user' && c.kind !== 'staff') || typeof c.role !== 'string') throw new Error('bad claims');
      return { id: c.sub, kind: c.kind, role: c.role as Role };
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }

  /** Proof that this phone just passed an OTP check, so a first-time user can finish registering without a second code. */
  signRegistrationTicket(phone: string): string {
    return jwt.sign({ purpose: 'register' }, this.secret, { algorithm: 'HS256', subject: phone, issuer: ISSUER, audience: AUDIENCE, expiresIn: 600 });
  }

  verifyRegistrationTicket(ticket: string): string {
    try {
      const c = jwt.verify(ticket, this.secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE }) as jwt.JwtPayload;
      if (c.purpose !== 'register' || !c.sub) throw new Error('not a registration ticket');
      return c.sub;
    } catch {
      throw new UnauthorizedException('invalid or expired registration ticket');
    }
  }

  /** Start a new login: returns a fresh access + refresh pair. */
  async startSession(p: Principal, familyId = randomUUID()): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    const ttl = p.kind === 'staff' ? STAFF_REFRESH_SECONDS : USER_REFRESH_SECONDS;
    await this.pool.query(
      `INSERT INTO auth_sessions (family_id, subject_kind, subject_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
      [familyId, p.kind, p.id, sha256(refreshToken), ttl],
    );
    return { accessToken: this.signAccess(p), refreshToken, expiresInSeconds: ACCESS_TOKEN_SECONDS };
  }

  /**
   * Exchange a refresh token for a new pair. Each refresh token works once. Presenting one that was already used
   * means two parties hold it (theft or a replay), so the whole login family is revoked and both must sign in again.
   * `currentPrincipal` re-reads role/status from the database, so a suspension takes effect at the next refresh.
   */
  async rotate(
    refreshToken: string,
    currentPrincipal: (kind: 'user' | 'staff', id: string) => Promise<Principal | null>,
  ): Promise<TokenPair> {
    const client = await this.pool.connect();
    const reject = () => new UnauthorizedException('invalid or expired token');
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, family_id, subject_kind, subject_id, used_at, revoked_at, expires_at < now() AS expired
           FROM auth_sessions WHERE token_hash = $1 FOR UPDATE`,
        [sha256(refreshToken)],
      );
      const s = rows[0];
      if (!s || s.revoked_at || s.expired) {
        await client.query('COMMIT');
        throw reject();
      }
      const revokeFamily = () =>
        client.query(`UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [s.family_id]);
      if (s.used_at) {
        await revokeFamily();
        await client.query('COMMIT');
        throw reject();
      }
      const principal = await currentPrincipal(s.subject_kind, s.subject_id);
      if (!principal) {
        await revokeFamily();
        await client.query('COMMIT');
        throw reject();
      }
      await client.query(`UPDATE auth_sessions SET used_at = now() WHERE id = $1`, [s.id]);
      const next = randomBytes(32).toString('base64url');
      const ttl = principal.kind === 'staff' ? STAFF_REFRESH_SECONDS : USER_REFRESH_SECONDS;
      await client.query(
        `INSERT INTO auth_sessions (family_id, subject_kind, subject_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
        [s.family_id, principal.kind, principal.id, sha256(next), ttl],
      );
      await client.query('COMMIT');
      return { accessToken: this.signAccess(principal), refreshToken: next, expiresInSeconds: ACCESS_TOKEN_SECONDS };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Sign out this device: revoke the family the token belongs to. Unknown tokens are ignored. */
  async revokeFamilyOf(refreshToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = now()
        WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM auth_sessions WHERE token_hash = $1)`,
      [sha256(refreshToken)],
    );
  }

  /** Sign out everywhere. */
  async revokeAll(kind: 'user' | 'staff', id: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE subject_kind = $1 AND subject_id = $2 AND revoked_at IS NULL`,
      [kind, id],
    );
  }
}
