import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Svg, code128Values } from './receipt';

describe('Code 128 barcode', () => {
  it('every symbol is 11 modules wide (stop is 13)', () => {
    CODE128_PATTERNS.forEach((p, i) => {
      expect([...p].reduce((s, d) => s + Number(d), 0)).toBe(i === 106 ? 13 : 11);
    });
  });
  it('encodes start B, data, mod-103 checksum and stop', () => {
    // "VX1": start 104 + 54*1 + 56*2 + 17*3 = 321 → 321 % 103 = 12
    expect(code128Values('VX1')).toEqual([104, 54, 56, 17, 12, 106]);
  });
  it('rejects characters outside subset B', () => {
    expect(() => code128Values('₹')).toThrow();
  });
  it('renders an SVG labelled with the tracking number', () => {
    expect(code128Svg('VX2610310348734')).toContain('aria-label="Barcode VX2610310348734"');
  });
});
