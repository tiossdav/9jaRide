import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { ChangePassword } from './ChangePassword';

// Component test: the rules a new password must meet are shown before anything is sent.
describe('ChangePassword', () => {
  beforeEach(() => {
    vi.spyOn(api, 'post').mockResolvedValue(undefined);
    vi.spyOn(api, 'login').mockResolvedValue('admin');
  });
  const fill = async (current: string, next: string, again: string) => {
    await userEvent.type(screen.getByLabelText(/Current password/), current);
    await userEvent.type(screen.getByLabelText(/^New password/), next);
    await userEvent.type(screen.getByLabelText(/Confirm new password/), again);
  };

  it('asks for a longer password and lets nothing through until it is right', async () => {
    render(<ChangePassword email="a@b.co" onClose={() => undefined} onDone={() => undefined} />);
    const update = screen.getByRole('button', { name: 'Update Password' });
    await fill('old-password-1', 'short1', 'short1');
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 12 characters.');
    expect(update).toBeDisabled();
  });

  it('wants letters and numbers, a different password, and a matching confirmation', async () => {
    render(<ChangePassword email="a@b.co" onClose={() => undefined} onDone={() => undefined} />);
    await fill('old-password-1', 'onlylettershere', 'onlylettershere');
    expect(screen.getByRole('alert')).toHaveTextContent('letters and numbers');
  });

  it('refuses a confirmation that does not match', async () => {
    render(<ChangePassword email="a@b.co" onClose={() => undefined} onDone={() => undefined} />);
    await fill('old-password-1', 'brand-new-pass-7', 'brand-new-pass-8');
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  });

  it('changes the password, then signs in again because every session was ended', async () => {
    const onDone = vi.fn();
    render(<ChangePassword email="a@b.co" onClose={() => undefined} onDone={onDone} />);
    await fill('old-password-1', 'brand-new-pass-7', 'brand-new-pass-7');
    await userEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/staff/change-password', { currentPassword: 'old-password-1', newPassword: 'brand-new-pass-7' });
    expect(api.login).toHaveBeenCalledWith('a@b.co', 'brand-new-pass-7');
  });

  it('cannot be closed when the change is required', () => {
    render(<ChangePassword email="a@b.co" forced onClose={() => undefined} onDone={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('shows what the server said when it refuses', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('the current password is wrong'));
    render(<ChangePassword email="a@b.co" onClose={() => undefined} onDone={() => undefined} />);
    await fill('wrong-password-1', 'brand-new-pass-7', 'brand-new-pass-7');
    await userEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the current password is wrong');
  });
});
