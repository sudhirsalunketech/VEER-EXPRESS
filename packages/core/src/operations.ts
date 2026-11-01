/**
 * Manual-operations rules shared by the demo and the production backend:
 * courier allocation via an aggregator account, staff-entered tracking updates,
 * payment status (independent of shipment status) and the money ledger.
 */
import type { UnifiedStatus } from './index';

// ---------------------------------------------------------------- allocation

/** Recorded by staff after booking the shipment in the external aggregator account. */
export interface Allocation {
  aggregator: string;
  aggregatorRef: string;
  courierName: string;
  awb: string;
  partnerCost: number;
  allocatedBy: string;
  allocatedAt: string;
}

export interface AllocationInput { aggregatorRef: string; courierName: string; awb: string; partnerCost: number }

export function validateAllocation(a: AllocationInput): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{3,39}$/.test(a.aggregatorRef.trim())) return 'Enter the aggregator booking reference (4–40 letters, digits, - / _)';
  if (a.courierName.trim().length < 2) return 'Select the courier the aggregator assigned';
  if (!/^[A-Za-z0-9-]{6,30}$/.test(a.awb.trim())) return 'Enter the courier AWB exactly as issued (6–30 letters, digits or -)';
  if (!(a.partnerCost > 0) || a.partnerCost > 100000) return 'Enter the partner cost charged by the aggregator';
  return null;
}

// ---------------------------------------------------------------- tracking

export type EventSource = 'SYSTEM' | 'MANUAL' | 'API';

/** A tracking event. `at` = when it happened (per courier site); `recordedAt`/`recordedBy` = audit. */
export interface TrackingEvent {
  status: UnifiedStatus;
  at: string;
  location: string;
  note: string;
  recordedAt: string;
  recordedBy: string;
  source: EventSource;
}

/** Which statuses staff may record next. IN_TRANSIT may repeat (new location scan). */
export const NEXT_STATUSES: Record<UnifiedStatus, UnifiedStatus[]> = {
  BOOKED: ['PICKED_UP', 'EXCEPTION'],
  PICKED_UP: ['IN_TRANSIT', 'EXCEPTION'],
  IN_TRANSIT: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'EXCEPTION'],
  ARRIVED_AT_DESTINATION_HUB: ['OUT_FOR_DELIVERY', 'EXCEPTION'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'EXCEPTION'],
  EXCEPTION: ['OUT_FOR_DELIVERY', 'ARRIVED_AT_DESTINATION_HUB', 'IN_TRANSIT', 'DELIVERED'],
  DELIVERED: [],
};

export interface TrackingUpdateInput { status: UnifiedStatus; occurredAt: string; location: string; remarks: string; verified: boolean }

export function validateTrackingUpdate(
  current: { status: UnifiedStatus; events: { at: string }[]; allocated: boolean },
  u: TrackingUpdateInput,
  now: Date = new Date(),
): string | null {
  if (!current.allocated) return 'Allocate a courier and AWB before recording tracking updates';
  if (!NEXT_STATUSES[current.status].includes(u.status)) return `"${u.status}" cannot follow "${current.status}"`;
  const t = new Date(u.occurredAt);
  if (Number.isNaN(t.getTime())) return 'Enter the date and time shown on the courier tracking page';
  if (t.getTime() > now.getTime() + 5 * 60e3) return 'Event time cannot be in the future';
  const last = current.events.at(-1);
  // staff enter times to the minute, so compare at minute precision
  if (last && Math.floor(t.getTime() / 60e3) < Math.floor(new Date(last.at).getTime() / 60e3)) return 'Event time is earlier than the previous update';
  if (u.location.trim().length < 2) return 'Enter the location shown on the courier tracking page';
  if (u.status === 'EXCEPTION' && u.remarks.trim().length < 5) return 'Describe the exception in remarks';
  if (!u.verified) return 'Confirm you verified this update on the courier tracking page';
  return null;
}

/** Hours since staff last recorded an update — drives the tracking desk "stale" queue. */
export function hoursSinceLastUpdate(events: { recordedAt: string }[], now: Date = new Date()): number {
  const last = events.at(-1);
  return last ? (now.getTime() - new Date(last.recordedAt).getTime()) / 3600e3 : Infinity;
}
export const STALE_AFTER_HOURS = 12;

// ---------------------------------------------------------------- payments

export type PaymentMethod = 'ONLINE_GATEWAY' | 'UPI_GATEWAY' | 'CASH' | 'COUNTER_UPI' | 'COUNTER_CARD' | 'CREDIT_ACCOUNT';
export type PaymentStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';

