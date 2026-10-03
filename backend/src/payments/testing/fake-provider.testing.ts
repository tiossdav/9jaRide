import { BankDestination, ProviderTransaction, TransferRejectedError, TransferStatus } from '../payments.types';
import { PaystackClient } from '../paystack.client';

export const TEST_KEY = 'sk_test_unit';

export /** Real signature check, in-memory "network". */
class FakeProvider extends PaystackClient {
  txs = new Map<string, ProviderTransaction>();
  transfers = new Map<string, TransferStatus>();
  transferMode: 'ok' | 'reject' | 'unknown' = 'ok';
  constructor() {
    super(TEST_KEY);
  }
  async initialize(i: { reference: string }) {
    return { authorizationUrl: `https://pay.test/${i.reference}` };
  }
  async verifyTransaction(reference: string) {
    return this.txs.get(reference) ?? null;
  }
  async listSuccessful() {
    return [...this.txs.values()].filter((t) => t.status === 'success');
  }
  async transfer(i: { reference: string }) {
    if (this.transferMode === 'reject') throw new TransferRejectedError('bad account');
    if (this.transferMode === 'unknown') throw new Error('timeout');
    this.transfers.set(i.reference, 'SUCCESS');
    return { status: 'SUCCESS' as const };
  }
  async verifyTransfer(reference: string) {
    return this.transfers.get(reference) ?? 'NOT_FOUND';
  }
}
