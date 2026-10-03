import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { PG_POOL } from '../common/infra.module';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutsService } from './payouts.service';
import { PAYMENT_PROVIDER, PaymentProvider, TOPUP_MAX_KOBO, TOPUP_MIN_KOBO } from './payments.types';

export type SettleOutcome = 'credited' | 'duplicate' | 'pending' | 'failed' | 'mismatch' | 'unknown_reference';

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('webhook signature is missing or wrong');
  }
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly payouts: PayoutsService,
  ) {}

  /** Start a top-up. Nothing is credited here: only a verified provider result credits the wallet. */
  async initiateTopUp(userId: string, amountKobo: number): Promise<{ reference: string; authorizationUrl: string }> {
    if (!Number.isSafeInteger(amountKobo) || amountKobo < TOPUP_MIN_KOBO || amountKobo > TOPUP_MAX_KOBO) {
      throw new RangeError(`top-up must be a whole number of kobo between ${TOPUP_MIN_KOBO} and ${TOPUP_MAX_KOBO}`);
    }
    const { rows } = await this.pool.query(`SELECT phone FROM users WHERE id = $1`, [userId]);
    if (!rows[0]) throw new Error(`user ${userId} not found`);
    // Paystack needs an email and riders only have a phone. Placeholder address until real emails are collected.
    const email = `${String(rows[0].phone).replace(/\D/g, '')}@${process.env.PAYMENT_EMAIL_DOMAIN ?? 'example.invalid'}`;

    const reference = `topup_${randomUUID()}`;
    await this.pool.query(`INSERT INTO payment_intents (user_id, reference, amount_kobo) VALUES ($1, $2, $3)`, [userId, reference, amountKobo]);
    const { authorizationUrl } = await this.provider.initialize({ reference, amountKobo, email });
    return { reference, authorizationUrl };
  }

  /**
   * Entry point for the provider webhook. `rawBody` must be the exact bytes received (the signature covers them).
   * Throws InvalidWebhookSignatureError for a forged call (answer 401, store nothing). Any other throw means
   * "we could not process it": answer 5xx so the provider retries. Redelivery is always safe.
   */
  async handleWebhook(rawBody: Buffer | string, signature: string | undefined): Promise<string> {
    if (!this.provider.verifySignature(rawBody, signature)) throw new InvalidWebhookSignatureError();

    const event = JSON.parse(rawBody.toString());
    const type = String(event.event ?? 'unknown');
    const reference: string | null = event.data?.reference ?? null;
    const audit = await this.pool.query(
      `INSERT INTO provider_events (provider, event_type, reference, payload) VALUES ('paystack', $1, $2, $3) RETURNING id`,
      [type, reference, JSON.stringify(event)],
    );
    const auditId = audit.rows[0].id as string;

    let outcome: string;
    try {
      if (type === 'charge.success' && reference) {
        outcome = await this.settleIntent(reference);
      } else if (type.startsWith('transfer.') && reference) {
        // The payload is only a nudge: ask the provider what actually happened before moving any money.
        outcome = await this.payouts.refreshFromProvider(reference);
      } else {
        outcome = 'ignored';
      }
    } catch (e) {
      await this.pool.query(`UPDATE provider_events SET outcome = 'error' WHERE id = $1`, [auditId]).catch(() => undefined);
      throw e;
    }
    await this.pool.query(`UPDATE provider_events SET outcome = $2 WHERE id = $1`, [auditId, outcome]);
    return outcome;
  }

  /**
   * Ask the provider about one top-up and credit the wallet if, and only if, it really succeeded for the amount
   * we asked for. Used by the webhook and by reconciliation, so a missed webhook is recovered the same way.
   */
  async settleIntent(reference: string): Promise<SettleOutcome> {
    const found = await this.pool.query(`SELECT status, amount_kobo FROM payment_intents WHERE reference = $1`, [reference]);
    const intent = found.rows[0];
    if (!intent) return 'unknown_reference';
    if (intent.status === 'SUCCESS') return 'duplicate';
    if (intent.status === 'AMOUNT_MISMATCH') return 'mismatch'; // frozen for a person to decide

    const tx = await this.provider.verifyTransaction(reference); // network call: kept outside the DB transaction
    if (!tx || tx.status === 'pending') return 'pending';
    if (tx.status !== 'success') {
      await this.pool.query(`UPDATE payment_intents SET status = 'FAILED', updated_at = now() WHERE reference = $1 AND status = 'PENDING'`, [reference]);
      return 'failed';
    }

    if (tx.amountKobo !== Number(intent.amount_kobo) || tx.currency !== 'NGN') {
      this.log.error(`top-up ${reference}: provider collected ${tx.amountKobo} ${tx.currency}, expected ${intent.amount_kobo} NGN. Not credited.`);
      await this.pool.query(
        `UPDATE payment_intents SET status = 'AMOUNT_MISMATCH', provider_amount_kobo = $2, updated_at = now()
          WHERE reference = $1 AND status IN ('PENDING', 'FAILED')`,
        [reference, tx.amountKobo],
      );
      return 'mismatch';
    }

    return this.ledger.withTransaction(async (client) => {
      // Serialise concurrent deliveries of the same webhook on the intent row.
      const { rows } = await client.query(
        `SELECT user_id, amount_kobo, status FROM payment_intents WHERE reference = $1 FOR UPDATE`,
        [reference],
      );
      const locked = rows[0];
      if (locked.status === 'SUCCESS') return 'duplicate' as const;
      if (locked.status === 'AMOUNT_MISMATCH') return 'mismatch' as const;
      const posted = await this.ledger.topUp(client, locked.user_id, Number(locked.amount_kobo), reference);
      await client.query(
        `UPDATE payment_intents SET status = 'SUCCESS', credited_at = now(), updated_at = now() WHERE reference = $1`,
        [reference],
      );
      return posted ? ('credited' as const) : ('duplicate' as const);
    });
  }
}
