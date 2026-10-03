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
