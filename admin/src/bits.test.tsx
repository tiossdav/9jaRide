import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pager, ReasonModal, go, useAction, useConfirm } from './bits';

// Component tests: what a person sees and can do, without a server.
function Host({ action, danger = false }: { action: () => Promise<unknown> | void; danger?: boolean }) {
  const c = useConfirm();
  return (
    <>
      <button onClick={() => c.ask({ title: 'Approve ₦4,000?', text: 'Money is sent now.', confirm: 'Yes, approve', danger }, action)}>Approve</button>
      {c.node}
    </>
  );
}

describe('the second click (useConfirm)', () => {
  it('does nothing until the confirm button is pressed', async () => {
    const action = vi.fn();
    render(<Host action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText('Approve ₦4,000?')).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, approve' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Approve ₦4,000?')).not.toBeInTheDocument());
  });

  it('goes back without running the action', async () => {
    const action = vi.fn();
    render(<Host action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByText('Approve ₦4,000?')).not.toBeInTheDocument();
  });

  it('keeps the box open and shows the reason when the server refuses', async () => {
    const action = vi.fn().mockRejectedValue(new Error('a different admin must approve your change'));
    render(<Host action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a different admin must approve your change');
    expect(screen.getByText('Approve ₦4,000?')).toBeInTheDocument();
  });

  it('cannot be confirmed twice while it is working', async () => {
    let finish!: () => void;
    const action = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    render(<Host action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, approve' }));
    expect(await screen.findByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });

  it('styles a risky action as dangerous', async () => {
    render(<Host action={vi.fn()} danger />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Yes, approve' })).toHaveClass('danger');
  });
});

describe('ReasonModal', () => {
  it('will not send until a real reason is written', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReasonModal title="Suspend Ada?" confirm="Suspend" onClose={() => undefined} onSubmit={onSubmit} />);
    const send = screen.getByRole('button', { name: 'Suspend' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'ab');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'c');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('abc'));
  });
});

describe('Pager', () => {
  it('says which rows are showing and moves between pages', async () => {
    const onPage = vi.fn();
    render(<Pager page={2} pageSize={20} total={62} onPage={onPage} />);
    expect(screen.getByText('Showing 21 to 40 of 62 results')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPage).toHaveBeenCalledWith(1);
  });
  it('cannot go past either end, and copes with no results', () => {
    const { rerender } = render(<Pager page={1} pageSize={20} total={0} onPage={() => undefined} />);
    expect(screen.getByText('Showing 0 to 0 of 0 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    rerender(<Pager page={4} pageSize={20} total={62} onPage={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('go() inside the second click', () => {
  // A page that wraps its action in useAction().run catches the error itself, so the box closed as if it had worked.
  // go() lets the failure reach the box, which stays open and says why.
  function Page() {
    const c = useConfirm();
    return (
      <>
        <button onClick={() => c.ask({ title: 'Approve?', confirm: 'Yes' }, () => go(() => Promise.reject(new Error('a different admin must approve your change'))))}>Open</button>
        {c.node}
      </>
    );
  }
  it('keeps the box open and shows the reason when the action fails', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('different admin');
    expect(screen.getByText('Approve?')).toBeInTheDocument();
  });
  it('runs the follow-up only when the action worked', async () => {
    const after = vi.fn();
    const ok = vi.fn().mockResolvedValue(undefined);
    await go(ok, after);
    expect(after).toHaveBeenCalledTimes(1);
    await expect(go(() => Promise.reject(new Error('no')), after)).rejects.toThrow('no');
    expect(after).toHaveBeenCalledTimes(1);
  });
  it('useAction().run reports the error itself and does not throw', async () => {
    let result!: ReturnType<typeof useAction>;
    function Probe() { result = useAction(); return null; }
    render(<Probe />);
    await act(async () => { await result.run(() => Promise.reject(new Error('boom'))); });
    expect(result.error).toBe('boom');
  });
});
