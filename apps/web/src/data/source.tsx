/**
 * One data interface for the staff consoles, booking and tracking, with two implementations:
 *  - demo: sample data in this browser (src/demo/store.ts) — used by the presentation page and demo builds
 *  - live: the NestJS API (VITE_APP_MODE=live)
 * Screens read the active source from context, so the presentation page can always embed the demo
 * even in a live build. The browser only ever holds the signed-in user's own short-lived token.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  STATUS_LABEL, type AllocationInput, type CollectionInput, type DemoShipment, type InternalQuote, type LedgerAccount, type LedgerEntry,
  type PaymentRecord, type TrackingUpdateInput, type UnifiedStatus,
} from '@veer/core';
import {
  auditLog, currentUser as demoCurrentUser, demo, saveDemoContact, searchDemoContacts, type Contact, signIn as demoSignIn, signOut as demoSignOut,
  type AuditEntry, type DemoUser, type PublicTracking,
} from '../demo/store';
import { ApiError, call, setToken } from '../lib/api';

export const LIVE = import.meta.env.VITE_APP_MODE === 'live';
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface BookingRequest {
  quote: InternalQuote;
  body: {
    originPin: string; destPin: string; actualWeightKg: number; dims: { lengthCm: number; widthCm: number; heightCm: number };
    service: string; declaredValue: number; insurance: boolean; kind: string; packageType: string;
    sender: { name: string; phone: string; address: string; email?: string | null }; receiver: { name: string; phone: string; address: string; email?: string | null };
    originCity: string; destCity: string; paymentMode: DemoShipment['paymentMode'];
  };
  staff?: DemoUser;
}
export interface BookingResult {
  trackingNumber: string; total: number; paid: boolean; simulated: boolean; receiptNo: string | null;
  /** NONE = no e-mail given; SIMULATED = prepared but no e-mail service connected; SENT; FAILED. */
  emailStatus: 'NONE' | 'SIMULATED' | 'SENT' | 'FAILED'; emailTo: string | null;
}

export interface DataSource {
  kind: 'demo' | 'live';
  shipments(user: DemoUser): Promise<DemoShipment[]>;
  track(tn: string): Promise<PublicTracking | null>;
  book(r: BookingRequest): Promise<Result<BookingResult>>;
  allocate(user: DemoUser, tn: string, a: AllocationInput & { reason?: string }): Promise<Result<DemoShipment>>;
  addTrackingUpdate(user: DemoUser, tn: string, u: TrackingUpdateInput): Promise<Result<DemoShipment>>;
  collect(user: DemoUser, tn: string, c: CollectionInput): Promise<Result<{ shipment: DemoShipment; payment: PaymentRecord }>>;
  ledger(list: DemoShipment[]): Promise<LedgerEntry[]>;
  audit(): Promise<AuditEntry[]>;
  /** Branch address book (counter staff only). */
  searchContacts(user: DemoUser, q: string): Promise<Contact[]>;
}

// ---------------------------------------------------------------- demo

const GLOBAL = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];

export const demoSource: DataSource = {
  kind: 'demo',
  async shipments(user) { const all = demo.shipments(); return GLOBAL.includes(user.role) ? all : all.filter((s) => s.branchId === user.branchId); },
  async track(tn) { return demo.track(tn); },
  async book({ quote, body, staff }) {
    await new Promise((r) => setTimeout(r, 1400)); // simulated gateway round-trip
    const s = demo.book({
      quote, originCity: body.originCity, destCity: body.destCity, originPin: body.originPin, destPin: body.destPin, paymentMode: body.paymentMode,
      senderPhone: body.sender.phone, senderName: body.sender.name, branchId: staff?.branchId ?? undefined, staffName: staff?.name, senderEmail: body.sender.email,
    });
    saveDemoContact(s.branchId, body.sender, body.originPin);
    saveDemoContact(s.branchId, body.receiver, body.destPin);
    const email = body.sender.email || null;
    return { ok: true, value: { trackingNumber: s.trackingNumber, total: s.amount, paid: s.payments.length > 0, simulated: true, receiptNo: s.payments[0]?.receiptNo ?? null, emailStatus: email ? 'SIMULATED' : 'NONE', emailTo: email } };
  },
  async allocate(user, tn, a) {
    if (demo.shipments().find((s) => s.trackingNumber === tn)?.allocation && (a.reason ?? '').trim().length < 5) return { ok: false, error: 'Give a reason to re-allocate this shipment' };
    return demo.allocate(user, tn, a);
  },
  async addTrackingUpdate(user, tn, u) { return demo.addTrackingUpdate(user, tn, u); },
  async collect(user, tn, c) { return demo.collect(user, tn, c); },
  async ledger(list) { return demo.ledger(list); },
  async audit() { return auditLog(); },
  async searchContacts(user, q) { return searchDemoContacts(GLOBAL.includes(user.role) ? null : user.branchId, q); },
};

