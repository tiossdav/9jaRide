/** What a NIN check can come back with. "pending" means the provider has not answered yet; it is asked again later. */
export interface NinResult {
  status: 'verified' | 'failed' | 'pending';
  /** Plain words for the driver or staff when it did not pass. */
  reason?: string;
  /** The provider's own reference, kept for disputes. */
  reference?: string;
}

/** One way of checking a National Identification Number. A real provider (Prembly, Smile ID, YouVerify...) is one more class with this one method. */
export interface NinVerifier {
  readonly name: string;
  verify(input: { nin: string; fullName: string; dateOfBirth?: string | null }): Promise<NinResult>;
}
export const NIN_VERIFIER = Symbol('NIN_VERIFIER');

/**
 * Stands in until a provider is connected (NIN_PROVIDER unset or "stub"). It accepts any 11-digit number, with three
 * numbers reserved for trying the other outcomes: ending 999 fails, ending 000 stays pending the first time and passes
 * on the next check.
 */
export class StubNinVerifier implements NinVerifier {
  readonly name = 'stub';
  private readonly asked = new Set<string>();
  async verify({ nin }: { nin: string }): Promise<NinResult> {
    if (!/^\d{11}$/.test(nin)) return { status: 'failed', reason: 'A NIN has 11 digits.' };
    if (nin.endsWith('999')) return { status: 'failed', reason: 'We could not find that NIN. Check the number and try again.', reference: `stub-${nin}` };
    if (nin.endsWith('000') && !this.asked.has(nin)) { this.asked.add(nin); return { status: 'pending', reference: `stub-${nin}` }; }
    return { status: 'verified', reference: `stub-${nin}` };
  }
}

export function ninVerifierFromEnv(): NinVerifier {
  const which = process.env.NIN_PROVIDER ?? 'stub';
  if (which === 'stub') return new StubNinVerifier();
  throw new Error(`NIN_PROVIDER "${which}" is not available. Add its class in backend/src/nin and register it in ninVerifierFromEnv().`);
}
