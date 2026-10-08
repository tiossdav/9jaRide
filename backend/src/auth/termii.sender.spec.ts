import { TermiiOtpSender, termiiConfigFromEnv } from './termii.sender';

describe('TermiiOtpSender', () => {
  const keep = process.env.OTP_MODE;
  beforeEach(() => { process.env.OTP_MODE = 'live'; });
  afterEach(() => { if (keep === undefined) delete process.env.OTP_MODE; else process.env.OTP_MODE = keep; });
  const config = { apiKey: 'KEY', baseUrl: 'https://t.example', senderId: '9jaRide', channel: 'generic', timeoutMs: 1000 };
  const reply = (ok: boolean, status = 200) => jest.fn(async () => ({ ok, status, text: async () => 'body' }));

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
});
