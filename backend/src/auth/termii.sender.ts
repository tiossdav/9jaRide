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

/**
 * Sends one-time codes through Termii. The code itself is never logged; failures log only the status and Termii's reply.
 * A text goes out as an SMS; a voice request makes Termii phone the number and read the code out.
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
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.timeoutMs);
    try {
      const res = await this.http(this.config.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`Termii answered ${res.status}: ${text.slice(0, 300)}`);
      this.log.debug(`${channel} code accepted for ${phone.slice(0, 7)}***`);
    } finally {
      clearTimeout(timer);
    }
  }
}
