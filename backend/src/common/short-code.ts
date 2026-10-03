import { randomBytes } from 'crypto';

/** Public, unguessable ride code, not derived from a timestamp (spec defect: trip IDs that look like timestamps). */
export function shortCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  return Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}
