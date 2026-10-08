import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PlateInput } from './bits';
import { formatPlate, isValidPlate, plateInput, plateProblem } from './ui';

function Box({ start = '' }: { start?: string }) {
  const [plain, setPlain] = useState(start);
  return <><PlateInput id="p" value={plain} onChange={setPlain} /><output aria-label="stored">{plain}</output></>;
}
const input = () => document.getElementById('p') as HTMLInputElement;
const stored = () => screen.getByLabelText('stored').textContent;

describe('plate numbers', () => {
  it('are stored plain and shown with the dash', () => {
    expect(formatPlate('kja482ab')).toBe('KJA-482AB');
    expect(formatPlate('KJA')).toBe('KJA');
    expect(formatPlate('')).toBe('');
    expect(plateInput('kja 482-ab!')).toBe('KJA482AB');
  });

  it('stay natural while typing: the dash appears by itself and the cursor stays at the end', async () => {
    render(<Box />);
    await userEvent.type(input(), 'kja482ab');
    expect(input().value).toBe('KJA-482AB');
    expect(stored()).toBe('KJA482AB');
    expect(input().selectionStart).toBe(9);
  });

  it('keep the cursor in place when typing and deleting in the middle', async () => {
    render(<Box start="KJA482A" />);
    input().focus();
    input().setSelectionRange(6, 6); // KJA-48|2A
    await userEvent.keyboard('9');
    expect(input().value).toBe('KJA-4892A');
    expect(input().selectionStart).toBe(7); // right after the 9, not thrown to the end
    await userEvent.keyboard('{Backspace}');
    expect(input().value).toBe('KJA-482A');
    expect(input().selectionStart).toBe(6);
  });

  it('never holds more than eight characters: three letters, three digits, two letters', async () => {
    render(<Box />);
    await userEvent.type(input(), 'kja482abxyz99');
    expect(stored()).toBe('KJA482AB');
  });

  it('backspace over the dash removes the letter before it, and a pasted plate is cleaned up', async () => {
    render(<Box start="KJA482AB" />);
    input().focus();
    input().setSelectionRange(4, 4); // KJA-|482AB
    await userEvent.keyboard('{Backspace}');
    expect(stored()).toBe('KJ482AB'); // the dash is only for show, so backspace removes the letter before it
    expect(input().value).toBe('KJ4-82AB');
    expect(input().selectionStart).toBe(2);
    await userEvent.clear(input());
    await userEvent.paste(' abc-123 de ');
    expect(input().value).toBe('ABC-123DE');
    expect(stored()).toBe('ABC123DE');
    expect(isValidPlate(stored()!)).toBe(true);
    expect(plateProblem('AB-123XY')).toContain('ABC-123XY');
    expect(plateProblem('')).toBeNull();
  });
});
