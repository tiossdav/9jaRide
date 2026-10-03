// Money is integer kobo everywhere. Floats are a bug class here (spec: "Rules for the engine").
export type Kobo = number;

export function nairaToKobo(naira: number): Kobo {
  return Math.round(naira * 100);
}

export function assertKobo(value: number, label = 'amount'): Kobo {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer number of kobo, got ${value}`);
  }
  return value;
}

/** Percentage of an amount in basis points (1200 = 12%), rounded half up, integer maths only. */
export function percentOf(amount: Kobo, basisPoints: number): Kobo {
  return Math.floor((amount * basisPoints + 5000) / 10000);
}

/** Round to the nearest ₦10 (1,000 kobo). Shown to riders as its own receipt line. */
export function roundToNearestTenNaira(amount: Kobo): Kobo {
  return Math.floor((amount + 500) / 1000) * 1000;
}
