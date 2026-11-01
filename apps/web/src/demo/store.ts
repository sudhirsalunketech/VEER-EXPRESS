/**
 * DEMO MODE data service — sample data kept in this browser (localStorage).
 * Mirrors the operations the production API will expose. No real bookings, courier
 * allocations, payments or notifications happen here.
 */
import {
  DEMO_AGGREGATOR, DEMO_BRANCHES, DEMO_CUSTOMERS, DEMO_SHIPMENTS, STATUS_LABEL, balanceDue, generateTrackingNumber,
  ledgerFor, paymentStatus, receiptNumber, validateAllocation, validateCollection, validateTrackingUpdate,
  type AllocationInput, type CollectionInput, type DemoShipment, type InternalQuote, type PaymentRecord,
  type TrackingUpdateInput, type UnifiedStatus,
} from '@veer/core';

const KEY = 'veer-demo-shipments-v3'; // v3: single branch (Kamothe)
const NKEY = 'veer-demo-notifications-v2';
const AKEY = 'veer-demo-audit-v2';

export const IS_DEMO = (import.meta.env.VITE_APP_MODE ?? 'demo') === 'demo';

function read<T>(key: string, fallback: () => T): T {
  try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw) as T; } catch { /* storage unavailable */ }
  return fallback();
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

function load(): DemoShipment[] { return read(KEY, () => structuredClone(DEMO_SHIPMENTS)); }
function save(list: DemoShipment[]) { write(KEY, list); }

// ---------------------------------------------------------------- notifications & audit

export interface DemoNotification { at: string; channel: 'WhatsApp' | 'SMS' | 'Email'; to: string; template: string; body: string }
export function notifications(): DemoNotification[] { return read(NKEY, () => []); }
function notify(n: DemoNotification) { write(NKEY, [n, ...notifications()].slice(0, 50)); }

export interface AuditEntry { at: string; who: string; role: string; action: string; ref: string; detail: string }
const SEED_AUDIT: AuditEntry[] = [
  { at: new Date(Date.now() - 26 * 3600e3).toISOString(), who: 'Demo Admin', role: 'ADMIN', action: 'RATE_CARD.UPDATE', ref: 'DTDC', detail: 'Fuel surcharge 9% → 10% (sample)' },
  { at: new Date(Date.now() - 30 * 3600e3).toISOString(), who: 'Demo Accountant', role: 'ACCOUNTANT', action: 'LEDGER.EXPORT', ref: 'BR-KMT', detail: 'October ledger exported (sample)' },
];
export function auditLog(): AuditEntry[] { return read(AKEY, () => SEED_AUDIT); }
function audit(user: DemoUser, action: string, ref: string, detail: string) {
  write(AKEY, [{ at: new Date().toISOString(), who: user.name, role: user.role, action, ref, detail }, ...auditLog()].slice(0, 300));
}

// ---------------------------------------------------------------- customer-safe view

export interface PublicTracking {
  trackingNumber: string; bookedAt: string; origin: string; destination: string; status: UnifiedStatus;
  dispatched: boolean; eta: string | null; service: string; lastUpdatedAt: string;
  events: { status: UnifiedStatus; at: string; location: string; note: string }[];
}

function toPublic(s: DemoShipment): PublicTracking {
  return {
    trackingNumber: s.trackingNumber, bookedAt: s.bookedAt, origin: s.origin, destination: s.destination,
    status: s.status, dispatched: !!s.allocation, eta: s.eta, service: s.service,
    lastUpdatedAt: s.events.at(-1)!.recordedAt,
    // no courier name, AWB, aggregator ref, partner cost or staff names
    events: s.events.map(({ status, at, location, note }) => ({ status, at, location, note })),
  };
}

// ---------------------------------------------------------------- operations

export type BookingPaymentMode = DemoShipment['paymentMode'];
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function mutate<T>(tn: string, fn: (s: DemoShipment) => Result<T>): Result<T> {
  const list = load();
  const s = list.find((x) => x.trackingNumber === tn);
  if (!s) return fail('Shipment not found');
  const r = fn(s);
  if (r.ok) save(list);
  return r;
}

