import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  BankDestination,
  PaymentProvider,
  PayoutProvider,
  ProviderTransaction,
  TransferRejectedError,
  TransferStatus,
} from './payments.types';

const BASE_URL = 'https://api.paystack.co';

/** Paystack signs the raw body with HMAC-SHA512 using the secret key (header x-paystack-signature). */
export function paystackSignature(rawBody: Buffer | string, secretKey: string): string {
  return createHmac('sha512', secretKey).update(rawBody).digest('hex');
}

function normaliseStatus(s: string): ProviderTransaction['status'] {
  if (s === 'success') return 'success';
  if (s === 'failed') return 'failed';
  if (s === 'abandoned' || s === 'reversed') return 'abandoned';
  return 'pending';
}

/**
 * Paystack over plain fetch, written from Paystack's public API docs. Tests cover the signature check, the request
 * and the response handling against a stand-in for Paystack; run a payment with Paystack TEST keys (sk_test_...)
 * before going live.
 */
@Injectable()
export class PaystackClient implements PaymentProvider, PayoutProvider {
  constructor(private readonly secretKey: string | undefined = process.env.PAYSTACK_SECRET_KEY) {}

  private requireKey(): string {
    if (!this.secretKey) throw new Error('PAYSTACK_SECRET_KEY is not set: payments are not configured');
    return this.secretKey;
  }

  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!this.secretKey || !signature) return false;
    const expected = Buffer.from(paystackSignature(rawBody, this.secretKey), 'hex');
    const given = Buffer.from(signature, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.requireKey()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async initialize(input: { reference: string; amountKobo: number; email: string; callbackUrl?: string; metadata?: Record<string, unknown> }) {
    const { status, json } = await this.call('POST', '/transaction/initialize', {
      reference: input.reference,
      amount: input.amountKobo, // Paystack amounts are already in the lowest unit (kobo)
      email: input.email,
      currency: 'NGN',
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    if (status >= 300 || !json?.status) throw new Error(`paystack initialize failed (${status}): ${json?.message ?? 'no message'}`);
    return { authorizationUrl: json.data.authorization_url as string };
  }

  private toTransaction(d: any): ProviderTransaction {
    return {
      reference: d.reference, status: normaliseStatus(d.status), amountKobo: Number(d.amount), currency: d.currency,
      ...(d.requested_amount != null ? { requestedAmountKobo: Number(d.requested_amount) } : {}),
    };
  }

  async verifyTransaction(reference: string): Promise<ProviderTransaction | null> {
    const { status, json } = await this.call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (status === 404) return null;
    if (status >= 300 || !json?.status) throw new Error(`paystack verify failed (${status}): ${json?.message ?? 'no message'}`);
    return this.toTransaction(json.data);
  }

  async listSuccessful(from: Date, to: Date): Promise<ProviderTransaction[]> {
    const out: ProviderTransaction[] = [];
    for (let page = 1; page <= 200; page++) {
      const q = `status=success&perPage=100&page=${page}&from=${from.toISOString()}&to=${to.toISOString()}`;
      const { status, json } = await this.call('GET', `/transaction?${q}`);
      if (status >= 300 || !json?.status) throw new Error(`paystack list failed (${status}): ${json?.message ?? 'no message'}`);
      out.push(...(json.data as any[]).map((d) => this.toTransaction(d)));
      if (page >= (json.meta?.pageCount ?? 1)) return out;
    }
    throw new Error('paystack list exceeded 200 pages; shorten the reconciliation window');
  }

  // ---------------------------------------------------------------- payouts

  private async recipientCode(bank: BankDestination): Promise<string> {
    const { status, json } = await this.call('POST', '/transferrecipient', {
      type: 'nuban',
      name: bank.accountName,
      account_number: bank.accountNumber,
      bank_code: bank.bankCode,
      currency: 'NGN',
    });
    if (status >= 400 && status < 500 && status !== 429) throw new TransferRejectedError(json?.message ?? 'recipient rejected');
    if (status >= 300 || !json?.status) throw new Error(`paystack recipient failed (${status}): ${json?.message ?? 'no message'}`);
    return json.data.recipient_code as string;
  }

  async transfer(input: { reference: string; amountKobo: number; bank: BankDestination; reason: string }) {
    const recipient = await this.recipientCode(input.bank);
    const { status, json } = await this.call('POST', '/transfer', {
      source: 'balance',
      amount: input.amountKobo,
      recipient,
      reference: input.reference,
      reason: input.reason,
    });
    // A 4xx is a definite refusal. A 5xx, a timeout or a thrown network error is "unknown": the caller must not refund yet.
    if (status >= 400 && status < 500 && status !== 429) throw new TransferRejectedError(json?.message ?? `transfer rejected (${status})`);
    if (status >= 300 || !json?.status) throw new Error(`paystack transfer unknown (${status}): ${json?.message ?? 'no message'}`);
    const s = json.data?.status as string;
    if (s === 'failed' || s === 'reversed') throw new TransferRejectedError(`transfer ${s}`);
    // 'otp' means Paystack wants a human to confirm it: leave it pending and let reconciliation surface it.
    return { status: s === 'success' ? ('SUCCESS' as const) : ('PENDING' as const) };
  }

  async verifyTransfer(reference: string): Promise<TransferStatus> {
    const { status, json } = await this.call('GET', `/transfer/verify/${encodeURIComponent(reference)}`);
    if (status === 404) return 'NOT_FOUND';
    if (status >= 300 || !json?.status) throw new Error(`paystack transfer verify failed (${status}): ${json?.message ?? 'no message'}`);
    const s = json.data?.status as string;
    if (s === 'success') return 'SUCCESS';
    if (s === 'failed' || s === 'reversed') return 'FAILED';
    return 'PENDING';
  }
}
