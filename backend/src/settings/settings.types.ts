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

/** One place drivers work: a circle on the map. */
export interface ServiceCircle { name: string; lat: number; lng: number; radiusKm: number }
export interface ServiceAreaRules {
  /** On: bookings can only start inside one of the areas, and only drivers inside one are available. Off: no limit. */
  enabled: boolean;
  areas: ServiceCircle[];
}

export type SettingKey = 'revenue' | 'cancellation' | 'service_area';
export interface SettingValues { revenue: RevenueRules; cancellation: CancellationRules; service_area: ServiceAreaRules }

/** Whether a point lies inside the operating area. Where a trip ends does not matter: only where it starts and where drivers are. */
export function insideServiceArea(rules: ServiceAreaRules, lat: number, lng: number): boolean {
  if (!rules.enabled) return true;
  const rad = (d: number) => (d * Math.PI) / 180;
  return rules.areas.some((a) => {
    const h = Math.sin(rad(lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - a.lng) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h)) <= a.radiusKm;
  });
}

export const DEFAULTS: SettingValues = {
  revenue: { commissionBps: 1200, taxBase: 'excluded', shares: [{ name: 'Platform', bps: 10000 }] },
  // Lagos to begin with; more places are added here as drivers start working there
  service_area: { enabled: true, areas: [{ name: 'Lagos', lat: 6.5244, lng: 3.3792, radiusKm: 45 }] },
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
  if (key === 'service_area') {
    if (typeof v.enabled !== 'boolean') throw bad('say whether the operating area is on or off');
    if (!Array.isArray(v.areas) || v.areas.length > 30) throw bad('list up to thirty areas');
    if (v.enabled && v.areas.length < 1) throw bad('add at least one area, or turn the limit off');
    const areas = v.areas.map((a: any, i: number) => {
      const name = String(a?.name ?? '').trim();
      if (name.length < 2 || name.length > 60) throw bad(`area ${i + 1} needs a name of 2 to 60 letters`);
      const lat = a?.lat, lng = a?.lng, radiusKm = a?.radiusKm;
      if (typeof lat !== 'number' || lat < 3 || lat > 15) throw bad(`${name}: the latitude must be a place in Nigeria`);
      if (typeof lng !== 'number' || lng < 2 || lng > 15) throw bad(`${name}: the longitude must be a place in Nigeria`);
      if (typeof radiusKm !== 'number' || radiusKm < 1 || radiusKm > 300) throw bad(`${name}: the radius must be from 1 to 300 km`);
      return { name, lat, lng, radiusKm };
    });
    return { enabled: v.enabled, areas } as SettingValues[K];
  }
  throw bad('unknown setting');
}

/** The ranking penalty, in minutes, for a driver who cancelled `rate` percent of the trips they accepted. */
export function penaltyFor(rules: CancellationRules, acceptedTrips: number, cancelledTrips: number): number {
  if (!rules.enabled || acceptedTrips < rules.minRequests || acceptedTrips === 0) return 0;
  const pct = Math.floor((cancelledTrips * 100) / acceptedTrips);
  return rules.tiers.find((t) => pct >= t.fromPct && pct <= t.toPct)?.penaltyMinutes ?? 0;
}
