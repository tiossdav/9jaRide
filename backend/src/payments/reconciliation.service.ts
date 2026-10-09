import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { PAYMENT_PROVIDER, PAYOUT_PROVIDER, PAYOUT_STUCK_SECONDS, PaymentProvider, PayoutProvider } from './payments.types';

const ADVISORY_LOCK_KEY = 947_001; // one reconciliation at a time across all instances
const WINDOW_HOURS = 25; // hourly job with an hour of overlap, so a run that was skipped is covered by the next
const PENDING_GRACE_SECONDS = 120; // let the normal webhook arrive first
const PENDING_EXPIRY_HOURS = 24;

export interface ReconciliationResult {
  runId: string | null; // null when another instance already holds the lock
  recovered: number;
  findings: number;
}

/**
 * Hourly safety net for missed or wrong webhooks. It never trusts our own records or the provider's alone: it
 * compares both, completes what is safe to complete (a paid top-up with no credit), and writes everything else
 * down as a finding for a person. Findings are never auto-fixed because they involve money going the wrong way.
 */
@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(PAYOUT_PROVIDER) private readonly payoutProvider: PayoutProvider,
    private readonly paymentsService: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly ledger: LedgerService,
  ) {}

  async run(now = new Date()): Promise<ReconciliationResult> {
    const lockClient = await this.pool.connect();
    try {
      const got = await lockClient.query(`SELECT pg_try_advisory_lock($1) AS ok`, [ADVISORY_LOCK_KEY]);
      if (!got.rows[0].ok) return { runId: null, recovered: 0, findings: 0 };
      try {
        return await this.runLocked(now);
      } finally {
        await lockClient.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
      }
    } finally {
      lockClient.release();
    }
  }

  private async runLocked(now: Date): Promise<ReconciliationResult> {
    const from = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
    const { rows } = await this.pool.query(
      `INSERT INTO reconciliation_runs (window_from, window_to) VALUES ($1, $2) RETURNING id`,
      [from, now],
    );
    const runId = rows[0].id as string;
    let recovered = 0;
    let findings = 0;
    const errors: string[] = [];

    const finding = async (kind: string, reference: string | null, detail: Record<string, unknown> = {}) => {
      findings++;
      this.log.error(`reconciliation finding ${kind} ${reference ?? ''} ${JSON.stringify(detail)}`);
      await this.pool.query(
        `INSERT INTO reconciliation_findings (run_id, kind, reference, detail) VALUES ($1, $2, $3, $4)`,
        [runId, kind, reference, JSON.stringify(detail)],
      );
    };
    // One failing step (say, the provider is down) must not stop the others from running.
    const step = async (name: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (e) {
        errors.push(`${name}: ${e}`);
        this.log.error(`reconciliation step ${name} failed: ${e}`);
      }
    };

    await step('pending_topups', async () => {
      const pending = await this.pool.query(
        `SELECT reference, created_at FROM payment_intents
          WHERE status = 'PENDING' AND created_at < $1 ORDER BY created_at LIMIT 500`,
        [new Date(now.getTime() - PENDING_GRACE_SECONDS * 1000)],
      );
      for (const p of pending.rows) {
        const outcome = await this.paymentsService.settleIntent(p.reference);
        if (outcome === 'credited') recovered++;
        else if (outcome === 'mismatch') await finding('amount_mismatch', p.reference);
        else if (outcome === 'pending' && new Date(p.created_at).getTime() < now.getTime() - PENDING_EXPIRY_HOURS * 3_600_000) {
          // Never paid within a day. A late payment would still be caught by the provider comparison below.
          await this.pool.query(`UPDATE payment_intents SET status = 'FAILED', updated_at = now() WHERE reference = $1 AND status = 'PENDING'`, [p.reference]);
        }
      }
    });

    await step('provider_vs_ledger', async () => {
      const successful = await this.payments.listSuccessful(from, now);
      const seen = new Set<string>();
      for (const tx of successful) {
        seen.add(tx.reference);
        const found = await this.pool.query(`SELECT status, amount_kobo FROM payment_intents WHERE reference = $1`, [tx.reference]);
        const intent = found.rows[0];
        if (!intent) {
          await finding('unknown_reference', tx.reference, { amountKobo: tx.amountKobo });
        } else if (intent.status === 'SUCCESS') {
          if (Number(intent.amount_kobo) !== (tx.requestedAmountKobo ?? tx.amountKobo)) {
            await finding('amount_mismatch', tx.reference, { credited: Number(intent.amount_kobo), providerKobo: tx.amountKobo });
          }
        } else {
          // Paid at the provider but we never credited it (webhook lost, or intent expired): credit it now.
          const outcome = await this.paymentsService.settleIntent(tx.reference);
          if (outcome === 'credited') recovered++;
          else if (outcome === 'mismatch') await finding('amount_mismatch', tx.reference, { providerKobo: tx.amountKobo });
        }
      }

      // The other direction: we credited a wallet but the provider list does not show that payment.
      const credited = await this.pool.query(
        `SELECT reference FROM payment_intents WHERE status = 'SUCCESS' AND credited_at >= $1`, // no upper bound: the DB clock and ours can differ
        [from],
      );
      for (const c of credited.rows) {
        if (seen.has(c.reference)) continue;
        const tx = await this.payments.verifyTransaction(c.reference); // the list can lag or paginate; ask directly
        if (!tx || tx.status !== 'success') {
          await finding('credit_without_provider_success', c.reference, { providerStatus: tx?.status ?? 'not_found' });
        }
      }
    });

    await step('payouts', async () => {
      const processing = await this.pool.query(
        `SELECT id, provider_reference, EXTRACT(EPOCH FROM now() - processing_at)::float8 AS age_s
           FROM payout_requests WHERE status = 'PROCESSING'`,
      );
      for (const p of processing.rows) {
        const outcome = await this.payouts.refreshFromProvider(p.provider_reference);
        if (outcome === 'paid' || outcome === 'failed') recovered++;
        else if (outcome === 'pending' && p.age_s > PAYOUT_STUCK_SECONDS) {
          await finding('payout_stuck', p.provider_reference, { payoutId: p.id });
        }
      }
      // We refunded a payout as failed; make sure the provider did not actually send it.
      const failed = await this.pool.query(
        `SELECT id, provider_reference FROM payout_requests
          WHERE status = 'FAILED' AND provider_reference IS NOT NULL AND settled_at >= $1`,
        [from],
      );
      for (const p of failed.rows) {
        if ((await this.payoutProvider.verifyTransfer(p.provider_reference)) === 'SUCCESS') {
          await finding('payout_paid_after_failure', p.provider_reference, { payoutId: p.id });
        }
      }
    });

    await step('ledger_balance', async () => {
      const imbalance = await this.ledger.totalImbalanceKobo();
      if (imbalance !== 0) await finding('ledger_imbalance', null, { imbalanceKobo: imbalance });
    });

    await this.pool.query(
      `UPDATE reconciliation_runs SET finished_at = now(), recovered = $2, findings = $3, error = $4 WHERE id = $1`,
      [runId, recovered, findings, errors.length ? errors.join('; ') : null],
    );
    return { runId, recovered, findings };
  }
}
