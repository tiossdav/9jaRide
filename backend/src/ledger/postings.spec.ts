import { nairaToKobo, percentOf, roundToNearestTenNaira } from '../common/money';
import { assertBalanced, planBonus, planCashTrip, planTopUp, planWalletTrip } from './postings';

const sum = (ps: { amountKobo: number }[]) => ps.reduce((s, p) => s + p.amountKobo, 0);

describe('money', () => {
  it('takes exactly 12% commission on the observed fare (₦486 on ₦4,050)', () => {
    expect(percentOf(nairaToKobo(4050), 1200)).toBe(nairaToKobo(486));
  });

  it('rounds to the nearest ₦10', () => {
    expect(roundToNearestTenNaira(nairaToKobo(2256.76))).toBe(nairaToKobo(2260));
    expect(roundToNearestTenNaira(nairaToKobo(2255))).toBe(nairaToKobo(2260));
    expect(roundToNearestTenNaira(nairaToKobo(2254.99))).toBe(nairaToKobo(2250));
  });

  it('never produces fractional kobo', () => {
    for (const fare of [1, 7, 333, 99_999, 405_001]) {
      expect(Number.isInteger(percentOf(fare, 1200))).toBe(true);
    }
  });
});

describe('ledger postings', () => {
  it('balances a wallet trip and splits fare minus commission to the driver', () => {
    const fare = nairaToKobo(4050);
    const postings = planWalletTrip('rider', 'driver', fare);
    expect(sum(postings)).toBe(0);
    expect(postings).toContainEqual({ account: 'wallet:rider', amountKobo: -fare });
    expect(postings).toContainEqual({ account: 'wallet:driver', amountKobo: nairaToKobo(3564) });
    expect(postings).toContainEqual({ account: 'platform:commission', amountKobo: nairaToKobo(486) });
  });

  it('balances a cash trip: only the commission moves, from the driver', () => {
    const postings = planCashTrip('driver', nairaToKobo(4050));
    expect(sum(postings)).toBe(0);
    expect(postings).toEqual([
      { account: 'wallet:driver', amountKobo: -nairaToKobo(486) },
      { account: 'platform:commission', amountKobo: nairaToKobo(486) },
    ]);
  });

  it('sends the flat tax to its own account and takes commission on the fare excluding tax (wallet trip)', () => {
    // ₦2,260 fare including ₦30 tax: commission is 12% of ₦2,230 = ₦267.60; driver gets ₦1,962.40
    const postings = planWalletTrip('rider', 'driver', nairaToKobo(2260), nairaToKobo(30));
    expect(sum(postings)).toBe(0);
    expect(postings).toContainEqual({ account: 'platform:tax', amountKobo: nairaToKobo(30) });
    expect(postings).toContainEqual({ account: 'platform:commission', amountKobo: nairaToKobo(267.6) });
    expect(postings).toContainEqual({ account: 'wallet:driver', amountKobo: nairaToKobo(1962.4) });
  });

  it('makes the cash-trip driver owe commission plus the tax they collected', () => {
    const postings = planCashTrip('driver', nairaToKobo(2260), nairaToKobo(30));
    expect(sum(postings)).toBe(0);
    expect(postings).toContainEqual({ account: 'wallet:driver', amountKobo: -nairaToKobo(297.6) });
    expect(postings).toContainEqual({ account: 'platform:tax', amountKobo: nairaToKobo(30) });
  });

  it('rejects a tax larger than the fare', () => {
    expect(() => planWalletTrip('r', 'd', 1000, 2000)).toThrow(/tax/);
  });

  it('balances top-ups and bonuses', () => {
    expect(sum(planTopUp('u', 500_000))).toBe(0);
    expect(sum(planBonus('d', 200_000))).toBe(0);
  });

  it('rejects non-integer, zero or negative amounts', () => {
    expect(() => planTopUp('u', 10.5)).toThrow();
    expect(() => planTopUp('u', 0)).toThrow();
    expect(() => planWalletTrip('r', 'd', -5)).toThrow();
  });

  it('assertBalanced rejects an unbalanced set', () => {
    expect(() => assertBalanced([{ account: 'a', amountKobo: -100 }, { account: 'b', amountKobo: 99 }])).toThrow(/unbalanced/);
  });
});
