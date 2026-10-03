import { Kobo, assertKobo, percentOf } from '../common/money';

export interface Posting {
  account: string; // ledger_accounts.code
  amountKobo: Kobo; // signed: credit positive, debit negative
}

export const COMMISSION_BPS = 1200; // 12%, kept as versioned data in Revenue Setup later (spec decision default)

export const walletCode = (userId: string) => `wallet:${userId}`;

/** Wallet top-up after a verified provider webhook: platform cash -> wallet. */
export function planTopUp(userId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'top-up');
  return [
    { account: 'platform:cash', amountKobo: -amount },
    { account: walletCode(userId), amountKobo: amount },
  ];
}

/**
 * Split a fare. The flat daily tax is remitted to its own account and is not commissionable;
 * commission is taken on the rest (rounding line included). Assumption, pending the accountant (spec decision).
 */
function splitFare(fare: Kobo, tax: Kobo, bps: number): { commission: Kobo; driverShare: Kobo } {
  if (!Number.isSafeInteger(tax) || tax < 0 || tax > fare) throw new RangeError(`tax must be between 0 and the fare, got ${tax}`);
  const commission = percentOf(fare - tax, bps);
  return { commission, driverShare: fare - tax - commission };
}

/** Wallet trip: rider wallet -> driver wallet (fare minus tax minus commission), platform commission and tax. */
export function planWalletTrip(riderId: string, driverId: string, fare: Kobo, tax: Kobo = 0, bps = COMMISSION_BPS): Posting[] {
  assertKobo(fare, 'fare');
  const { commission, driverShare } = splitFare(fare, tax, bps);
  const postings: Posting[] = [{ account: walletCode(riderId), amountKobo: -fare }];
  if (driverShare > 0) postings.push({ account: walletCode(driverId), amountKobo: driverShare });
  if (commission > 0) postings.push({ account: 'platform:commission', amountKobo: commission });
  if (tax > 0) postings.push({ account: 'platform:tax', amountKobo: tax });
  return postings;
}

/**
 * Cash trip: the driver already holds the cash, so only what they owe moves: the commission and the tax
 * they collected on the platform's behalf. It is a debt, so it can push their wallet negative
 * (spec: "Cash earnings and payouts").
 */
export function planCashTrip(driverId: string, fare: Kobo, tax: Kobo = 0, bps = COMMISSION_BPS): Posting[] {
  assertKobo(fare, 'fare');
  const { commission } = splitFare(fare, tax, bps);
  const owed = commission + tax;
  const postings: Posting[] = [{ account: walletCode(driverId), amountKobo: -owed }];
  if (commission > 0) postings.push({ account: 'platform:commission', amountKobo: commission });
  if (tax > 0) postings.push({ account: 'platform:tax', amountKobo: tax });
  return postings;
}

/** Daily trip bonus: platform bonus account -> driver wallet. */
export function planBonus(driverId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'bonus');
  return [
    { account: 'platform:bonus', amountKobo: -amount },
    { account: walletCode(driverId), amountKobo: amount },
  ];
}

/** Payout requested: the money leaves the driver wallet at once, so it cannot be withdrawn twice. */
export function planPayoutRequest(driverId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'payout');
  return [
    { account: walletCode(driverId), amountKobo: -amount },
    { account: 'platform:payout', amountKobo: amount },
  ];
}

/** Provider confirmed the transfer: the money has left our bank (platform:cash runs negative while it holds real money). */
export function planPayoutPaid(amount: Kobo): Posting[] {
  assertKobo(amount, 'payout');
  return [
    { account: 'platform:payout', amountKobo: -amount },
    { account: 'platform:cash', amountKobo: amount },
  ];
}

/** Payout rejected or failed: give the money back to the driver wallet. */
export function planPayoutReversal(driverId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'payout');
  return [
    { account: 'platform:payout', amountKobo: -amount },
    { account: walletCode(driverId), amountKobo: amount },
  ];
}

export function assertBalanced(postings: Posting[]): void {
  const total = postings.reduce((sum, p) => sum + p.amountKobo, 0);
  if (total !== 0) throw new Error(`unbalanced postings: off by ${total} kobo`);
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amountKobo) || p.amountKobo === 0) {
      throw new RangeError(`posting for ${p.account} must be a non-zero integer, got ${p.amountKobo}`);
    }
  }
}
