import { BadRequestException } from '@nestjs/common';

export interface RevenueRules {
  /** The platform's share of a fare, in basis points (1200 = 12%). */
  commissionBps: number;
  /** 'excluded': commission is worked out on the fare without the flat tax line. 'included': on the whole fare. */
  taxBase: 'excluded' | 'included';
  /** How the commission is shared between parties. Basis points of the commission; must add up to 10000. */
  shares: { name: string; bps: number }[];
}

export interface CancellationTier { fromPct: number; toPct: number; penaltyMinutes: number }
export interface CancellationRules {
  /** Off by default: a driver is never ranked lower for cancelling until an admin turns this on. */
  enabled: boolean;
  windowDays: number;
  /** Below this many accepted trips in the window a driver is never penalised. */
  minRequests: number;
  tiers: CancellationTier[];
}

export type SettingKey = 'revenue' | 'cancellation';
export interface SettingValues { revenue: RevenueRules; cancellation: CancellationRules }

export const DEFAULTS: SettingValues = {
  revenue: { commissionBps: 1200, taxBase: 'excluded', shares: [{ name: 'Platform', bps: 10000 }] },
  cancellation: {
    enabled: false, windowDays: 7, minRequests: 10,
    tiers: [{ fromPct: 20, toPct: 34, penaltyMinutes: 2 }, { fromPct: 35, toPct: 49, penaltyMinutes: 5 }, { fromPct: 50, toPct: 100, penaltyMinutes: 10 }],
  },
};

const bad = (m: string) => new BadRequestException(m);
const int = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return v;
};

/** Checks a proposed value and returns it cleaned. Anything wrong is refused with a sentence the admin can act on. */
export function validate<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] {
  if (typeof raw !== 'object' || raw === null) throw bad('the value must be an object');
  const v = raw as Record<string, any>;
  if (key === 'revenue') {
    const commissionBps = int(v.commissionBps, 'commission', 0, 5000); // never more than 50%
    if (v.taxBase !== 'excluded' && v.taxBase !== 'included') throw bad('choose whether commission is worked out with or without the tax');
    if (!Array.isArray(v.shares) || v.shares.length < 1 || v.shares.length > 10) throw bad('list one to ten parties that share the commission');
    const names = new Set<string>();
    const shares = v.shares.map((s: any) => {
      const name = String(s?.name ?? '').trim();
      if (name.length < 2 || name.length > 60) throw bad('each party needs a name of 2 to 60 letters');
      if (names.has(name.toLowerCase())) throw bad(`"${name}" is listed twice`);
      names.add(name.toLowerCase());
      return { name, bps: int(s.bps, `${name}'s share`, 0, 10_000) };
    });
    const total = shares.reduce((n: number, s: { bps: number }) => n + s.bps, 0);
    if (total !== 10_000) throw bad(`the shares must add up to 100% (they add up to ${total / 100}%)`);
    return { commissionBps, taxBase: v.taxBase, shares } as SettingValues[K];
  }
  if (key === 'cancellation') {
    if (typeof v.enabled !== 'boolean') throw bad('say whether the policy is on or off');
    const windowDays = int(v.windowDays, 'window', 1, 90);
    const minRequests = int(v.minRequests, 'minimum trips', 1, 1000);
    if (!Array.isArray(v.tiers) || v.tiers.length > 10) throw bad('use at most ten tiers');
    const tiers = v.tiers
      .map((t: any, i: number) => ({
        fromPct: int(t?.fromPct, `tier ${i + 1} start`, 0, 100),
        toPct: int(t?.toPct, `tier ${i + 1} end`, 0, 100),
        penaltyMinutes: int(t?.penaltyMinutes, `tier ${i + 1} penalty`, 0, 120),
      }))
      .sort((a: CancellationTier, b: CancellationTier) => a.fromPct - b.fromPct);
    tiers.forEach((t: CancellationTier, i: number) => {
      if (t.toPct < t.fromPct) throw bad(`tier ${i + 1} ends before it starts`);
      if (i > 0 && t.fromPct <= tiers[i - 1].toPct) throw bad(`tier ${i} and tier ${i + 1} overlap`);
    });
    return { enabled: v.enabled, windowDays, minRequests, tiers } as SettingValues[K];
  }
  throw bad('unknown setting');
}

/** The ranking penalty, in minutes, for a driver who cancelled `rate` percent of the trips they accepted. */
export function penaltyFor(rules: CancellationRules, acceptedTrips: number, cancelledTrips: number): number {
  if (!rules.enabled || acceptedTrips < rules.minRequests || acceptedTrips === 0) return 0;
  const pct = Math.floor((cancelledTrips * 100) / acceptedTrips);
  return rules.tiers.find((t) => pct >= t.fromPct && pct <= t.toPct)?.penaltyMinutes ?? 0;
}
