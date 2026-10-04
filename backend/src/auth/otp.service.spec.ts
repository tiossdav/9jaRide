import { OtpService } from './otp.service';

describe('OTP test mode', () => {
  const KEYS = ['OTP_MODE', 'NODE_ENV', 'OTP_ALLOW_TEST_IN_PRODUCTION'];
  const keep = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const k of KEYS) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } });
  const make = () => new OtpService({} as never, { send: async () => undefined });

  it('is on unless OTP_MODE=live', () => {
    delete process.env.OTP_MODE;
    expect(() => make()).not.toThrow();
  });

  it('refuses to start in production with the fixed code, unless someone chose that on purpose', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_MODE;
    expect(() => make()).toThrow(/OTP_MODE/);
    process.env.OTP_ALLOW_TEST_IN_PRODUCTION = 'true';
    expect(() => make()).not.toThrow();
  });

  it('starts in production once live', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTP_MODE = 'live';
    expect(() => make()).not.toThrow();
  });
});
