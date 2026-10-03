import { assertKobo, nairaToKobo, percentOf, roundToNearestTenNaira, roundToStep } from './money';

// Unit tests: pure functions, no database. Money is whole kobo and a wrong rounding rule moves real money.
describe('money', () => {
  it('converts naira to kobo without float drift', () => {
    expect(nairaToKobo(19.99)).toBe(1999);
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
    expect(nairaToKobo(1234.5)).toBe(123450);
  });

  it('rejects anything that is not a positive whole number of kobo', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) expect(() => assertKobo(bad)).toThrow(RangeError);
    expect(assertKobo(1)).toBe(1);
  });

  it('takes a percentage in basis points, rounding halves up', () => {
    expect(percentOf(226_000, 1200)).toBe(27_120);
    expect(percentOf(1, 5000)).toBe(1); // 0.5 rounds up
    expect(percentOf(1, 4999)).toBe(0);
    expect(percentOf(0, 1200)).toBe(0);
    expect(percentOf(100, 10_000)).toBe(100);
  });

  it('rounds to the nearest step, halves up', () => {
    expect(roundToStep(1_234, 1_000)).toBe(1_000);
    expect(roundToStep(1_500, 1_000)).toBe(2_000);
    expect(roundToStep(1_499, 1_000)).toBe(1_000);
    expect(roundToNearestTenNaira(223_990)).toBe(224_000);
    expect(() => roundToStep(100, 0)).toThrow(RangeError);
    expect(() => roundToStep(100, 1.5)).toThrow(RangeError);
  });
});