// ---------------------------------------------------------------- live (NestJS API)

const ACCOUNT_LABEL: Record<string, LedgerAccount> = {
  CUSTOMER_RECEIVABLE: 'Customer receivable', FREIGHT_REVENUE: 'Freight revenue', GST_PAYABLE: 'GST payable', BRANCH_CASH: 'Branch cash',
  GATEWAY_CLEARING: 'Payment gateway clearing', COURIER_COST: 'Courier cost', AGGREGATOR_PAYABLE: 'Aggregator payable',
};

/** API staff shipment → the shape the screens use. Roles without cost access get a placeholder allocation with no courier details. */
interface ApiShipment {
  trackingNumber: string; bookedAt: string; branchId: string; customerId: string | null; origin: string; destination: string;
  originPin: string; destPin: string; status: UnifiedStatus; service: DemoShipment['service']; chargeableWeightKg: number; amount: number;
  eta: string | null; paymentMode: DemoShipment['paymentMode']; allocated: boolean; allocatedAt?: string | null; estimatedPartnerCost?: number | null;
  allocation?: { aggregator: string; aggregatorRef: string; courierName: string; partnerCode: string | null; awb: string; partnerCost: number; allocatedBy: string | null; allocatedAt: string } | null;
  payments: (Omit<PaymentRecord, 'collectedBy'> & { collectedBy: string | null })[];
  events: { status: UnifiedStatus; at: string; location: string; note: string; recordedAt: string; recordedBy: string | null; source: string }[];
}

function fromApi(s: ApiShipment): DemoShipment {
  const a = s.allocation;
  return {
    trackingNumber: s.trackingNumber, bookedAt: s.bookedAt, customerId: s.customerId ?? '', branchId: s.branchId,
    origin: s.origin, destination: s.destination, originPin: s.originPin, destPin: s.destPin, status: s.status, service: s.service,
    weightKg: s.chargeableWeightKg, amount: s.amount, partnerCode: a?.partnerCode ?? '', partnerAwb: a?.awb ?? '', partnerCost: a?.partnerCost ?? 0,
    eta: s.eta, paymentMode: s.paymentMode, estimatedPartnerCost: s.estimatedPartnerCost ?? 0,
    allocation: a ? { aggregator: a.aggregator, aggregatorRef: a.aggregatorRef, courierName: a.courierName, awb: a.awb, partnerCost: a.partnerCost, allocatedBy: a.allocatedBy ?? '', allocatedAt: a.allocatedAt }
      : s.allocated ? { aggregator: '', aggregatorRef: '', courierName: 'Allocated', awb: '', partnerCost: 0, allocatedBy: '', allocatedAt: s.allocatedAt ?? s.bookedAt } : null,
    payments: s.payments.map((p) => ({ ...p, collectedBy: p.collectedBy ?? '' })),
    events: s.events.map((e) => ({ status: e.status, at: e.at, location: e.location, note: e.note, recordedAt: e.recordedAt,
      recordedBy: e.recordedBy ?? 'System', source: e.source === 'MANUAL' ? 'MANUAL' : e.source === 'SYSTEM' ? 'SYSTEM' : 'API' })),
  };
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the Veer Express server. Check your connection and try again.');
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: errorText(e) }; }
}
const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const reload = async (tn: string) => fromApi(await call<ApiShipment>(`/shipments/${encodeURIComponent(tn)}`));

