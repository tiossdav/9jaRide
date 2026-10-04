import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineChart, dateTime, duration, initials, naira, paymentChip, statusChip, title } from './ui';

// Unit tests for the small formatting helpers every page leans on.
describe('naira', () => {
  it('shows whole naira without decimals and keeps kobo when there are any', () => {
    expect(naira(226_000)).toBe('₦2,260');
    expect(naira(226_050)).toBe('₦2,260.50');
    expect(naira(0)).toBe('₦0');
  });
  it('can always show decimals, for the ledger', () => {
    expect(naira(226_000, true)).toBe('₦2,260.00');
  });
  it('shows a dash when there is no amount yet', () => {
    expect(naira(null)).toBe('-');
    expect(naira(undefined)).toBe('-');
  });
  it('handles negative balances', () => {
    expect(naira(-57_200_000, true)).toContain('572,000.00');
  });
});

describe('text helpers', () => {
  it('turns server words into plain words', () => {
    expect(title('TRIP_COMPLETED')).toBe('Trip completed');
    expect(title('send package')).toBe('Send package');
  });
  it('takes up to two initials', () => {
    expect(initials('Olaoluwa Taiwo')).toBe('OT');
    expect(initials('Madonna')).toBe('M');
    expect(initials('Ada Jane Okonkwo')).toBe('AJ');
    expect(initials(null)).toBe('?');
  });
  it('writes a duration as minutes and seconds', () => {
    expect(duration(700)).toBe('11m 40s');
    expect(duration(null)).toBe('-');
  });
  it('writes dates in Lagos time', () => {
    expect(dateTime('2026-10-03T21:30:00Z')).toContain('22:30'); // UTC+1
    expect(dateTime(null)).toBe('-');
  });
});

describe('status chips', () => {
  const text = (node: React.ReactNode) => { render(<>{node}</>); return screen.getByText(/.+/).textContent; };
  it('names each trip state in words a person would use', () => {
    expect(text(statusChip('TRIP_COMPLETED'))).toBe('Completed');
  });
  it('treats every kind of cancellation as cancelled', () => {
    expect(text(statusChip('CANCELLED_BY_DRIVER'))).toBe('Cancelled');
  });
  it('shows an unpaid trip as pending', () => {
    expect(text(paymentChip('UNPAID'))).toBe('Pending');
  });
});

describe('LineChart', () => {
  it('draws one point per month and a letter under each', () => {
    const { container } = render(<LineChart labels={['Jan', 'Feb', 'Mar']} values={[0, 5, 2]} />);
    expect(container.querySelectorAll('text')).toHaveLength(3);
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Trend chart');
  });
  it('does not crash when every value is zero', () => {
    const { container } = render(<LineChart labels={['Jan', 'Feb']} values={[0, 0]} />);
    expect(container.querySelector('path[fill="none"]')?.getAttribute('d')).not.toContain('NaN');
  });
  it('thins the labels on a long axis so they do not overlap', () => {
    const labels = Array.from({ length: 30 }, (_, i) => `${i + 1} Oct`);
    const { container } = render(<LineChart labels={labels} values={labels.map((_, i) => i)} letters={false} />);
    expect(container.querySelectorAll('text').length).toBeLessThan(10);
  });
});

describe('money boxes', () => {
  it('group thousands as you type and turn into kobo', async () => {
    const { moneyInput, toKobo } = await import('./ui');
    expect(moneyInput('1250000')).toBe('1,250,000');
    expect(moneyInput('1,250,000.555')).toBe('1,250,000.55');
    expect(moneyInput('abc12')).toBe('12');
    expect(toKobo('1,250,000.5')).toBe(125_000_050);
  });
});
