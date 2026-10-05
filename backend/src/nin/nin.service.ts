import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { NIN_VERIFIER, NinResult, NinVerifier } from './nin.verifier';

/** Runs NIN checks and keeps their outcome on the application. */
@Injectable()
export class NinService {
  private readonly log = new Logger(NinService.name);
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(NIN_VERIFIER) private readonly verifier: NinVerifier) {}

  /** Check a NIN now. Does not save anything. A provider that is down counts as pending, never as a pass. */
  async check(input: { nin: string; fullName: string; dateOfBirth?: string | null }): Promise<NinResult> {
    try {
      return await this.verifier.verify(input);
    } catch (e) {
      this.log.error(`NIN check failed to run (${this.verifier.name}): ${e}`);
      return { status: 'pending', reason: 'The verification service did not answer.' };
    }
  }

  async record(applicationId: string, r: NinResult): Promise<void> {
    await this.pool.query(
      `UPDATE driver_applications SET nin_status = $2, nin_reason = $3, nin_reference = COALESCE($4, nin_reference), nin_checked_at = now() WHERE id = $1`,
      [applicationId, r.status, r.reason ?? null, r.reference ?? null],
    );
  }

  /** Asks again for every check that was left pending, so a slow provider settles without anyone doing anything. */
  @Interval(60_000)
  async recheckPending(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.nin, a.date_of_birth, u.full_name FROM driver_applications a JOIN users u ON u.id = a.driver_id
        WHERE a.nin_status = 'pending' AND a.status IN ('SUBMITTED', 'CHANGES_REQUESTED') ORDER BY a.nin_checked_at LIMIT 20`,
    );
    for (const a of rows) await this.record(a.id, await this.check({ nin: a.nin, fullName: a.full_name, dateOfBirth: a.date_of_birth }));
    return rows.length;
  }
}