const ACCESS: Record<string, Role[]> = {
  allocate: ['SUPER_ADMIN', 'ADMIN'],
  track: ['SUPER_ADMIN', 'ADMIN'],
  collect: ['SUPER_ADMIN', 'ADMIN', 'BOOKING_STAFF'],
};
export const can = (user: DemoUser | null, op: keyof typeof ACCESS) => !!user && ACCESS[op].includes(user.role);
const inScope = (user: DemoUser, s: DemoShipment) => GLOBAL.includes(user.role) || s.branchId === user.branchId;

export const demo = {
  shipments(): DemoShipment[] { return load(); },
  branches: DEMO_BRANCHES,
  customers: DEMO_CUSTOMERS,
  aggregator: DEMO_AGGREGATOR,

  /** Public tracking — customer-safe fields only. */
  track(tn: string): PublicTracking | null {
    const s = load().find((x) => x.trackingNumber === tn.trim().toUpperCase());
    return s ? toPublic(s) : null;
  },

  /** Booking creates the Veer shipment only. Courier allocation happens later by operations staff. */
  book(input: {
    quote: InternalQuote; originCity: string; destCity: string; originPin: string; destPin: string;
    paymentMode: BookingPaymentMode; senderPhone: string; senderName: string; branchId?: string; staffName?: string; senderEmail?: string | null;
  }): DemoShipment {
    const list = load();
    let tn = generateTrackingNumber();
    while (list.some((s) => s.trackingNumber === tn)) tn = generateTrackingNumber();
    const now = new Date().toISOString();
    const branchId = input.branchId ?? 'BR-KMT';
    const payments: PaymentRecord[] = [];
    if (input.paymentMode === 'UPI' || input.paymentMode === 'ONLINE') {
      payments.push({ id: `PAY-${tn.slice(-6)}`, method: input.paymentMode === 'UPI' ? 'UPI_GATEWAY' : 'ONLINE_GATEWAY', amount: input.quote.total, at: now, receiptNo: null, reference: `pay_sim_${tn.slice(-8)}`, collectedBy: 'Payment gateway', simulated: true });
    } else if (input.paymentMode === 'CASH') {
      payments.push({ id: `PAY-${tn.slice(-6)}`, method: 'CASH', amount: input.quote.total, at: now, receiptNo: nextReceipt(list, branchId), reference: null, collectedBy: input.staffName ?? 'Counter staff', simulated: true });
    }
    const s: DemoShipment = {
      trackingNumber: tn, bookedAt: now, customerId: 'WEB', branchId,
      origin: input.originCity, destination: input.destCity, originPin: input.originPin, destPin: input.destPin,
      status: 'BOOKED', service: input.quote.service, weightKg: input.quote.chargeableWeightKg, amount: input.quote.total,
      partnerCode: '', partnerAwb: '', partnerCost: 0,
      eta: new Date(Date.now() + input.quote.estimatedDays * 86400e3).toISOString().slice(0, 10),
      paymentMode: input.paymentMode,
      events: [{ status: 'BOOKED', at: now, location: input.originCity, note: 'Shipment booked', recordedAt: now, recordedBy: 'System (booking)', source: 'SYSTEM' }],
      allocation: null, payments, estimatedPartnerCost: input.quote.partnerCost,
    };
    save([s, ...list]);
    const to = input.senderPhone.replace(/\d(?=\d{2})/g, 'x');
    notify({ at: now, channel: 'WhatsApp', to, template: 'booking_confirmation', body: `Hi ${input.senderName}, your Veer Express shipment ${tn} is booked. Track: /track?tn=${tn}` });
    if (input.senderEmail) notify({ at: now, channel: 'Email', to: input.senderEmail.replace(/^(.)[^@]*(@.*)$/, '$1***$2'), template: 'booking_email', body: `[DEMO — not sent] Bill for ${tn}: Rs ${input.quote.total.toFixed(2)}. Track: /track?tn=${tn}` });
    if (payments.length) notify({ at: now, channel: 'SMS', to, template: 'payment_confirmation', body: `[DEMO] Payment of Rs ${input.quote.total.toFixed(2)} recorded (simulated) for ${tn}.` });
    return s;
  },

  /** Record the aggregator booking (ref, courier, AWB, cost). Re-allocation keeps an audit trail. */
  allocate(user: DemoUser, tn: string, a: AllocationInput): Result<DemoShipment> {
    if (!can(user, 'allocate')) return fail('Only operations staff can allocate couriers');
    const err = validateAllocation(a);
    if (err) return fail(err);
    return mutate(tn, (s) => {
      if (s.status === 'DELIVERED') return fail('Delivered shipments cannot be re-allocated');
      const prev = s.allocation;
      s.allocation = { aggregator: DEMO_AGGREGATOR, aggregatorRef: a.aggregatorRef.trim(), courierName: a.courierName.trim(), awb: a.awb.trim().toUpperCase(), partnerCost: Math.round(a.partnerCost * 100) / 100, allocatedBy: user.name, allocatedAt: new Date().toISOString() };
      audit(user, prev ? 'SHIPMENT.REALLOCATE' : 'SHIPMENT.ALLOCATE', tn,
        `${prev ? `${prev.courierName} ${prev.awb} → ` : ''}${s.allocation.courierName} ${s.allocation.awb} · ref ${s.allocation.aggregatorRef} · cost ₹${s.allocation.partnerCost}`);
      return { ok: true, value: s };
    });
  },

  /** Staff-entered tracking update, verified against the courier's tracking page. */
  addTrackingUpdate(user: DemoUser, tn: string, u: TrackingUpdateInput): Result<DemoShipment> {
    if (!can(user, 'track')) return fail('Only operations staff can record tracking updates');
    return mutate(tn, (s) => {
      const err = validateTrackingUpdate({ status: s.status, events: s.events, allocated: !!s.allocation }, u);
      if (err) return fail(err);
      const now = new Date().toISOString();
      const note = u.remarks.trim() || STATUS_LABEL[u.status];
      s.events.push({ status: u.status, at: new Date(u.occurredAt).toISOString(), location: u.location.trim(), note, recordedAt: now, recordedBy: user.name, source: 'MANUAL' });
      s.status = u.status;
      if (u.status === 'DELIVERED') s.eta = null;
      audit(user, 'TRACKING.UPDATE', tn, `${STATUS_LABEL[u.status]} · ${u.location.trim()} · occurred ${new Date(u.occurredAt).toLocaleString('en-IN')}`);
      notify({ at: now, channel: 'WhatsApp', to: 'customer', template: u.status.toLowerCase(), body: `Your Veer Express shipment ${tn}: ${STATUS_LABEL[u.status]}.` });
      return { ok: true, value: s };
    });
  },

  /** Counter collection with a branch receipt number. Does not change shipment status. */
  collect(user: DemoUser, tn: string, c: CollectionInput): Result<{ shipment: DemoShipment; payment: PaymentRecord }> {
    if (!can(user, 'collect')) return fail('Your role cannot record collections');
    const list = load();
    const s = list.find((x) => x.trackingNumber === tn);
    if (!s || !inScope(user, s)) return fail('Shipment not found');
    const due = balanceDue(s.amount, s.payments);
    const err = validateCollection(due, c);
    if (err) return fail(err);
    const p: PaymentRecord = {
      id: `PAY-${tn.slice(-6)}-${s.payments.length + 1}`, method: c.method, amount: Math.round(c.amount * 100) / 100,
      at: new Date().toISOString(), receiptNo: nextReceipt(list, s.branchId), reference: c.reference.trim() || null,
      collectedBy: user.name, simulated: true,
    };
    s.payments.push(p);
    save(list);
    audit(user, 'PAYMENT.COLLECT', tn, `${p.receiptNo} · ${c.method} · ₹${p.amount.toFixed(2)}`);
    return { ok: true, value: { shipment: s, payment: p } };
  },

  ledger(list: DemoShipment[]) { return list.flatMap((s) => ledgerFor(s)).sort((a, b) => b.at.localeCompare(a.at)); },

  reset() { for (const k of [KEY, NKEY, AKEY, CKEY]) { try { localStorage.removeItem(k); } catch { /* ignore */ } } },
};

