import { Kobo } from '../common/money';

export interface ProviderTransaction {
  reference: string;
  /** Normalised: only 'success' may ever credit a wallet. */
  status: 'success' | 'failed' | 'abandoned' | 'pending';
  amountKobo: Kobo;
  currency: string;
}

export interface BankDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export type TransferStatus = 'SUCCESS' | 'PENDING' | 'FAILED' | 'NOT_FOUND';

/** The provider refused the transfer outright (bad account, no balance). Safe to fail the payout and refund the wallet. */
export class TransferRejectedError extends Error {}

/** Collecting money (wallet top-ups). */
export interface PaymentProvider {
  /** Authenticates a webhook. Must be checked against the RAW request body, before parsing. */
  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean;
  initialize(input: { reference: string; amountKobo: Kobo; email: string }): Promise<{ authorizationUrl: string }>;
  /** Ask the provider directly. Webhook payloads are never trusted for amounts. null = provider has no such reference. */
  verifyTransaction(reference: string): Promise<ProviderTransaction | null>;
  /** Successful transactions in a window, for reconciliation. */
  listSuccessful(from: Date, to: Date): Promise<ProviderTransaction[]>;
}

/** Sending money out (driver payouts). */
export interface PayoutProvider {
  /**
   * `reference` is ours and stable, so repeating the call cannot pay twice.
   * Throws TransferRejectedError for a definite refusal; any other error means "unknown, check before retrying".
   */
  transfer(input: { reference: string; amountKobo: Kobo; bank: BankDestination; reason: string }): Promise<{ status: 'SUCCESS' | 'PENDING' }>;
  verifyTransfer(reference: string): Promise<TransferStatus>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

/** Placeholder policy values, all overridable from the environment until finance decides. */
export const PAYOUT_MIN_KOBO = Number(process.env.PAYOUT_MIN_KOBO ?? 100_000); // ₦1,000
export const TOPUP_MIN_KOBO = Number(process.env.TOPUP_MIN_KOBO ?? 10_000); // ₦100
export const TOPUP_MAX_KOBO = Number(process.env.TOPUP_MAX_KOBO ?? 50_000_000); // ₦500,000
/** A PROCESSING payout the provider has never heard of after this long is failed and refunded. */
export const PAYOUT_STUCK_SECONDS = Number(process.env.PAYOUT_STUCK_SECONDS ?? 1800);
