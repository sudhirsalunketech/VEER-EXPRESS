import { describe, expect, it } from 'vitest';
import { calcErrors } from './Site';

const base = { from: '411001', to: '110001', w: '2', l: '', b: '', h: '', service: 'EXPRESS' as const };

describe('rate calculator validation', () => {
  it('valid PINs with weight and no dimensions is fine', () => expect(calcErrors(base)).toEqual({}));
  it('only the weight is flagged when the weight is missing', () => expect(calcErrors({ ...base, w: '' })).toEqual({ w: 'Enter the weight' }));
  it('weight limits', () => {
    expect(calcErrors({ ...base, w: '0' }).w).toBe('Weight must be more than 0 kg');
    expect(calcErrors({ ...base, w: '71' }).w).toBe('Maximum 70 kg per parcel');
  });
  it('PIN messages are specific', () => {
    expect(calcErrors({ ...base, from: '' }).from).toBe('Enter the PIN code');
    expect(calcErrors({ ...base, from: '4110' }).from).toBe('PIN code must be 6 digits');
    expect(calcErrors({ ...base, to: '012345' }).to).toBe('PIN code cannot start with 0');
  });
  it('dimensions: all three or none', () => {
    expect(calcErrors({ ...base, l: '30' })).toEqual({ b: 'Enter all three dimensions, or leave all empty', h: 'Enter all three dimensions, or leave all empty' });
    expect(calcErrors({ ...base, l: '30', b: '20', h: '250' })).toEqual({ h: 'Maximum 200 cm' });
    expect(calcErrors({ ...base, l: '30', b: '20', h: '15' })).toEqual({});
  });
});
