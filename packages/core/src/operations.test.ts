import { describe, expect, it } from 'vitest';
import {
  DEMO_SHIPMENTS, balanceDue, hoursSinceLastUpdate, ledgerFor, paymentStatus, receiptNumber, trialBalance,
  validateAllocation, validateCollection, validateTrackingUpdate, type PaymentRecord,
} from './index';

const pay = (amount: number, method: PaymentRecord['method'] = 'CASH'): PaymentRecord =>
  ({ id: 'P', method, amount, at: '2026-10-30T10:00:00Z', receiptNo: null, reference: null, collectedBy: 'x', simulated: true });

describe('allocation validation', () => {
  const ok = { aggregatorRef: 'AGG-554100', courierName: 'DTDC', awb: 'D1234567890', partnerCost: 120 };
  it('accepts a complete allocation', () => expect(validateAllocation(ok)).toBeNull());
  it('rejects missing ref, bad AWB and zero cost', () => {
    expect(validateAllocation({ ...ok, aggregatorRef: '' })).toMatch(/reference/);
    expect(validateAllocation({ ...ok, awb: 'AB 12' })).toMatch(/AWB/);
    expect(validateAllocation({ ...ok, partnerCost: 0 })).toMatch(/cost/);
  });
});

describe('manual tracking updates', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  const cur = { status: 'PICKED_UP' as const, events: [{ at: '2026-10-31T08:00:00Z' }], allocated: true };
  const u = { status: 'IN_TRANSIT' as const, occurredAt: '2026-10-31T10:00:00Z', location: 'Pune hub', remarks: '', verified: true };

  it('accepts a valid next status', () => expect(validateTrackingUpdate(cur, u, now)).toBeNull());
  it('requires an allocation first', () => expect(validateTrackingUpdate({ ...cur, allocated: false }, u, now)).toMatch(/Allocate/));
  it('enforces the status sequence', () => expect(validateTrackingUpdate(cur, { ...u, status: 'DELIVERED' }, now)).toMatch(/cannot follow/));
  it('rejects future and out-of-order times', () => {
    expect(validateTrackingUpdate(cur, { ...u, occurredAt: '2026-10-31T13:00:00Z' }, now)).toMatch(/future/);
    expect(validateTrackingUpdate(cur, { ...u, occurredAt: '2026-10-31T07:00:00Z' }, now)).toMatch(/earlier/);
  });
  it('accepts an update in the same minute as the previous event (minute-precision entry)', () => {
    const c = { ...cur, events: [{ at: '2026-10-31T10:00:42Z' }] };
    expect(validateTrackingUpdate(c, { ...u, occurredAt: '2026-10-31T10:00:00Z' }, now)).toBeNull();
    expect(validateTrackingUpdate(c, { ...u, occurredAt: '2026-10-31T09:59:00Z' }, now)).toMatch(/earlier/);
  });
  it('requires verification and exception remarks', () => {
    expect(validateTrackingUpdate(cur, { ...u, verified: false }, now)).toMatch(/verified/);
    expect(validateTrackingUpdate(cur, { ...u, status: 'EXCEPTION' }, now)).toMatch(/remarks/);
  });
  it('nothing can follow DELIVERED', () =>
    expect(validateTrackingUpdate({ ...cur, status: 'DELIVERED' }, { ...u, status: 'IN_TRANSIT' }, now)).toMatch(/cannot follow/));
  it('measures staleness from the recorded time', () =>
    expect(hoursSinceLastUpdate([{ recordedAt: '2026-10-31T00:00:00Z' }], now)).toBe(12));
});

describe('payments', () => {
  it('status depends only on payment records', () => {
    expect(paymentStatus(100, [])).toBe('PENDING');
    expect(paymentStatus(100, [pay(40)])).toBe('PARTIALLY_PAID');
    expect(paymentStatus(100, [pay(40), pay(60)])).toBe('PAID');
    expect(paymentStatus(100, [pay(100), pay(-100)])).toBe('REFUNDED');
    expect(balanceDue(100, [pay(40)])).toBe(60);
  });
  it('validates counter collections', () => {
    expect(validateCollection(100, { method: 'CASH', amount: 100, reference: '' })).toBeNull();
    expect(validateCollection(100, { method: 'CASH', amount: 120, reference: '' })).toMatch(/exceeds/);
    expect(validateCollection(100, { method: 'COUNTER_UPI', amount: 50, reference: '' })).toMatch(/UPI/);
  });
  it('numbers receipts per branch', () => expect(receiptNumber('BR-KMT', 12)).toBe('KMT-R-000012'));
});

describe('ledger', () => {
  it('every demo shipment produces balanced double entries', () => {
    const entries = DEMO_SHIPMENTS.flatMap((s) => ledgerFor(s));
    const tb = trialBalance(entries);
    expect(tb.balanced).toBe(true);
    expect(tb.debit).toBeGreaterThan(0);
  });
  it('receivable equals unpaid balance', () => {
    const s = DEMO_SHIPMENTS.find((x) => x.payments.length === 0)!;
    const recv = trialBalance(ledgerFor(s)).rows.find((r) => r.account === 'Customer receivable')!;
    expect(recv.balance).toBe(s.amount);
  });
});

describe('demo seed', () => {
  it('has unallocated shipments for the queue and allocated ones with AWB', () => {
    expect(DEMO_SHIPMENTS.filter((s) => !s.allocation).length).toBe(3);
    expect(DEMO_SHIPMENTS.filter((s) => s.allocation).every((s) => s.allocation!.awb && s.allocation!.aggregatorRef)).toBe(true);
  });
  it('event times are ordered and never in the future', () => {
    for (const s of DEMO_SHIPMENTS) {
      for (let k = 1; k < s.events.length; k++) expect(s.events[k].at >= s.events[k - 1].at).toBe(true);
      expect(new Date(s.events.at(-1)!.recordedAt).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});
