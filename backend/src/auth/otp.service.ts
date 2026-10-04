import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { OTP_MAX_ATTEMPTS, OTP_SENDER, OTP_TTL_SECONDS, OtpSender, TEST_OTP_CODE, otpCodeLength, otpTestMode } from './auth.types';
import { normalisePhone } from './phone';

// Limits (placeholders until agreed): per phone 3 codes / 10 min and 10 / day; per IP 20 / hour.
const PHONE_BURST = { max: 3, seconds: 600 };
const PHONE_DAILY = { max: 10, seconds: 86400 };
const IP_HOURLY = { max: 20, seconds: 3600 };

@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(OTP_SENDER) private readonly sender: OtpSender) {
    if (otpTestMode()) {
      // A fixed code lets anyone in. Fine on a test machine; never on a live service unless someone chose it on purpose.
      if (process.env.NODE_ENV === 'production' && process.env.OTP_ALLOW_TEST_IN_PRODUCTION !== 'true') {
        throw new Error('OTP_MODE is "test" (fixed code 0000) in production. Connect an SMS provider and set OTP_MODE=live.');
      }
      this.log.warn(`OTP test mode is ON: every sign-in code is ${TEST_OTP_CODE}. Set OTP_MODE=live once an SMS provider is connected.`);
    }
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', process.env.JWT_SECRET ?? '').update(`${phone}:${code}`).digest('hex');
  }

  private async count(column: 'phone' | 'ip', value: string, seconds: number): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM otp_challenges WHERE ${column} = $1 AND created_at > now() - make_interval(secs => $2)`,
      [value, seconds],
    );
    return rows[0].n;
  }

  /**
   * Send a code. The answer is identical whether or not the number has an account, so this cannot be used to
   * discover who is registered. Returns the normalised phone for the follow-up verify call.
   */
  async request(rawPhone: string, channel: 'sms' | 'voice', ip: string | null): Promise<{ phone: string; expiresInSeconds: number; codeLength: number; testMode: boolean }> {
    const phone = normalisePhone(rawPhone);
    if (!phone) throw new BadRequestException('enter a valid Nigerian mobile number');

    // Testers ask for codes constantly, so the request limits only apply to real codes. Wrong guesses stay limited.
    const tooMany = !otpTestMode() && (
      (await this.count('phone', phone, PHONE_BURST.seconds)) >= PHONE_BURST.max ||
      (await this.count('phone', phone, PHONE_DAILY.seconds)) >= PHONE_DAILY.max ||
      (ip !== null && (await this.count('ip', ip, IP_HOURLY.seconds)) >= IP_HOURLY.max));
    if (tooMany) throw new HttpException('too many code requests, try again later', HttpStatus.TOO_MANY_REQUESTS);

    const code = otpTestMode() ? TEST_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Only the newest code is valid.
    await this.pool.query(`UPDATE otp_challenges SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL`, [phone]);
    const { rows } = await this.pool.query(
      `INSERT INTO otp_challenges (phone, code_hash, channel, ip, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING id`,
      [phone, this.hash(phone, code), channel, ip, OTP_TTL_SECONDS],
    );
    try {
      await this.sender.send(phone, code, channel);
    } catch (e) {
      await this.pool.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [rows[0].id]);
      this.log.error(`sending code failed: ${e}`);
      throw new ServiceUnavailableException('could not send the code, try again');
    }
    return { phone, expiresInSeconds: OTP_TTL_SECONDS, codeLength: otpCodeLength(), testMode: otpTestMode() };
  }

  /** Check a code. A code works once, and only OTP_MAX_ATTEMPTS wrong guesses are allowed per code. Returns the phone. */
  async verify(rawPhone: string, code: string): Promise<string> {
    const phone = normalisePhone(rawPhone);
    const fail = () => new UnauthorizedException('invalid or expired code');
    if (!phone) throw fail();

    const latest = await this.pool.query(
      `SELECT id FROM otp_challenges WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (!latest.rows[0]) throw fail();
    const id = latest.rows[0].id as string;

    // Count the attempt first and atomically, so parallel guesses cannot exceed the limit.
    const attempt = await this.pool.query(
      `UPDATE otp_challenges SET attempts = attempts + 1
        WHERE id = $1 AND consumed_at IS NULL AND attempts < $2 AND expires_at > now() RETURNING code_hash`,
      [id, OTP_MAX_ATTEMPTS],
    );
    if (!attempt.rows[0]) throw fail();

    const expected = Buffer.from(attempt.rows[0].code_hash, 'hex');
    const given = Buffer.from(this.hash(phone, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw fail();

    // Single use even if the right code is submitted twice at the same moment.
    const used = await this.pool.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, [id]);
    if (!used.rowCount) throw fail();
    return phone;
  }
}