export interface PaymentRecord {
  id: string;
  method: PaymentMethod;
  amount: number;            // positive = received, negative = refund
  at: string;
  receiptNo: string | null;  // counter collections
  reference: string | null;  // gateway payment id / UPI txn id / card slip
  collectedBy: string;       // staff name, or 'Payment gateway'
  simulated: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Payment status is derived from payment records only — never from shipment status. */
export function paymentStatus(amountDue: number, payments: PaymentRecord[]): PaymentStatus {
  const received = r2(payments.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0));
  const refunded = r2(-payments.filter((p) => p.amount < 0).reduce((s, p) => s + p.amount, 0));
  if (refunded > 0 && refunded >= received) return 'REFUNDED';
  const net = r2(received - refunded);
  if (net <= 0) return 'PENDING';
  return net + 0.005 >= amountDue ? 'PAID' : 'PARTIALLY_PAID';
}
export function balanceDue(amountDue: number, payments: PaymentRecord[]) {
  return r2(Math.max(0, amountDue - payments.reduce((s, p) => s + p.amount, 0)));
}

export interface CollectionInput { method: Extract<PaymentMethod, 'CASH' | 'COUNTER_UPI' | 'COUNTER_CARD'>; amount: number; reference: string }
export function validateCollection(due: number, c: CollectionInput): string | null {
  if (!(c.amount > 0)) return 'Enter the amount collected';
  if (c.amount > due + 0.005) return `Amount exceeds balance due (₹${due.toFixed(2)})`;
  if (c.method !== 'CASH' && c.reference.trim().length < 4) return 'Enter the UPI transaction ID or card slip number';
  return null;
}

/** Per-branch receipt numbers, e.g. PUN-R-000012. */
export function receiptNumber(branchId: string, seq: number) {
  return `${branchId.replace(/^BR-/, '')}-R-${String(seq).padStart(6, '0')}`;
}

// ---------------------------------------------------------------- ledger

export type LedgerAccount =
  | 'Customer receivable' | 'Freight revenue' | 'GST payable' | 'Branch cash'
  | 'Payment gateway clearing' | 'Courier cost' | 'Aggregator payable';

export interface LedgerEntry { at: string; ref: string; account: LedgerAccount; debit: number; credit: number; memo: string; branchId: string }

/**
 * Double-entry ledger derived from shipment, payment and allocation records.
 * Every source event produces balanced lines (total debit = total credit).
 */
export function ledgerFor(s: {
  trackingNumber: string; bookedAt: string; branchId: string; amount: number; gstPct?: number;
  payments: PaymentRecord[]; allocation: Allocation | null;
}): LedgerEntry[] {
  const gstPct = s.gstPct ?? 18;
  const taxable = r2(s.amount / (1 + gstPct / 100));
  const gst = r2(s.amount - taxable);
  const L = (at: string, account: LedgerAccount, debit: number, credit: number, memo: string): LedgerEntry =>
    ({ at, ref: s.trackingNumber, account, debit: r2(debit), credit: r2(credit), memo, branchId: s.branchId });
  const out: LedgerEntry[] = [
    L(s.bookedAt, 'Customer receivable', s.amount, 0, 'Shipment booked'),
    L(s.bookedAt, 'Freight revenue', 0, taxable, 'Shipment booked'),
    L(s.bookedAt, 'GST payable', 0, gst, 'Shipment booked'),
  ];
  for (const p of s.payments) {
    const acct: LedgerAccount = p.method === 'ONLINE_GATEWAY' || p.method === 'UPI_GATEWAY' ? 'Payment gateway clearing' : 'Branch cash';
    if (p.method === 'CREDIT_ACCOUNT') continue; // on account: stays in receivable
    const memo = `${p.amount < 0 ? 'Refund' : 'Payment'} ${p.receiptNo ?? p.reference ?? p.id}`;
    if (p.amount >= 0) out.push(L(p.at, acct, p.amount, 0, memo), L(p.at, 'Customer receivable', 0, p.amount, memo));
    else out.push(L(p.at, 'Customer receivable', -p.amount, 0, memo), L(p.at, acct, 0, -p.amount, memo));
  }
  if (s.allocation) {
    const memo = `Allocated ${s.allocation.courierName} ${s.allocation.awb}`;
    out.push(L(s.allocation.allocatedAt, 'Courier cost', s.allocation.partnerCost, 0, memo), L(s.allocation.allocatedAt, 'Aggregator payable', 0, s.allocation.partnerCost, memo));
  }
  return out;
}

export function trialBalance(entries: LedgerEntry[]) {
  const byAccount = new Map<LedgerAccount, { debit: number; credit: number }>();
  for (const e of entries) {
    const a = byAccount.get(e.account) ?? { debit: 0, credit: 0 };
    a.debit = r2(a.debit + e.debit); a.credit = r2(a.credit + e.credit);
    byAccount.set(e.account, a);
  }
  const rows = [...byAccount.entries()].map(([account, v]) => ({ account, ...v, balance: r2(v.debit - v.credit) }));
  const debit = r2(rows.reduce((s, r) => s + r.debit, 0));
  const credit = r2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, debit, credit, balanced: Math.abs(debit - credit) < 0.01 };
}