function nextReceipt(list: DemoShipment[], branchId: string) {
  const n = list.filter((s) => s.branchId === branchId).flatMap((s) => s.payments).filter((p) => p.receiptNo).length;
  return receiptNumber(branchId, n + 1);
}

export const payStatus = (s: DemoShipment) => paymentStatus(s.amount, s.payments);

// ---------------------------------------------------------------- branch address book (staff, demo)

export interface Contact { id: string; name: string; phone: string; email: string | null; address: string; pin: string; useCount: number; lastUsedAt: string }
const CKEY = 'veer-demo-contacts-v2';
type BranchContact = Contact & { branchId: string };
const DEMO_PIN: Record<string, string> = { Kamothe: '410209', Kharghar: '410210', Panvel: '410206', Vashi: '400703', Nerul: '400706' };
function contacts(): BranchContact[] {
  return read(CKEY, () => DEMO_CUSTOMERS.map((c, i) => ({
    id: c.id, branchId: c.branchId, name: c.name, phone: `98000000${c.id.slice(-2)}`, email: null,
    address: `Demo address ${i + 1}, ${c.city}`, pin: DEMO_PIN[c.city] ?? '410209', useCount: 10 - i, lastUsedAt: new Date(Date.now() - i * 86400e3).toISOString(),
  })));
}
/** Same rules as the API: one entry per person per branch, latest address wins. */
export function saveDemoContact(branchId: string, p: { name: string; phone: string; email?: string | null; address: string }, pin: string) {
  const list = contacts();
  const hit = list.find((c) => c.branchId === branchId && c.phone === p.phone && c.name === p.name);
  if (hit) Object.assign(hit, { address: p.address, pin, email: p.email || hit.email, useCount: hit.useCount + 1, lastUsedAt: new Date().toISOString() });
  else list.push({ id: `CT-${Date.now()}-${list.length}`, branchId, name: p.name, phone: p.phone, email: p.email || null, address: p.address, pin, useCount: 1, lastUsedAt: new Date().toISOString() });
  write(CKEY, list);
}
export function searchDemoContacts(branchId: string | null, q: string): Contact[] {
  const t = q.trim().toLowerCase(); const d = t.replace(/\D/g, '');
  return contacts()
    .filter((c) => (!branchId || c.branchId === branchId) && (c.name.toLowerCase().startsWith(t) || c.name.toLowerCase().includes(` ${t}`) || (!!d && c.phone.startsWith(d))))
    .sort((a, b) => b.useCount - a.useCount).slice(0, 8).map(({ branchId: _b, ...c }) => c);
}

