import { planPayoutPaid, planPayoutRequest, planPayoutReversal } from '../ledger/postings';
import { PaystackClient, paystackSignature } from './paystack.client';

describe('Paystack webhook signature', () => {
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"topup_1"}}');
  const client = new PaystackClient('sk_test_abc');

  it('accepts the HMAC-SHA512 of the exact raw body', () => {
    expect(client.verifySignature(body, paystackSignature(body, 'sk_test_abc'))).toBe(true);
  });

  it('rejects a changed body, a wrong key, a missing or malformed signature', () => {
    const sig = paystackSignature(body, 'sk_test_abc');
    expect(client.verifySignature(Buffer.from(body.toString().replace('topup_1', 'topup_2')), sig)).toBe(false);
    expect(client.verifySignature(body, paystackSignature(body, 'other'))).toBe(false);
    expect(client.verifySignature(body, undefined)).toBe(false);
    expect(client.verifySignature(body, 'nothex')).toBe(false);
  });

  it('rejects everything when no secret key is configured', () => {
    expect(new PaystackClient(undefined).verifySignature(body, paystackSignature(body, ''))).toBe(false);
  });
});

describe('payout postings', () => {
  const sum = (ps: { amountKobo: number }[]) => ps.reduce((s, p) => s + p.amountKobo, 0);

  it('request, paid and reversal each balance, and request + reversal nets to zero for the driver', () => {
    const req = planPayoutRequest('d', 250_000);
    const rev = planPayoutReversal('d', 250_000);
    expect(sum(req)).toBe(0);
    expect(sum(planPayoutPaid(250_000))).toBe(0);
    expect(sum(rev)).toBe(0);
    const driver = [...req, ...rev].filter((p) => p.account === 'wallet:d');
    expect(sum(driver)).toBe(0);
  });
});
