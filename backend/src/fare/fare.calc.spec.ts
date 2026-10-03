import { Rates, computeFare, estimateFare } from './fare.calc';

// Comfort rates read off the admin Trip Fees screens: ₦1,000 base, ₦180/km, ₦120/min, ₦30 tax.
const comfort: Rates = {
  baseKobo: 100_000,
  perKmKobo: 18_000,
  perMinuteKobo: 12_000,
  waitingPerMinuteKobo: 0,
  freeWaitingSeconds: 0,
  taxKobo: 3_000,
  roundingStepKobo: 1_000,
  estimateLowBps: 8_500,
  estimateHighBps: 11_000,
};

const sumLines = (lines: { amountKobo: number }[]) => lines.reduce((s, l) => s + l.amountKobo, 0);

describe('computeFare', () => {
  it('reproduces the sample receipt: 0.65 km, 9m15s, rounded to the nearest ₦10 with a visible line', () => {
    const fare = computeFare(comfort, { distanceM: 650, durationS: 555, waitingS: 80 });
    const byKind = Object.fromEntries(fare.lines.map((l) => [l.kind, l.amountKobo]));
    expect(byKind).toEqual({
      service: 100_000,
      distance: 11_700, // ₦117
      time: 111_000, // ₦1,110
      waiting: 0,
      tax: 3_000,
      rounding: 300, // ₦2,257.00 -> ₦2,260
    });
    expect(fare.subtotalKobo).toBe(225_700);
    expect(fare.totalKobo).toBe(226_000);
  });

  it('always has lines that add up to the total, so the receipt can never disagree with the charge', () => {
    for (const [distanceM, durationS, waitingS] of [[0, 0, 0], [650, 555, 80], [12_345, 3_601, 421], [99_999, 7_200, 0]]) {
      const fare = computeFare(comfort, { distanceM, durationS, waitingS });
      expect(sumLines(fare.lines)).toBe(fare.totalKobo);
      expect(fare.totalKobo % comfort.roundingStepKobo).toBe(0);
    }
  });

  it('omits the rounding line when the subtotal is already on the step', () => {
    const fare = computeFare({ ...comfort, perMinuteKobo: 0, perKmKobo: 0 }, { distanceM: 5_000, durationS: 600, waitingS: 0 });
    expect(fare.roundingKobo).toBe(0);
    expect(fare.lines.some((l) => l.kind === 'rounding')).toBe(false);
  });

  it('rounds half up and can round down with a negative rounding line', () => {
    const down = computeFare({ ...comfort, taxKobo: 2_999 }, { distanceM: 0, durationS: 0, waitingS: 0 });
    expect(down.subtotalKobo).toBe(102_999);
    expect(down.totalKobo).toBe(103_000);
    const low = computeFare({ ...comfort, taxKobo: 2_400 }, { distanceM: 0, durationS: 0, waitingS: 0 });
    expect(low.totalKobo).toBe(102_000);
    expect(low.roundingKobo).toBe(-400);
  });

  it('charges waiting only beyond the free window', () => {
    const rates = { ...comfort, waitingPerMinuteKobo: 6_000, freeWaitingSeconds: 60 };
    const none = computeFare(rates, { distanceM: 0, durationS: 0, waitingS: 45 });
    const some = computeFare(rates, { distanceM: 0, durationS: 0, waitingS: 180 });
    expect(none.lines.find((l) => l.kind === 'waiting')!.amountKobo).toBe(0);
    expect(some.lines.find((l) => l.kind === 'waiting')!.amountKobo).toBe(12_000); // 120 s chargeable at ₦60/min
  });

  it('refuses float or negative measurements (the 0.65000000000000001 km class of bug)', () => {
    expect(() => computeFare(comfort, { distanceM: 650.5, durationS: 0, waitingS: 0 })).toThrow(/distanceM/);
    expect(() => computeFare(comfort, { distanceM: 0, durationS: -1, waitingS: 0 })).toThrow(/durationS/);
    expect(() => computeFare(comfort, { distanceM: 0, durationS: 0, waitingS: NaN })).toThrow(/waitingS/);
  });
});

describe('estimateFare', () => {
  it('returns an ordered range around the expected fare, all on the rounding step', () => {
    const e = estimateFare(comfort, { distanceM: 10_000, durationS: 1_500 });
    expect(e.lowKobo).toBeLessThanOrEqual(e.expectedKobo);
    expect(e.expectedKobo).toBeLessThanOrEqual(e.highKobo);
    for (const v of [e.lowKobo, e.expectedKobo, e.highKobo]) expect(v % 1_000).toBe(0);
  });

  it('expected equals the final fare for the same trip with no waiting', () => {
    const trip = { distanceM: 7_200, durationS: 1_260 };
    expect(estimateFare(comfort, trip).expectedKobo).toBe(computeFare(comfort, { ...trip, waitingS: 0 }).totalKobo);
  });
});