// ---------------------------------------------------------------- demo auth

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'BOOKING_STAFF' | 'ACCOUNTANT' | 'CUSTOMER';
export interface DemoUser { name: string; role: Role; branchId: string | null }
const GLOBAL: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];

export const DEMO_LOGINS: (DemoUser & { email: string; password: string })[] = [
  { email: 'admin@demo.veer', password: 'Demo@123', name: 'Demo Super Admin', role: 'SUPER_ADMIN', branchId: null },
  { email: 'staff@demo.veer', password: 'Demo@123', name: 'Demo Counter Staff — Kamothe', role: 'BOOKING_STAFF', branchId: 'BR-KMT' },
  { email: 'accounts@demo.veer', password: 'Demo@123', name: 'Demo Accountant', role: 'ACCOUNTANT', branchId: null },
];
/** Presenter identity used by embedded demos on the presentation page. */
export const PRESENTER: DemoUser = { name: 'Demo Super Admin', role: 'SUPER_ADMIN', branchId: null };

export function currentUser(): DemoUser | null {
  try { return JSON.parse(sessionStorage.getItem('veer-demo-user') ?? 'null'); } catch { return null; }
}
export function signIn(u: DemoUser) { try { sessionStorage.setItem('veer-demo-user', JSON.stringify(u)); } catch { /* ignore */ } }
export function signOut() { try { sessionStorage.removeItem('veer-demo-user'); } catch { /* ignore */ } }

/** Branch scoping — mirrors the server-side rule. */
export function scopeShipments(user: DemoUser | null, list: DemoShipment[]) {
  if (!user) return [];
  if (GLOBAL.includes(user.role)) return list;
  return list.filter((s) => s.branchId === user.branchId);
}
