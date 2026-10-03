import { planCashTrip, planWalletTrip } from '../ledger/postings';
import { DEFAULTS, penaltyFor, validate } from './settings.types';

// Unit tests: the rules an admin can edit are checked before they are saved, and mean what they say when applied.
describe('revenue rules', () => {
  const ok = { commissionBps: 1500, taxBase: 'included', shares: [{ name: 'Platform', bps: 7000 }, { name: 'Tech partner', bps: 3000 }] };

  it('accepts a sensible change', () => expect(validate('revenue', ok)).toEqual(ok));
  it('refuses shares that do not add up to a whole', () => expect(() => validate('revenue', { ...ok, shares: [{ name: 'Alpha', bps: 5000 }, { name: 'Bravo', bps: 4000 }] })).toThrow(/add up to 100%.*90%/));
  it('refuses a commission over half of the fare', () => expect(() => validate('revenue', { ...ok, commissionBps: 5001 })).toThrow(/commission/));
  it('refuses a negative or fractional commission', () => {
    expect(() => validate('revenue', { ...ok, commissionBps: -1 })).toThrow();
    expect(() => validate('revenue', { ...ok, commissionBps: 12.5 })).toThrow();
  });
  it('wants an explicit choice about the tax', () => expect(() => validate('revenue', { ...ok, taxBase: 'maybe' })).toThrow(/with or without the tax/));
  it('refuses the same party twice, and blank names', () => {
    expect(() => validate('revenue', { ...ok, shares: [{ name: 'Platform', bps: 5000 }, { name: ' platform ', bps: 5000 }] })).toThrow(/twice/);
    expect(() => validate('revenue', { ...ok, shares: [{ name: ' ', bps: 10000 }] })).toThrow(/name/);
  });
  it('refuses nonsense', () => expect(() => validate('revenue', 'oops')).toThrow());
});

describe('cancellation rules', () => {
  const rules = { enabled: true, windowDays: 7, minRequests: 10, tiers: [{ fromPct: 20, toPct: 34, penaltyMinutes: 2 }, { fromPct: 35, toPct: 49, penaltyMinutes: 5 }, { fromPct: 50, toPct: 100, penaltyMinutes: 10 }] };

  it('accepts the starting policy', () => expect(validate('cancellation', rules)).toEqual(rules));
  it('refuses overlapping tiers', () => expect(() => validate('cancellation', { ...rules, tiers: [{ fromPct: 10, toPct: 40, penaltyMinutes: 2 }, { fromPct: 30, toPct: 60, penaltyMinutes: 5 }] })).toThrow(/overlap/));
  it('refuses a tier that ends before it starts', () => expect(() => validate('cancellation', { ...rules, tiers: [{ fromPct: 40, toPct: 30, penaltyMinutes: 2 }] })).toThrow(/ends before/));
  it('sorts tiers so the order typed does not matter', () => {
    const v = validate('cancellation', { ...rules, tiers: [...rules.tiers].reverse() });
    expect(v.tiers.map((t) => t.fromPct)).toEqual([20, 35, 50]);
  });
  it('refuses a policy that is neither on nor off', () => expect(() => validate('cancellation', { ...rules, enabled: 'yes' })).toThrow());

  describe('the penalty a driver gets', () => {
    it('is nothing while the policy is off', () => expect(penaltyFor({ ...rules, enabled: false }, 20, 15)).toBe(0));
    it('is nothing for a driver with too few trips to judge', () => expect(penaltyFor(rules, 9, 9)).toBe(0));
    it('is nothing below the first tier', () => expect(penaltyFor(rules, 20, 3)).toBe(0)); // 15%
    it('steps up through the tiers', () => {
      expect(penaltyFor(rules, 20, 4)).toBe(2); // 20%
      expect(penaltyFor(rules, 20, 7)).toBe(5); // 35%
      expect(penaltyFor(rules, 20, 10)).toBe(10); // 50%
      expect(penaltyFor(rules, 20, 20)).toBe(10); // 100%
    });
    it('does not divide by zero', () => expect(penaltyFor({ ...rules, minRequests: 1 }, 0, 0)).toBe(0));
  });
});

describe('commission with or without the tax line', () => {
  const sum = (ps: { amountKobo: number }[]) => ps.reduce((n, p) => n + p.amountKobo, 0);
  const find = (ps: { account: string; amountKobo: number }[], a: string) => ps.find((p) => p.account === a)?.amountKobo ?? 0;

  it('keeps the long-standing behaviour by default: 12% of the fare without the tax', () => {
    expect(find(planWalletTrip('r', 'd', 226_000, 3_000), 'platform:commission')).toBe(26_760);
  });
  it('can take the commission on the whole fare, tax included', () => {
    const p = planWalletTrip('r', 'd', 226_000, 3_000, 1200, true);
    expect(find(p, 'platform:commission')).toBe(27_120);
    expect(find(p, 'wallet:d')).toBe(226_000 - 3_000 - 27_120);
    expect(sum(p)).toBe(0); // always balances
  });
  it('uses the commission rate it is given', () => {
    expect(find(planWalletTrip('r', 'd', 100_000, 0, 2000), 'platform:commission')).toBe(20_000);
    expect(planWalletTrip('r', 'd', 100_000, 0, 0).some((p) => p.account === 'platform:commission')).toBe(false);
  });
  it('owes the platform the commission on a cash trip', () => {
    expect(find(planCashTrip('d', 226_000, 3_000, 1200, true), 'wallet:d')).toBe(-(27_120 + 3_000));
  });
  it('refuses a split that would pay out more than the fare', () => {
    expect(() => planWalletTrip('r', 'd', 10_000, 3_000, 5000, true)).not.toThrow();
    expect(() => planWalletTrip('r', 'd', 10_000, 9_000, 5000, true)).toThrow(RangeError);
  });
});

describe('defaults', () => {
  it('match the rules the system followed before they became editable', () => {
    expect(DEFAULTS.revenue).toMatchObject({ commissionBps: 1200, taxBase: 'excluded' });
    expect(DEFAULTS.cancellation.enabled).toBe(false);
  });
});
