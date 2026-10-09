import { summariseDebt } from './debt.service';

const at = (n: number) => new Date(2026, 9, 1, 0, n);
const e = (n: number, kind: string, amountKobo: number) => ({ at: at(n), kind, memo: null, amountKobo });

describe('what a driver owes, read from the wallet ledger', () => {
  it('owes nothing with an empty or positive wallet', () => {
    expect(summariseDebt([])).toMatchObject({ outstandingKobo: 0, incurredKobo: 0, recoveredKobo: 0, history: [] });
    expect(summariseDebt([e(1, 'topup', 500_000), e(2, 'trip_cash', -120_000)])).toMatchObject({ outstandingKobo: 0, incurredKobo: 0, history: [] });
  });

  it('counts a cash trip commission that takes the wallet below zero as debt', () => {
    const d = summariseDebt([e(1, 'trip_cash', -50_000)]);
    expect(d).toMatchObject({ outstandingKobo: 50_000, incurredKobo: 50_000, recoveredKobo: 0 });
    expect(d.history[0]).toMatchObject({ type: 'debt_incurred', debtChangeKobo: 50_000, debtAfterKobo: 50_000 });
  });

  it('counts only the part of a charge that goes below zero as debt, when the wallet had some money', () => {
    const d = summariseDebt([e(1, 'topup', 20_000), e(2, 'trip_cash', -50_000)]);
    expect(d).toMatchObject({ outstandingKobo: 30_000, incurredKobo: 30_000 });
  });

  it('recovers part of the debt from money that arrives, and keeps the rest outstanding', () => {
    const d = summariseDebt([e(1, 'trip_cash', -100_000), e(2, 'trip_wallet', 40_000)]);
    expect(d).toMatchObject({ outstandingKobo: 60_000, incurredKobo: 100_000, recoveredKobo: 40_000 });
    expect(d.history.map((h) => [h.type, h.debtChangeKobo, h.debtAfterKobo])).toEqual([['debt_recovered', -40_000, 60_000], ['debt_incurred', 100_000, 100_000]]); // newest first
  });

  it('clears the debt fully, counting only the debt as recovered and not the money left over', () => {
    const d = summariseDebt([e(1, 'trip_cash', -100_000), e(2, 'topup', 250_000)]);
    expect(d).toMatchObject({ outstandingKobo: 0, incurredKobo: 100_000, recoveredKobo: 100_000 });
    expect(d.history[0]).toMatchObject({ type: 'debt_recovered', debtChangeKobo: -100_000, debtAfterKobo: 0 });
  });

  it('keeps the whole history after the debt is repaid, and handles debt that comes back again', () => {
    const d = summariseDebt([e(1, 'trip_cash', -100_000), e(2, 'topup', 100_000), e(3, 'trip_cash', -30_000), e(4, 'trip_wallet', 10_000)]);
    expect(d).toMatchObject({ outstandingKobo: 20_000, incurredKobo: 130_000, recoveredKobo: 110_000 });
    expect(d.history).toHaveLength(4);
  });

  it('is exactly the negative balance: incurred minus recovered always equals what is owed', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const entries = Array.from({ length: 12 }, (_, i) => e(i, 'x', Math.round((rnd() - 0.5) * 200_000)));
      const d = summariseDebt(entries);
      const balance = entries.reduce((n, x) => n + x.amountKobo, 0);
      expect(d.outstandingKobo).toBe(Math.max(0, -balance));
      expect(d.incurredKobo - d.recoveredKobo).toBe(d.outstandingKobo);
    }
  });
});
