import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import Layout from './Layout';

// Component test: each role sees only the parts of the portal it can use.
async function open(role: 'support' | 'finance' | 'admin', path = '/live') {
  vi.spyOn(api, 'get').mockResolvedValue({ id: '1', name: 'Test Person', role, email: 't@example.test', mustChangePassword: false });
  render(<MemoryRouter initialEntries={[path]}><Layout toggleTheme={() => undefined} /></MemoryRouter>);
  await screen.findByText('Test Person');
  return within(screen.getByRole('navigation', { hidden: true, name: '' }).closest('aside') as HTMLElement);
}

describe('sidebar by role', () => {
  beforeEach(() => localStorage.clear());

  it('shows an admin everything, including the team and activity logs', async () => {
    const side = await open('admin');
    for (const name of ['Dashboard', 'Live operations', 'Safety Center', 'Trips', 'Finances', 'Team', 'Activity Logs']) expect(side.getByText(name)).toBeInTheDocument();
  });

  it('keeps support out of the money and the team', async () => {
    const side = await open('support');
    expect(side.getByText('Safety Center')).toBeInTheDocument();
    for (const name of ['Finances', 'Team', 'Activity Logs', 'Promo']) expect(side.queryByText(name)).not.toBeInTheDocument();
  });

  it('shows finance only the money', async () => {
    const side = await open('finance', '/finances/wallet');
    expect(side.getByText('Finances')).toBeInTheDocument();
    for (const name of ['Dashboard', 'Live operations', 'Safety Center', 'Trips', 'Team']) expect(side.queryByText(name)).not.toBeInTheDocument();
  });

  it('marks pages that are not built yet as coming soon', async () => {
    const side = await open('admin');
    expect(side.getByText('Support').closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('asks before signing out', async () => {
    await open('admin');
    await userEvent.click(screen.getByRole('button', { name: /Test Person/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
    expect(screen.getByText('Sign out?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, sign out' })).toBeInTheDocument();
  });

  it('collapses to icons and remembers it', async () => {
    const side = await open('admin');
    await userEvent.click(side.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('side')).toBe('1');
    expect(side.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });
});
