import { planCashTrip, planWalletTrip } from '../ledger/postings';
import { DEFAULTS, insideServiceArea, penaltyFor, validate } from './settings.types';

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

describe('operating area', () => {
  const nigeria = DEFAULTS.service_area;
  const lagosOnly = validate('service_area', { enabled: true, areas: [{ name: 'Lagos', lat: 6.5244, lng: 3.3792, radiusKm: 45 }] });
  it('covers every part of Nigeria by default, and nowhere abroad', () => {
    for (const [lat, lng] of [[6.5244, 3.3792], [7.3775, 3.947], [9.0765, 7.3986], [4.8156, 7.0498], [12.0022, 8.592], [11.8333, 13.15], [6.4541, 3.3947]]) {
      expect(insideServiceArea(nigeria, lat, lng)).toBe(true); // Lagos, Ibadan, Abuja, Port Harcourt, Kano, Maiduguri, Victoria Island
    }
    expect(insideServiceArea(nigeria, 5.6037, -0.187)).toBe(false); // Accra
    expect(insideServiceArea(nigeria, 48.85, 2.35)).toBe(false);    // Paris
  });
  it('can still be narrowed by an admin, for example to Lagos, and widened again', () => {
    expect(insideServiceArea(lagosOnly, 6.6018, 3.3515)).toBe(true);
    expect(insideServiceArea(lagosOnly, 7.3775, 3.947)).toBe(false);
    const more = validate('service_area', { enabled: true, areas: [...lagosOnly.areas, { name: 'Ibadan', lat: 7.3775, lng: 3.947, radiusKm: 30 }] });
    expect(insideServiceArea(more, 7.4478, 3.9552)).toBe(true);
    expect(insideServiceArea({ enabled: false, areas: [] }, 9.07, 7.4)).toBe(true);
  });
  it('refuses nonsense', () => {
    expect(() => validate('service_area', { enabled: true, areas: [] })).toThrow();
    expect(() => validate('service_area', { enabled: true, areas: [{ name: 'X', lat: 51, lng: 3, radiusKm: 10 }] })).toThrow();
    expect(() => validate('service_area', { enabled: true, areas: [{ name: 'Lagos', lat: 6.5, lng: 3.4, radiusKm: 0 }] })).toThrow();
  });
});
