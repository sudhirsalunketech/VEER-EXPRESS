import { describe, expect, it } from 'vitest';
import {
  allocate, buildQuote, chargeableWeightKg, generateTrackingNumber, isValidTrackingNumber,
  resolveZone, toCustomerQuote, volumetricWeightKg, type CourierRateCard,
} from './index';
import { DEMO_PRICING, DEMO_RATE_CARDS, DEMO_SHIPMENTS } from './seed';

const dims = { lengthCm: 30, widthCm: 20, heightCm: 10 };

describe('weights', () => {
  it('computes volumetric weight with divisor', () => {
    expect(volumetricWeightKg(dims, 5000)).toBe(1.2);
  });
  it('chargeable is max of actual and volumetric', () => {
    expect(chargeableWeightKg(0.5, dims, 5000)).toBe(1.2);
    expect(chargeableWeightKg(3, dims, 5000)).toBe(3);
  });
  it('rejects bad input', () => {
    expect(() => chargeableWeightKg(0, dims, 5000)).toThrow();
    expect(() => volumetricWeightKg(dims, 0)).toThrow();
  });
});

describe('zones', () => {
  it('resolves zones', () => {
    expect(resolveZone('411001', '411038')).toBe('LOCAL');
    expect(resolveZone('411001', '422001')).toBe('WITHIN_STATE');
    expect(resolveZone('400053', '110001')).toBe('METRO');
    expect(resolveZone('411001', '302001')).toBe('REST_OF_INDIA');
    expect(resolveZone('411001', '781001')).toBe('SPECIAL');
    expect(() => resolveZone('011001', '411001')).toThrow();
  });
});

describe('pricing', () => {
  const card: CourierRateCard = {
    partnerCode: 'T', partnerName: 'Test', volumetricDivisor: 5000, fuelSurchargePct: 0, remoteAreaSurcharge: 0,
    priority: 1, enabled: true, nonServiceablePrefixes: [],
    slabs: [{ zone: 'LOCAL', service: 'STANDARD', basePrice: 80, baseWeightKg: 0.5, additionalPrice: 40, stepKg: 0.5, minCharge: 80, tatDays: 1 }],
  };
  it('reproduces the spec example: partner ₹80 + markup ₹30 = ₹110 before tax', () => {
    const q = buildQuote(card, { markupFlat: 30, markupPct: 0, insurancePct: 2, insuranceMin: 50, gstPct: 18 }, {
      originPin: '411001', destPin: '411002', actualWeightKg: 0.4, dims: { lengthCm: 1, widthCm: 1, heightCm: 1 },
      service: 'STANDARD', declaredValue: 0, insurance: false,
    })!;
    expect(q.partnerCost).toBe(80);
    expect(q.freight).toBe(110);
    expect(q.grossMargin).toBe(30);
    expect(q.gst).toBe(19.8);
    expect(q.total).toBe(129.8);
  });
  it('adds weight steps', () => {
    const q = buildQuote(card, DEMO_PRICING, { originPin: '411001', destPin: '411002', actualWeightKg: 1.3, dims, service: 'STANDARD', declaredValue: 0, insurance: false })!;
    expect(q.partnerCost).toBe(80 + 2 * 40);
  });
  it('customer quote hides internal fields', () => {
    const q = buildQuote(card, DEMO_PRICING, { originPin: '411001', destPin: '411002', actualWeightKg: 1, dims, service: 'STANDARD', declaredValue: 0, insurance: false })!;
    const pub = toCustomerQuote(q) as unknown as Record<string, unknown>;
    for (const k of ['partnerCode', 'partnerName', 'partnerCost', 'grossMargin']) expect(pub[k]).toBeUndefined();
  });
});

describe('allocation', () => {
  const input = { originPin: '411001', destPin: '110001', actualWeightKg: 1, dims, service: 'EXPRESS' as const, declaredValue: 1000, insurance: true };
  it('cheapest picks lowest partner cost among eligible, enabled partners', () => {
    const r = allocate(DEMO_RATE_CARDS, DEMO_PRICING, input, 'CHEAPEST');
    const costs = r.candidates.map((c) => c.partnerCost);
    expect(r.chosen!.partnerCost).toBe(Math.min(...costs));
    expect(r.candidates.find((c) => c.partnerCode === 'MOCK')).toBeUndefined();
  });
  it('manual respects choice or refuses ineligible', () => {
    expect(allocate(DEMO_RATE_CARDS, DEMO_PRICING, input, 'MANUAL', { manualPartner: 'BLUEDART' }).chosen!.partnerCode).toBe('BLUEDART');
    expect(allocate(DEMO_RATE_CARDS, DEMO_PRICING, input, 'MANUAL', { manualPartner: 'MOCK' }).chosen).toBeNull();
  });
  it('rule based matches first rule', () => {
    const r = allocate(DEMO_RATE_CARDS, DEMO_PRICING, input, 'RULE_BASED', { rules: [{ service: 'EXPRESS', preferPartner: 'BLUEDART' }] });
    expect(r.chosen!.partnerCode).toBe('BLUEDART');
  });
  it('excludes non-serviceable partners', () => {
    const r = allocate(DEMO_RATE_CARDS, DEMO_PRICING, { ...input, destPin: '744101' }, 'CHEAPEST');
    expect(r.candidates.map((c) => c.partnerCode)).not.toContain('BLUEDART');
  });
});

describe('tracking numbers', () => {
  it('generates valid, checksummed numbers', () => {
    for (let i = 0; i < 50; i++) expect(isValidTrackingNumber(generateTrackingNumber())).toBe(true);
    expect(isValidTrackingNumber('VX0000000000001')).toBe(false);
  });
  it('seed has 20 unique shipments', () => {
    expect(new Set(DEMO_SHIPMENTS.map((s) => s.trackingNumber)).size).toBe(20);
  });
});
