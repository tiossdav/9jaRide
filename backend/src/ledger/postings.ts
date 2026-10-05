import { Kobo, assertKobo, percentOf } from '../common/money';

/** What the owner of a vehicle is paid out of a driver's share of one trip. */
export interface OwnerDeduction { account: string; amountKobo: Kobo }

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
export function splitFare(fare: Kobo, tax: Kobo, bps: number, taxCommissionable = false): { commission: Kobo; driverShare: Kobo } {
  if (!Number.isSafeInteger(tax) || tax < 0 || tax > fare) throw new RangeError(`tax must be between 0 and the fare, got ${tax}`);
  // taxCommissionable: the commission is worked out on the whole fare, tax line included (an admin setting).
  const commission = percentOf(taxCommissionable ? fare : fare - tax, bps);
  if (commission + tax > fare) throw new RangeError(`commission ${commission} and tax ${tax} are more than the fare ${fare}`);
  return { commission, driverShare: fare - tax - commission };
}

function assertDiscount(discount: Kobo, fare: Kobo) {
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > fare) throw new RangeError(`discount must be between 0 and the fare, got ${discount}`);
}

/** Wallet trip: rider wallet -> driver wallet (fare minus tax minus commission), platform commission and tax. */
export function planWalletTrip(riderId: string, driverId: string, fare: Kobo, tax: Kobo = 0, bps = COMMISSION_BPS, taxCommissionable = false, discount: Kobo = 0, deduction?: OwnerDeduction): Posting[] {
  assertKobo(fare, 'fare');
  assertDiscount(discount, fare);
  const { commission, driverShare } = splitFare(fare, tax, bps, taxCommissionable);
  const owed = deduction?.amountKobo ?? 0;
  if (owed < 0 || owed > driverShare) throw new RangeError(`the vehicle deduction ${owed} is more than the driver's share ${driverShare}`);
  // A promo code lowers what the rider pays; the platform makes up the difference, so the driver's share is untouched.
  const postings: Posting[] = [];
  if (fare - discount > 0) postings.push({ account: walletCode(riderId), amountKobo: -(fare - discount) });
  if (discount > 0) postings.push({ account: 'platform:promo', amountKobo: -discount });
  if (driverShare - owed > 0) postings.push({ account: walletCode(driverId), amountKobo: driverShare - owed });
  if (owed > 0 && deduction) postings.push({ account: deduction.account, amountKobo: owed }); // the owner's part of what the driver earned
  if (commission > 0) postings.push({ account: 'platform:commission', amountKobo: commission });
  if (tax > 0) postings.push({ account: 'platform:tax', amountKobo: tax });
  return postings;
}

/**
 * Cash trip: the driver already holds the cash, so only what they owe moves: the commission and the tax
 * they collected on the platform's behalf. It is a debt, so it can push their wallet negative
 * (spec: "Cash earnings and payouts").
 */
export function planCashTrip(driverId: string, fare: Kobo, tax: Kobo = 0, bps = COMMISSION_BPS, taxCommissionable = false, discount: Kobo = 0, deduction?: OwnerDeduction): Posting[] {
  assertKobo(fare, 'fare');
  assertDiscount(discount, fare);
  const { commission, driverShare } = splitFare(fare, tax, bps, taxCommissionable);
  const toOwner = deduction?.amountKobo ?? 0;
  if (toOwner < 0 || toOwner > driverShare) throw new RangeError(`the vehicle deduction ${toOwner} is more than the driver's share ${driverShare}`);
  // The rider paid the driver less cash because of the promo; the platform pays the driver the difference.
  // The driver also holds the owner's part of the cash, so that comes off their wallet too and goes to the owner.
  const owed = commission + tax - discount + toOwner;
  const postings: Posting[] = [];
  if (owed !== 0) postings.push({ account: walletCode(driverId), amountKobo: -owed });
  if (toOwner > 0 && deduction) postings.push({ account: deduction.account, amountKobo: toOwner });
  if (discount > 0) postings.push({ account: 'platform:promo', amountKobo: -discount });
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

/** Manual credit (refund, goodwill): the platform pays the user. platform:adjustments is the expense side. */
export function planAdjustmentCredit(userId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'adjustment');
  return [
    { account: 'platform:adjustments', amountKobo: -amount },
    { account: walletCode(userId), amountKobo: amount },
  ];
}

/** Manual debit: money moves from the user's wallet to the platform. */
export function planAdjustmentDebit(userId: string, amount: Kobo): Posting[] {
  assertKobo(amount, 'adjustment');
  return [
    { account: walletCode(userId), amountKobo: -amount },
    { account: 'platform:adjustments', amountKobo: amount },
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
