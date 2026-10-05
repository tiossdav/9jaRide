import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from './bits';
import { useLoad } from './ui';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), get: vi.fn() }));
import { get } from './api';

const rows = { ada: ['Ada Driver'], bayo: ['Bayo Driver'], all: ['Ada Driver', 'Bayo Driver'] } as Record<string, string[]>;

function Page() {
  const [search, setSearch] = useState('');
  const { data } = useLoad<string[]>(`/admin/console/drivers${search ? `?search=${search}` : ''}`);
  if (!data) return <div>Loading…</div>; // the real pages do exactly this
  return (
    <div>
      <SearchBox placeholder="Search drivers" onSearch={setSearch} />
      <ul>{data.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}

beforeEach(() => {
  vi.mocked(get).mockReset();
  vi.mocked(get).mockImplementation(async (path: string) => {
    await new Promise((r) => setTimeout(r, 30));
    const q = /search=(\w+)/.exec(path)?.[1];
    return (q ? rows[q] ?? [] : rows.all) as never;
  });
});

describe('searching a list', () => {
  it('keeps what was typed and the rows on screen while results load, then shows the matches', async () => {
    render(<Page />);
    const box = await screen.findByLabelText('Search drivers');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(box, 'ada');
    expect(box).toHaveValue('ada'); // not wiped by a reload
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('Ada Driver')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search drivers')).toBe(box); // the same input element: the page did not remount
  });

  it('does not search on first render, and clearing returns every row', async () => {
    render(<Page />);
    await screen.findByLabelText('Search drivers');
    expect(get).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText('Search drivers'), 'bayo');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    fireEvent.click(screen.getByLabelText('Clear search'));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.getByLabelText('Search drivers')).toHaveValue('');
  });

  it('says so when nothing matches', async () => {
    render(<Page />);
    await userEvent.type(await screen.findByLabelText('Search drivers'), 'zzz');
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0));
  });
});
