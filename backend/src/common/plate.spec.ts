import { displayPlate, normalisePlate, plateLike } from './plate';

describe('number plates', () => {
  it('are stored the same whatever way they were typed', () => {
    expect(normalisePlate('kja 482-ab')).toBe('KJA482AB');
    expect(normalisePlate(' KJA-482AB ')).toBe('KJA482AB');
    expect(normalisePlate('!!')).toBe('');
  });
  it('are shown with the standard dash', () => {
    expect(displayPlate('KJA482AB')).toBe('KJA-482AB');
    expect(displayPlate('kja')).toBe('KJA');
    expect(displayPlate(null)).toBe('');
  });
  it('are found by a search typed in any style, but a name is not mistaken for one', () => {
    expect(plateLike('kja-482')).toBe('%KJA482%');
    expect(plateLike('a')).toBe('');
  });
});
