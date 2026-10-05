import { Anchor, haversineM, step, trackingConfig } from './tracking';

const cfg = trackingConfig({});
const at = (s: number) => 1_700_000_000_000 + s * 1000;
/** A point `m` metres north of the origin. */
const north = (m: number) => ({ lat: 6.5 + m / 111_195, lng: 3.3 });

/** Runs a list of readings through the filter the way the server does and returns the total. */
function run(readings: { m: number; s: number; accuracyM?: number }[]) {
  let anchor: Anchor | null = null;
  let jumps = 0;
  let total = 0;
  const outcomes: string[] = [];
  for (const r of readings) {
    const res = step(anchor, jumps, { ...north(r.m), atMs: at(r.s), accuracyM: r.accuracyM }, cfg);
    anchor = res.anchor; jumps = res.jumps; total += res.addM; outcomes.push(res.outcome);
  }
  return { total, outcomes };
}

describe('distance from GPS readings', () => {
  it('measures great-circle distance', () => {
    expect(haversineM({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 })).toBe(0);
    expect(Math.round(haversineM({ lat: 6.5, lng: 3.3 }, { lat: 6.51, lng: 3.3 }))).toBe(1112);
  });

  it('adds up the legs of the route, not the straight line from start to now', () => {
    // out 800 m, then back 600 m: driven 1400 m, but only 200 m from the start
    const r = run([{ m: 0, s: 0 }, { m: 400, s: 30 }, { m: 800, s: 60 }, { m: 500, s: 90 }, { m: 200, s: 120 }]);
    expect(Math.round(r.total)).toBe(1400);
  });

  it('ignores duplicate and out-of-order readings and small wobble', () => {
    const r = run([{ m: 0, s: 0 }, { m: 0, s: 0 }, { m: 3, s: 10 }, { m: 200, s: 20 }, { m: 150, s: 10 }]);
    expect(r.outcomes).toEqual(['start', 'duplicate', 'noise', 'added', 'duplicate']);
    expect(Math.round(r.total)).toBe(200);
  });

  it('ignores a reading that is too inaccurate', () => {
    const r = run([{ m: 0, s: 0 }, { m: 500, s: 30, accuracyM: 400 }, { m: 300, s: 60 }]);
    expect(r.outcomes).toEqual(['start', 'inaccurate', 'added']);
    expect(Math.round(r.total)).toBe(300);
  });

  it('does not add hundreds of kilometres for a GPS jump, and recovers if the new place is real', () => {
    // 300 km away within 5 seconds
    const jump = run([{ m: 0, s: 0 }, { m: 100, s: 10 }, { m: 300_000, s: 15 }, { m: 200, s: 25 }]);
    expect(jump.outcomes).toEqual(['start', 'added', 'jump', 'added']);
    expect(Math.round(jump.total)).toBe(200);
    // the phone really is somewhere else now (three readings in a row): carry on from there, adding nothing for the gap
    const moved = run([{ m: 0, s: 0 }, { m: 300_000, s: 5 }, { m: 300_020, s: 10 }, { m: 300_040, s: 15 }, { m: 300_300, s: 45 }]);
    expect(moved.outcomes).toEqual(['start', 'jump', 'jump', 'reset', 'added']);
    expect(Math.round(moved.total)).toBe(260);
  });

  it('rejects invalid coordinates', () => {
    expect(step(null, 0, { lat: 0, lng: 0, atMs: 1 }, cfg).outcome).toBe('inaccurate');
    expect(step(null, 0, { lat: 95, lng: 3, atMs: 1 }, cfg).outcome).toBe('inaccurate');
    expect(step(null, 0, { lat: NaN, lng: 3, atMs: 1 }, cfg).outcome).toBe('inaccurate');
  });

  it('takes its limits from the environment', () => {
    const c = trackingConfig({ TRACK_MAX_ACCURACY_M: '10', TRACK_MIN_MOVE_M: '1', TRACK_MAX_SPEED_KMH: '36', TRACK_ARRIVE_RADIUS_M: '100' } as never);
    expect(c).toMatchObject({ maxAccuracyM: 10, minMoveM: 1, arriveRadiusM: 100 });
    expect(c.maxSpeedMps).toBe(10);
  });
});
