import { Logger } from '@nestjs/common';
import { OtpSender, otpTestMode } from './auth.types';

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TermiiConfig {
  apiKey: string;
  /** Your account's own address, shown on the Termii dashboard (for example https://v3.api.termii.com). */
  baseUrl: string;
  /** The sender name the phone shows. It must be approved on your Termii account. */
  senderId: string;
  /** "generic" works for every network; "dnd" reaches numbers that block promotions but costs more. */
  channel: string;
  timeoutMs: number;
}

/** Reads the settings from the environment. Returns null when the key is missing. */
export function termiiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TermiiConfig | null {
  const apiKey = env.TERMII_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.TERMII_BASE_URL?.trim() || 'https://api.ng.termii.com').replace(/\/+$/, ''),
    senderId: env.TERMII_SENDER_ID?.trim() || 'N-Alert',
    channel: env.TERMII_CHANNEL?.trim() || 'generic',
    timeoutMs: Number(env.TERMII_TIMEOUT_MS ?? 8000),
  };
}

/** Why Termii did not send, in terms the operator can act on. The person is only ever told "could not send the code". */
export type TermiiFailure = 'bad_key' | 'sender_not_approved' | 'no_balance' | 'invalid_number' | 'rate_limited' | 'unavailable' | 'refused';

export class TermiiError extends Error {
  constructor(readonly failure: TermiiFailure, message: string) {
    super(message);
  }
}

/** Reads Termii's refusal. Only the status and Termii's own words are kept: never the key or the code. */
export function classifyTermii(status: number, text: string): TermiiError {
  const said = text.slice(0, 200).replace(/\s+/g, ' ');
  const t = said.toLowerCase();
  const failure: TermiiFailure =
    status === 429 ? 'rate_limited'
    : status >= 500 ? 'unavailable'
    : status === 401 || status === 403 || t.includes('api key') || t.includes('unauthor') ? 'bad_key'
    : t.includes('sender') ? 'sender_not_approved'
    : t.includes('balance') || t.includes('insufficient') ? 'no_balance'
    : t.includes('phone') || t.includes('number') || t.includes('invalid recipient') ? 'invalid_number'
    : 'refused';
  return new TermiiError(failure, `Termii answered ${status} (${failure}): ${said}`);
}

/**
 * Sends one-time codes through Termii. The code itself is never logged; failures log only the status and Termii's reply.
 * A text goes out as an SMS; a voice request makes Termii phone the number and read the code out.
 * A network failure or a 5xx is tried once more (the same code, so a duplicate text is harmless); a refusal is not retried.
 */
export class TermiiOtpSender implements OtpSender {
  private readonly log = new Logger('TermiiOtpSender');

  constructor(private readonly config: TermiiConfig, private readonly http: Fetch = fetch as unknown as Fetch) {}

  async send(phone: string, code: string, channel: 'sms' | 'voice'): Promise<void> {
    if (otpTestMode()) return; // fixed test code: nothing to send
    const to = phone.replace(/^\+/, ''); // Termii wants 234803..., no plus sign
    const { path, body } = channel === 'voice'
      ? { path: '/api/sms/send/voice', body: { api_key: this.config.apiKey, phone_number: to, code: Number(code) } }
      : {
          path: '/api/sms/send',
          body: {
            api_key: this.config.apiKey, to, from: this.config.senderId, channel: this.config.channel, type: 'plain',
            sms: `Your 9jaRide Pro code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
          },
        };
    let last: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const id = await this.once(path, body);
        this.log.debug(`${channel} code accepted for ${phone.slice(0, 7)}*** (message ${id ?? 'unknown'})`);
        return;
      } catch (e) {
        last = e;
        if (e instanceof TermiiError && e.failure !== 'unavailable') break; // a clear refusal will not change on a second try
      }
    }
    if (last instanceof TermiiError) this.log.error(`${channel} code not sent: ${last.message}`);
    throw last;
  }

  /** One call to Termii. Termii can answer 200 with an error in the body, so the body is read too. Returns Termii's message id. */
  private async once(path: string, body: unknown): Promise<string | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.timeoutMs);
    try {
      const res = await this.http(this.config.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
      const text = await res.text();
      if (!res.ok) throw classifyTermii(res.status, text);
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* an empty or non-JSON 200 is taken as sent */ }
      if (json && json.code !== undefined && String(json.code).toLowerCase() !== 'ok') throw classifyTermii(400, text);
      return json?.message_id ?? json?.pinId ?? null;
    } catch (e) {
      if (e instanceof TermiiError) throw e;
      throw new TermiiError('unavailable', `Termii could not be reached: ${e instanceof Error ? e.name : 'error'}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
