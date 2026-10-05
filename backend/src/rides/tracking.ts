/**
 * Distance travelled, worked out from the driver's own sequence of GPS readings (never the straight line from start to now).
 * Each reading is checked against the last one that was kept, so a bad reading cannot add kilometres that were never driven.
 * All limits can be changed with environment variables.
 */
export interface TrackingConfig {
  /** A reading less precise than this is ignored. */
  maxAccuracyM: number;
  /** Less movement than this is GPS noise (or standing still) and adds nothing. */
  minMoveM: number;
  /** Faster than this between two readings is not a car: the reading is treated as a jump. */
  maxSpeedMps: number;
  /** After this many jumps in a row the new place is accepted as real (the old reading was the bad one) without adding the gap. */
  jumpsBeforeReset: number;
  /** How close to the pickup counts as arrived. */
  arriveRadiusM: number;
  /** How close to the destination counts as arrived. */
  destinationRadiusM: number;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function trackingConfig(env: NodeJS.ProcessEnv = process.env): TrackingConfig {
  return {
    maxAccuracyM: num(env.TRACK_MAX_ACCURACY_M, 50),
    minMoveM: num(env.TRACK_MIN_MOVE_M, 8),
    maxSpeedMps: num(env.TRACK_MAX_SPEED_KMH, 160) / 3.6,
    jumpsBeforeReset: num(env.TRACK_JUMPS_BEFORE_RESET, 3),
    arriveRadiusM: num(env.TRACK_ARRIVE_RADIUS_M, 60),
    destinationRadiusM: num(env.TRACK_DESTINATION_RADIUS_M, 80),
  };
}

export interface Fix { lat: number; lng: number; atMs: number; accuracyM?: number }

export interface Anchor { lat: number; lng: number; atMs: number }

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface StepResult {
  /** Metres to add to the trip. */
  addM: number;
  /** The last kept reading after this one. */
  anchor: Anchor | null;
  /** Consecutive jumps seen so far. */
  jumps: number;
  outcome: 'start' | 'added' | 'noise' | 'duplicate' | 'inaccurate' | 'jump' | 'reset';
}

export function validCoordinates(p: { lat: number; lng: number }): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

/** Takes one reading and says how far it moves the total. Pure: the caller keeps `anchor` and `jumps` between calls. */
export function step(anchor: Anchor | null, jumps: number, p: Fix, cfg: TrackingConfig): StepResult {
  if (!validCoordinates(p) || (p.accuracyM != null && p.accuracyM > cfg.maxAccuracyM)) return { addM: 0, anchor, jumps, outcome: 'inaccurate' };
  if (!anchor) return { addM: 0, anchor: { lat: p.lat, lng: p.lng, atMs: p.atMs }, jumps: 0, outcome: 'start' };
  const dtS = (p.atMs - anchor.atMs) / 1000;
  if (dtS <= 0) return { addM: 0, anchor, jumps, outcome: 'duplicate' };
  const d = haversineM(anchor, p);
  if (d / dtS > cfg.maxSpeedMps) {
    const n = jumps + 1;
    // the same "new" place several times running means the earlier reading was the wrong one: start again from here
    if (n >= cfg.jumpsBeforeReset) return { addM: 0, anchor: { lat: p.lat, lng: p.lng, atMs: p.atMs }, jumps: 0, outcome: 'reset' };
    return { addM: 0, anchor, jumps: n, outcome: 'jump' };
  }
  if (d < cfg.minMoveM) return { addM: 0, anchor, jumps: 0, outcome: 'noise' };
  return { addM: d, anchor: { lat: p.lat, lng: p.lng, atMs: p.atMs }, jumps: 0, outcome: 'added' };
}
