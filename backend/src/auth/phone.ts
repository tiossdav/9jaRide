/** Normalise a Nigerian mobile number to +234XXXXXXXXXX, or return null. Accepts 0803..., 234803..., +234803.... */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  const m = /^(?:\+?234|0)([789]\d{9})$/.exec(digits);
  return m ? `+234${m[1]}` : null;
}