export const liveSource: DataSource = {
  kind: 'live',
  async shipments() {
    const out: ApiShipment[] = [];
    for (let page = 1; ; page++) {
      const r = await call<{ rows: ApiShipment[]; total: number }>(`/shipments?pageSize=100&page=${page}`);
      out.push(...r.rows);
      if (out.length >= r.total || r.rows.length === 0) break;
    }
    return out.map(fromApi);
  },
  async track(tn) {
    try {
      const t = await call<{ trackingNumber: string; bookedAt: string; origin: string; destination: string; status: UnifiedStatus; estimatedDelivery: string | null; dispatched: boolean; lastUpdatedAt: string; events: PublicTracking['events'] }>(
        `/public/track/${encodeURIComponent(tn.trim().toUpperCase())}`);
      return { trackingNumber: t.trackingNumber, bookedAt: t.bookedAt, origin: t.origin, destination: t.destination, status: t.status, dispatched: t.dispatched, eta: t.estimatedDelivery, service: '', lastUpdatedAt: t.lastUpdatedAt, events: t.events };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  book({ body, staff }) {
    return attempt(async () => {
      const r = await post<{ trackingNumber: string; quote: { total: number }; paymentStatus: string; receiptNo: string | null; simulatedPayment: boolean; emailStatus: BookingResult['emailStatus']; emailTo: string | null }>(staff ? '/shipments' : '/public/bookings', body);
      return { trackingNumber: r.trackingNumber, total: r.quote.total, paid: r.paymentStatus === 'PAID', simulated: r.simulatedPayment, receiptNo: r.receiptNo, emailStatus: r.emailStatus ?? 'NONE', emailTo: r.emailTo ?? null };
    });
  },
  allocate(_u, tn, a) { return attempt(async () => fromApi(await post<ApiShipment>(`/shipments/${tn}/allocation`, a))); },
  addTrackingUpdate(_u, tn, u) { return attempt(async () => fromApi(await post<ApiShipment>(`/shipments/${tn}/tracking`, u))); },
  collect(_u, tn, c) {
    return attempt(async () => {
      const r = await post<{ receipt: ApiShipment['payments'][number] }>(`/shipments/${tn}/payments`, c);
      return { shipment: await reload(tn), payment: { ...r.receipt, collectedBy: r.receipt.collectedBy ?? '' } };
    });
  },
  async ledger() {
    const out: LedgerEntry[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await call<{ rows: { postedAt: string; trackingNumber: string | null; account: string; debit: number; credit: number; memo: string; branchId: string }[]; total: number }>(`/ledger?pageSize=200&page=${page}`);
      out.push(...r.rows.map((l) => ({ at: l.postedAt, ref: l.trackingNumber ?? '', account: ACCOUNT_LABEL[l.account] ?? (l.account as LedgerAccount), debit: l.debit, credit: l.credit, memo: l.memo, branchId: l.branchId })));
      if (out.length >= r.total || r.rows.length === 0) break;
    }
    return out;
  },
  searchContacts(_u, q) { return call<Contact[]>(`/contacts?q=${encodeURIComponent(q)}`); },
  async audit() {
    const r = await call<{ rows: { at: string; userName: string | null; action: string; entityId: string; detail: unknown }[] }>('/audit?pageSize=200');
    return r.rows.map((a) => ({ at: a.at, who: a.userName ?? 'System', role: '', action: a.action, ref: a.entityId, detail: summarise(a.detail) }));
  },
};

function summarise(d: unknown): string {
  if (!d || typeof d !== 'object') return d ? String(d) : '';
  return Object.entries(d as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${k === 'to' || k === 'from' ? STATUS_LABEL[v as UnifiedStatus] ?? v : v}`).join(' · ');
}

// ---------------------------------------------------------------- context & hooks

const Ctx = createContext<DataSource>(LIVE ? liveSource : demoSource);
export const useData = () => useContext(Ctx);
/** Forces the sample-data source for embedded demos (the presentation page), even in a live build. */
export const DemoData = ({ children }: { children: ReactNode }) => <Ctx.Provider value={demoSource}>{children}</Ctx.Provider>;

/** Loads data from the active source; `refresh` reloads. Errors are shown, never swallowed. */
export function useLoad<T>(load: (src: DataSource) => Promise<T>, deps: unknown[], initial: T) {
  const src = useData();
  const [state, setState] = useState<{ value: T; loading: boolean; error: string }>({ value: initial, loading: true, error: '' });
  const [ver, setVer] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load(src).then((value) => live && setState({ value, loading: false, error: '' }), (e) => live && setState((s) => ({ ...s, loading: false, error: errorText(e) })));
    return () => { live = false; };
  }, [src, ver, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => setVer((v) => v + 1), []);
  return { ...state, refresh };
}

// ---------------------------------------------------------------- session

const SKEY = 'veer-live-session';
interface LiveSession { token: string; user: DemoUser & { id: string; email: string } }
function liveSession(): LiveSession | null {
  try { return JSON.parse(sessionStorage.getItem(SKEY) ?? 'null'); } catch { return null; }
}
setToken(LIVE ? liveSession()?.token ?? null : null);

export function currentUser(): DemoUser | null { return LIVE ? liveSession()?.user ?? null : demoCurrentUser(); }
export function signOut() {
  if (!LIVE) return demoSignOut();
  try { sessionStorage.removeItem(SKEY); } catch { /* ignore */ }
  setToken(null);
}
export { demoSignIn };

/** Live sign-in against the API. Returns the user so the caller can route to the right console. */
export async function liveSignIn(email: string, password: string): Promise<Result<DemoUser>> {
  return attempt(async () => {
    const r = await post<{ accessToken: string; user: { id: string; email: string; name: string; role: DemoUser['role']; branchId: string | null } }>('/auth/login', { email, password });
    const user = { id: r.user.id, name: r.user.name, role: r.user.role, branchId: r.user.branchId, email: r.user.email };
    try { sessionStorage.setItem(SKEY, JSON.stringify({ token: r.accessToken, user })); } catch { /* ignore */ }
    setToken(r.accessToken);
    return user;
  });
}

/** One branch, one staff console; the menu adapts to the role. */
export const consoleFor = (_u: DemoUser) => '/admin';
