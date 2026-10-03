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

/** Wallet trip: rider wallet -> driver wallet (fare minus commission) and platform commission. */
export function planWalletTrip(riderId: string, driverId: string, fare: Kobo, bps = COMMISSION_BPS): Posting[] {
  assertKobo(fare, 'fare');
  const commission = percentOf(fare, bps);
  const driverShare = fare - commission;
  const postings: Posting[] = [{ account: walletCode(riderId), amountKobo: -fare }];
  if (driverShare > 0) postings.push({ account: walletCode(driverId), amountKobo: driverShare });
  if (commission > 0) postings.push({ account: 'platform:commission', amountKobo: commission });
  return postings;
}

/**
 * Cash trip: the driver already holds the cash, so only the commission moves.
 * It is a debt the driver owes, so it can push their wallet negative (spec: "Cash earnings and payouts").
 */
export function planCashTrip(driverId: string, fare: Kobo, bps = COMMISSION_BPS): Posting[] {
  assertKobo(fare, 'fare');
  const commission = percentOf(fare, bps);
  return [
    { account: walletCode(driverId), amountKobo: -commission },
    { account: 'platform:commission', amountKobo: commission },
  ];
}

/** Daily trip bonus: platform bonus account -> driver wallet. */
export function planBonus(driverId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'bonus');
  return [
    { account: 'platform:bonus', amountKobo: -amount },
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
