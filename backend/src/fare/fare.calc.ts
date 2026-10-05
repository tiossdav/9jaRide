import { Kobo, percentOf, roundToStep } from '../common/money';

export interface Rates {
  baseKobo: Kobo;
  perKmKobo: Kobo;
  perMinuteKobo: Kobo;
  waitingPerMinuteKobo: Kobo;
  freeWaitingSeconds: number;
  taxKobo: Kobo;
  roundingStepKobo: Kobo;
  estimateLowBps: number;
  estimateHighBps: number;
}

/** Measured trip facts. Metres and seconds as integers: a float distance is a bug, not an input. */
export interface Measured {
  distanceM: number;
  durationS: number;
  waitingS: number;
}

export type LineKind = 'service' | 'distance' | 'time' | 'waiting' | 'tax' | 'rounding';
export interface FareLine {
  kind: LineKind;
  label: string;
  amountKobo: Kobo;
}

export interface Fare {
  lines: FareLine[];
  subtotalKobo: Kobo; // sum of the lines before rounding
  roundingKobo: Kobo; // its own receipt line, only present when non-zero
  taxKobo: Kobo;
  totalKobo: Kobo; // always equals the sum of `lines`
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Price a trip. Pure and deterministic: the same rates and measurements always give the same lines,
 * so a fare can be recomputed and audited later.
 *
 * Receipt shape (spec): service charge, distance fee, time fee, waiting fee, tax; then rounding to the
 * configured step as a visible line, so the breakdown always adds up to the total charged.
 */
export function computeFare(rates: Rates, measured: Measured): Fare {
  assertNonNegativeInt(measured.distanceM, 'distanceM');
  assertNonNegativeInt(measured.durationS, 'durationS');
  assertNonNegativeInt(measured.waitingS, 'waitingS');

  const distanceFee = Math.round((rates.perKmKobo * measured.distanceM) / 1000);
  const timeFee = Math.round((rates.perMinuteKobo * measured.durationS) / 60);
  const chargeableWaitS = Math.max(0, measured.waitingS - rates.freeWaitingSeconds);
  const waitingFee = Math.round((rates.waitingPerMinuteKobo * chargeableWaitS) / 60);

  const lines: FareLine[] = [
    { kind: 'service', label: 'Booking Fee', amountKobo: rates.baseKobo },
    { kind: 'distance', label: 'Distance fee', amountKobo: distanceFee },
    { kind: 'time', label: 'Time fee', amountKobo: timeFee },
    { kind: 'waiting', label: 'Waiting fee', amountKobo: waitingFee },
    { kind: 'tax', label: 'Daily tax fee', amountKobo: rates.taxKobo },
  ];

  const subtotalKobo = lines.reduce((sum, l) => sum + l.amountKobo, 0);
  const totalKobo = roundToStep(subtotalKobo, rates.roundingStepKobo);
  const roundingKobo = totalKobo - subtotalKobo;
  if (roundingKobo !== 0) lines.push({ kind: 'rounding', label: 'Rounding', amountKobo: roundingKobo });

  return { lines, subtotalKobo, roundingKobo, taxKobo: rates.taxKobo, totalKobo };
}

export interface Estimate {
  expectedKobo: Kobo;
  lowKobo: Kobo;
  highKobo: Kobo;
}

/** Fare range shown before the ride. No waiting is assumed; the band covers traffic and route drift. */
export function estimateFare(rates: Rates, trip: { distanceM: number; durationS: number }): Estimate {
  const expectedKobo = computeFare(rates, { ...trip, waitingS: 0 }).totalKobo;
  const step = rates.roundingStepKobo;
  return {
    expectedKobo,
    lowKobo: Math.min(expectedKobo, roundToStep(percentOf(expectedKobo, rates.estimateLowBps), step)),
    highKobo: Math.max(expectedKobo, roundToStep(percentOf(expectedKobo, rates.estimateHighBps), step)),
  };
}
