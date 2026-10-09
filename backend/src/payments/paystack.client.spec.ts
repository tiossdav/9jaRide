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

describe('Paystack client requests (stand-in for Paystack, no network)', () => {
  const client = new PaystackClient('sk_test_abc');
  let calls: { url: string; init: any }[];
  const answer = (status: number, json: unknown) => {
    calls = [];
    jest.spyOn(global, 'fetch').mockImplementation((async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return { status, json: async () => json } as Response;
    }) as typeof fetch);
  };
  afterEach(() => jest.restoreAllMocks());

  it('starts a payment in kobo with our reference, the return page and the secret key, and returns the checkout address', async () => {
    answer(200, { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } });
    const r = await client.initialize({ reference: 'topup_1', amountKobo: 250_000, email: 'a@b.co', callbackUrl: 'https://api.test/payments/return', metadata: { userId: 'u' } });
    expect(r.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    expect(calls[0].url).toBe('https://api.paystack.co/transaction/initialize');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_test_abc');
    expect(JSON.parse(calls[0].init.body)).toEqual({ reference: 'topup_1', amount: 250_000, email: 'a@b.co', currency: 'NGN', callback_url: 'https://api.test/payments/return', metadata: { userId: 'u' } });
  });

  it('turns a Paystack refusal into an error that does not contain the key', async () => {
    answer(400, { status: false, message: 'Invalid key' });
    const err = await client.initialize({ reference: 'r', amountKobo: 1, email: 'a@b.co' }).catch((e) => e as Error) as Error;
    expect(String(err.message)).toContain('Invalid key');
    expect(String(err.message)).not.toContain('sk_test_abc');
  });

  it.each([
    ['success', 'success'], ['failed', 'failed'], ['abandoned', 'abandoned'], ['reversed', 'abandoned'], ['ongoing', 'pending'], ['pending', 'pending'], ['queued', 'pending'],
  ])('reads Paystack status "%s" as %s', async (paystack, ours) => {
    answer(200, { status: true, data: { reference: 'topup_1', status: paystack, amount: 250_000, currency: 'NGN' } });
    expect(await client.verifyTransaction('topup_1')).toEqual({ reference: 'topup_1', status: ours, amountKobo: 250_000, currency: 'NGN' });
    expect(calls[0].url).toBe('https://api.paystack.co/transaction/verify/topup_1');
  });

  it('reads the amount we asked for as well as the amount charged when Paystack adds its fee for the customer', async () => {
    answer(200, { status: true, data: { reference: 'topup_1', status: 'success', amount: 203046, requested_amount: 200000, fees: 3046, currency: 'NGN' } });
    expect(await client.verifyTransaction('topup_1')).toEqual({ reference: 'topup_1', status: 'success', amountKobo: 203046, requestedAmountKobo: 200000, currency: 'NGN' });
  });

  it('says "no such payment" for a 404 and throws for a server error, so a hiccup is never read as a failed payment', async () => {
    answer(404, { status: false, message: 'Transaction reference not found' });
    expect(await client.verifyTransaction('nope')).toBeNull();
    answer(502, {});
    await expect(client.verifyTransaction('x')).rejects.toThrow(/verify failed \(502\)/);
  });

  it('refuses to call Paystack at all without a secret key', async () => {
    answer(200, {});
    await expect(new PaystackClient(undefined).verifyTransaction('x')).rejects.toThrow(/PAYSTACK_SECRET_KEY/);
    expect(calls).toHaveLength(0);
  });
});
