import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell, NotificationStack, SosIndicator, useNotifications } from './Notifications';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), get: vi.fn(), post: vi.fn(async () => ({})) }));
import { get, post } from './api';

function Host() {
  const api = useNotifications(true);
  return <MemoryRouter><SosIndicator api={api} /><NotificationBell api={api} /><NotificationStack api={api} /></MemoryRouter>;
}

const sos = { id: 'a1', at: new Date().toISOString(), role: 'driver', person: 'Ada Driver', phone: '+2348030000001', trip: 'K7XQ', tripId: 't1', location: { lat: 6.5, lng: 3.4 }, escalated: false };
const booking = { id: 'ride:1', type: 'booking', severity: 'info', title: 'New booking', text: 'Bayo requested a regular ride (ABC1).', at: new Date().toISOString(), link: '/trips/1' };

beforeEach(() => { vi.mocked(post).mockClear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => vi.useRealTimers());

describe('admin pop-ups', () => {
  it('shows an SOS at once, keeps it until acknowledged, and says who and where', async () => {
    vi.mocked(get).mockResolvedValue({ now: new Date().toISOString(), items: [], openSos: [sos] } as never);
    render(<Host />);
    expect(await screen.findByText('SOS EMERGENCY')).toBeInTheDocument();
    expect(screen.getByText(/Ada Driver/)).toBeInTheDocument();
    expect(screen.getByText('K7XQ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Location' })).toHaveAttribute('href', 'https://www.google.com/maps?q=6.5,3.4');
    // it does not fade away
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText('SOS EMERGENCY')).toBeInTheDocument();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Acknowledge and open' }));
    expect(post).toHaveBeenCalledWith('/admin/sos/a1/acknowledge');
    await waitFor(() => expect(screen.queryByText('SOS EMERGENCY')).not.toBeInTheDocument());
  });

  it('does not replay old events on the first look, then pops up what is new and lists it in the bell', async () => {
    vi.mocked(get)
      .mockResolvedValueOnce({ now: '2026-10-05T10:00:00Z', items: [{ ...booking, id: 'ride:old', text: 'an old one' }], openSos: [] } as never)
      .mockResolvedValue({ now: '2026-10-05T10:00:06Z', items: [booking], openSos: [] } as never);
    render(<Host />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByText('an old one')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
    expect(await screen.findByText(/Bayo requested/)).toBeInTheDocument();
    expect(screen.getByLabelText('Notifications')).toHaveTextContent('1');
    // the pop-up fades; the bell keeps the record
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByLabelText('Notifications'));
    expect(screen.getByText(/Bayo requested/)).toBeInTheDocument();
  });

  it('keeps a count of unresolved SOS alerts in the corner, however old, and opens the Safety Center', async () => {
    vi.mocked(get).mockResolvedValue({ now: new Date().toISOString(), items: [], openSos: [], unresolvedSos: 3 } as never);
    render(<Host />);
    const ind = await screen.findByRole('button', { name: /SOS Alerts: 3/ });
    expect(ind).toHaveTextContent('SOS Alerts: 3');
    // the count follows the server, going down when alerts are resolved
    vi.mocked(get).mockResolvedValue({ now: new Date().toISOString(), items: [], openSos: [], unresolvedSos: 1 } as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
    expect(screen.getByRole('button', { name: /SOS Alerts: 1/ })).toBeInTheDocument();
  });
});
