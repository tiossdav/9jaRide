import { TermiiError, TermiiOtpSender, classifyTermii, termiiConfigFromEnv } from './termii.sender';

describe('TermiiOtpSender', () => {
  const keep = process.env.OTP_MODE;
  beforeEach(() => { process.env.OTP_MODE = 'live'; });
  afterEach(() => { if (keep === undefined) delete process.env.OTP_MODE; else process.env.OTP_MODE = keep; });
  const config = { apiKey: 'KEY', baseUrl: 'https://t.example', senderId: '9jaRide', channel: 'generic', timeoutMs: 1000 };
  const reply = (ok: boolean, status = 200, text = 'body') => jest.fn(async () => ({ ok, status, text: async () => text }));

  it('texts the code to the number without a plus sign', async () => {
    const http = reply(true);
    await new TermiiOtpSender(config, http).send('+2348031234567', '123456', 'sms');
    const [url, init] = http.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://t.example/api/sms/send');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ api_key: 'KEY', to: '2348031234567', from: '9jaRide', channel: 'generic', type: 'plain' });
    expect(body.sms).toContain('123456');
  });

  it('asks Termii to phone the number for a voice code', async () => {
    const http = reply(true);
    await new TermiiOtpSender(config, http).send('+2348031234567', '123456', 'voice');
    const [url, init] = http.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://t.example/api/sms/send/voice');
    expect(JSON.parse(init.body)).toMatchObject({ phone_number: '2348031234567', code: 123456 });
  });

  it('fails when Termii refuses, without putting the code in the error', async () => {
    const err = await new TermiiOtpSender(config, reply(false, 401)).send('+2348031234567', '123456', 'sms').catch((e) => e);
    expect(String(err)).toContain('401');
    expect(String(err)).not.toContain('123456');
  });

  it('sends nothing in test mode', async () => {
    process.env.OTP_MODE = 'test';
    const http = reply(true);
    await new TermiiOtpSender(config, http).send('+2348031234567', '0000', 'sms');
    expect(http).not.toHaveBeenCalled();
  });

  it('reads its settings from the environment, and is off without a key', () => {
    expect(termiiConfigFromEnv({})).toBeNull();
    expect(termiiConfigFromEnv({ TERMII_API_KEY: 'k', TERMII_BASE_URL: 'https://x.test/' })).toMatchObject({ apiKey: 'k', baseUrl: 'https://x.test', channel: 'generic' });
  });

  it('reads a success answer and does not retry it', async () => {
    const http = reply(true, 200, '{"code":"ok","message_id":"m1","message":"Successfully Sent","balance":50}');
    await new TermiiOtpSender(config, http).send('+2348031234567', '123456', 'sms');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('treats a 200 whose body is an error as a failure', async () => {
    const http = reply(true, 200, '{"code":"401","message":"Insufficient balance"}');
    const err = await new TermiiOtpSender(config, http).send('+2348031234567', '123456', 'sms').catch((e) => e);
    expect(err).toBeInstanceOf(TermiiError);
    expect(err.failure).toBe('no_balance');
    expect(http).toHaveBeenCalledTimes(1); // a clear refusal is not retried
  });

  it('tries once more after a server error or a network failure, then gives up', async () => {
    const down = reply(false, 503, 'busy');
    const err = await new TermiiOtpSender(config, down).send('+2348031234567', '123456', 'sms').catch((e) => e);
    expect(down).toHaveBeenCalledTimes(2);
    expect(err.failure).toBe('unavailable');

    let n = 0;
    const flaky = jest.fn(async () => {
      if (n++ === 0) throw new Error('socket hang up');
      return { ok: true, status: 200, text: async () => '{"code":"ok"}' };
    });
    await new TermiiOtpSender(config, flaky as any).send('+2348031234567', '123456', 'sms');
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, 'Too many requests', 'rate_limited'],
    [401, 'Invalid API key', 'bad_key'],
    [400, 'Sender ID not approved', 'sender_not_approved'],
    [400, 'Invalid phone number', 'invalid_number'],
    [500, 'oops', 'unavailable'],
    [400, 'something else', 'refused'],
  ])('classifies %s "%s" as %s', (status, text, failure) => {
    expect(classifyTermii(status, text).failure).toBe(failure);
  });

  it('never puts the API key or the code in an error', async () => {
    const err = await new TermiiOtpSender(config, reply(false, 400, 'bad request')).send('+2348031234567', '987654', 'sms').catch((e) => e);
    expect(String(err.message)).not.toContain('KEY');
    expect(String(err.message)).not.toContain('987654');
  });
});
