import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DEMO_AGGREGATOR, DEMO_BRANCHES, DEMO_CUSTOMERS, DEMO_SHIPMENTS, DEMO_STAFF, ledgerFor, receiptNumber, type LedgerAccount } from '@veer/core';
import type { Role } from '../common/roles';
import { invoiceAmounts } from '../modules/ledger/journals';
import {
  AllocationConflictError, DuplicateEmailError,
  type CompanySettings, type ContactRecord, type InvoiceRecord,
  type AggregatorRecord, type AuditQuery, type AuditRecord, type BranchRecord, type JournalLine, type LedgerAccountCode, type LedgerRow,
  type NewAllocation, type NewCollection, type NewEvent, type NewShipment, type NewStaff, type PaymentRec, type Repository,
  type ShipmentRecord, type StaffRecord, type UserRecord,
} from './repository';

export const DEMO_PASSWORD = 'Demo@123';

export const ACCOUNT_CODE: Record<LedgerAccount, LedgerAccountCode> = {
  'Customer receivable': 'CUSTOMER_RECEIVABLE', 'Freight revenue': 'FREIGHT_REVENUE', 'GST payable': 'GST_PAYABLE', 'Branch cash': 'BRANCH_CASH',
  'Payment gateway clearing': 'GATEWAY_CLEARING', 'Courier cost': 'COURIER_COST', 'Aggregator payable': 'AGGREGATOR_PAYABLE',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Calendar date in India for an ISO timestamp. */
const istDate = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600e3).toISOString().slice(0, 10);
const fyOf = (iso: string) => { const d = istDate(iso); const y = Number(d.slice(2, 4)); return Number(d.slice(5, 7)) >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };
const COUNTER = new Set(['CASH', 'COUNTER_UPI', 'COUNTER_CARD']);
const OPEN = (s: ShipmentRecord) => s.status !== 'DELIVERED' && s.status !== 'CANCELLED' as string;

/** In-memory store for DEMO MODE ONLY. Seeded from @veer/core demo data; resets on restart. */
export class MemoryRepository implements Repository {
  private users: UserRecord[];
  private shipments: ShipmentRecord[];
  private branches: BranchRecord[];
  private ledger: LedgerRow[] = [];
  private receiptSeq: Record<string, number> = {};
  /** Allocation history (superseded rows are kept, never deleted). */
  private allocationHistory: { shipmentId: string; supersededAt: string | null; supersededBy: string | null; reason: string | null }[] = [];
  private aggregators: AggregatorRecord[] = [{ code: 'DEMO_AGG', name: DEMO_AGGREGATOR, mode: 'MANUAL', portalUrl: null, isDemo: true }];
  readonly auditLog: AuditRecord[] = [];
  private company: CompanySettings = { legalName: 'Veer Express Courier', gstin: null, address: null, stateCode: null, invoicePrefix: 'VX' };
  private invoices: InvoiceRecord[] = [];
  private invoiceSeq: Record<string, number> = {};
  private contacts: (ContactRecord & { branchId: string })[] = [];

  constructor() {
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
    this.users = [
      ...DEMO_STAFF.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role as Role, branchId: u.branchId, passwordHash: hash, active: true })),
      { id: 'U7', email: 'ops@demo.veer', name: 'Demo Operations Executive', role: 'ADMIN', branchId: null, passwordHash: hash, active: true },
    ];
    this.branches = DEMO_BRANCHES.map((b) => ({ id: b.id, name: b.name, city: b.city }));
    // sample address book (demo customers have masked phones, so a demo number is derived from the id)
    const DEMO_PIN: Record<string, string> = { Kamothe: '410209', Kharghar: '410210', Panvel: '410206', Vashi: '400703', Nerul: '400706' };
    this.contacts = DEMO_CUSTOMERS.map((c, i) => ({
      id: randomUUID(), branchId: c.branchId, name: c.name, phone: `98000000${c.id.slice(-2)}`, email: null,
      address: `Demo address ${i + 1}, ${c.city}`, pin: DEMO_PIN[c.city] ?? '410209', useCount: 10 - i, lastUsedAt: new Date(Date.now() - i * 86400e3).toISOString(),
    }));
    let demoInvoice = 0;
    this.shipments = DEMO_SHIPMENTS.map((s) => {
      const rec: ShipmentRecord = {
        id: randomUUID(), trackingNumber: s.trackingNumber, bookedAt: s.bookedAt, branchId: s.branchId, customerId: s.customerId,
        origin: s.origin, destination: s.destination, originPin: s.originPin, destPin: s.destPin, status: s.status, service: s.service,
        chargeableWeightKg: s.weightKg, amount: s.amount, estimatedPartnerCost: s.estimatedPartnerCost,
        allocation: s.allocation && {
          aggregatorCode: 'DEMO_AGG', aggregator: s.allocation.aggregator, aggregatorRef: s.allocation.aggregatorRef, courierName: s.allocation.courierName,
          partnerCode: s.partnerCode, awb: s.allocation.awb, partnerCost: s.allocation.partnerCost, allocatedBy: s.allocation.allocatedBy, allocatedAt: s.allocation.allocatedAt,
        },
        payments: s.payments.filter((p) => p.method !== 'CREDIT_ACCOUNT').map((p) => ({
          id: p.id, method: p.method as PaymentRec['method'], amount: p.amount, at: p.at, receiptNo: p.receiptNo, reference: p.reference, collectedBy: p.collectedBy, simulated: true,
        })),
        eta: s.eta, paymentMode: s.paymentMode, isDemo: true, invoiceNumber: null,
        events: s.events.map((e) => ({ status: e.status, at: e.at, location: e.location, note: e.note, recordedAt: e.recordedAt, recordedBy: e.source === 'MANUAL' ? e.recordedBy : null, source: e.source })),
      };
      for (const p of s.payments) if (p.receiptNo) this.receiptSeq[s.branchId] = Math.max(this.receiptSeq[s.branchId] ?? 0, Number(p.receiptNo.slice(-6)));
      if (s.allocation) this.allocationHistory.push({ shipmentId: rec.id, supersededAt: null, supersededBy: null, reason: null });
      // one journal per business event, as the seed script writes to Postgres
      const journals = new Map<string, JournalLine[]>();
      for (const e of ledgerFor(s)) {
        const k = `${e.at}|${e.memo}`;
        journals.set(k, [...(journals.get(k) ?? []), { account: ACCOUNT_CODE[e.account], debit: e.debit, credit: e.credit, memo: e.memo }]);
      }
      for (const [k, lines] of journals) {
        const receiptNo = rec.payments.find((p) => p.receiptNo && lines[0].memo.includes(p.receiptNo))?.receiptNo ?? null;
        this.post(rec, lines, k.split('|')[0], receiptNo);
      }
      this.issueDemoBilling(rec, `DEMO/26-27/${String(++demoInvoice).padStart(5, '0')}`);
      return rec;
    }).sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
  }

  /** Invoice for a booking — same rules as Postgres. */
  private issueDemoBilling(s: ShipmentRecord, number: string) {
    const iv = invoiceAmounts(s.amount);
    this.invoices.unshift({
      ...iv, number, issuedAt: s.bookedAt, branchId: s.branchId, trackingNumber: s.trackingNumber, isTaxInvoice: !!this.company.gstin,
      sellerLegalName: this.company.legalName, sellerGstin: this.company.gstin, isDemo: s.isDemo, customer: null, origin: s.origin, destination: s.destination,
    });
    s.invoiceNumber = number;
  }

  private post(s: ShipmentRecord, lines: JournalLine[], at: string, receiptNo: string | null) {
    const debit = r2(lines.reduce((t, l) => t + l.debit, 0)); const credit = r2(lines.reduce((t, l) => t + l.credit, 0));
    if (Math.abs(debit - credit) >= 0.01 || lines.some((l) => (l.debit > 0) === (l.credit > 0))) throw new Error('Ledger journal is not balanced');
    const journalId = randomUUID();
    for (const l of lines) this.ledger.push({ ...l, journalId, postedAt: at, branchId: s.branchId, trackingNumber: s.trackingNumber, receiptNo });
  }

  private userName(id: string | null) { return id ? this.users.find((u) => u.id === id)?.name ?? null : null; }

  async findUserByEmail(email: string) { return this.users.find((u) => u.email === email.toLowerCase()) ?? null; }
  private toStaff = ({ passwordHash: _h, ...u }: UserRecord): StaffRecord => u;
  async findUserById(id: string) { const u = this.users.find((x) => x.id === id); return u ? this.toStaff(u) : null; }
  async listStaff(branchId: string | null) { return this.users.filter((u) => !branchId || u.branchId === branchId).map(this.toStaff); }
  async createStaff(s: NewStaff) {
    if (this.users.some((u) => u.email === s.email.toLowerCase())) throw new DuplicateEmailError();
    const u: UserRecord = { id: randomUUID(), email: s.email.toLowerCase(), name: s.name, role: s.role, branchId: s.branchId, passwordHash: s.passwordHash, active: true };
    this.users.push(u);
    return this.toStaff(u);
  }
  async setStaffActive(id: string, active: boolean) { const u = this.users.find((x) => x.id === id); if (u) u.active = active; }
  async branchExists(id: string) { return this.branches.some((b) => b.id === id); }
  async listAudit({ entity, action, limit, offset }: AuditQuery) {
    const rows = this.auditLog.filter((a) => (!entity || a.entity === entity) && (!action || a.action === action));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }

  async listShipments({ branchId, status, q, allocated, open, limit, offset }: Parameters<Repository['listShipments']>[0]) {
    const needle = q?.toLowerCase();
    const rows = this.shipments
      .filter((s) => (!branchId || s.branchId === branchId) && (!status || s.status === status)
        && (allocated === undefined || !!s.allocation === allocated) && (!open || OPEN(s))
        && (!needle || `${s.trackingNumber} ${s.origin} ${s.destination}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }

  async findShipment(tn: string, branchId: string | null) {
    return this.shipments.find((s) => s.trackingNumber === tn && (!branchId || s.branchId === branchId)) ?? null;
  }
  async findByPartnerAwb(code: string, awb: string) { return this.shipments.find((s) => s.allocation?.partnerCode === code && s.allocation.awb === awb) ?? null; }
  async trackingNumberExists(tn: string) { return this.shipments.some((s) => s.trackingNumber === tn); }

  async createShipment(n: NewShipment) {
    if (!this.branches.some((b) => b.id === n.branchId)) throw new Error('Unknown branch');
    const { sender, receiver, package: _p, payment, journals, createdBy: _c, saveContacts, invoice: _i, ...rest } = n;
    if (saveContacts) {
      for (const [p, pin] of [[sender, n.originPin], [receiver, n.destPin]] as const) {
        const hit = this.contacts.find((c) => c.branchId === n.branchId && c.phone === p.phone && c.name === p.name);
        if (hit) Object.assign(hit, { address: p.address, pin, email: p.email ?? hit.email, useCount: hit.useCount + 1, lastUsedAt: new Date().toISOString() });
        else this.contacts.push({ id: randomUUID(), branchId: n.branchId, name: p.name, phone: p.phone, email: p.email ?? null, address: p.address, pin, useCount: 1, lastUsedAt: new Date().toISOString() });
      }
    }
    const rec: ShipmentRecord = {
      ...rest, id: randomUUID(), allocation: null, payments: [], invoiceNumber: null,
      events: [{ status: 'BOOKED', at: n.bookedAt, location: n.origin, note: 'Shipment booked', recordedAt: n.bookedAt, recordedBy: null, source: 'SYSTEM' }],
    };
    if (payment) {
      const counter = payment.method === 'CASH' || payment.method === 'COUNTER_UPI' || payment.method === 'COUNTER_CARD';
      rec.payments.push({
        id: randomUUID(), method: payment.method, amount: payment.amount, at: n.bookedAt, simulated: payment.simulated,
        receiptNo: counter ? this.nextReceipt(n.branchId) : null, reference: payment.gatewayRef, collectedBy: counter ? this.userName(payment.collectedBy) : 'Payment gateway',
      });
    }
    for (const j of journals) this.post(rec, j, n.bookedAt, rec.payments[0]?.receiptNo ?? null);
    const fy = fyOf(n.bookedAt);
    this.invoiceSeq[fy] = (this.invoiceSeq[fy] ?? 0) + 1;
    this.issueDemoBilling(rec, `${this.company.invoicePrefix}/${fy}/${String(this.invoiceSeq[fy]).padStart(5, '0')}`);
    this.invoices[0].customer = { ...n.sender };
    this.shipments.unshift(rec);
    return rec;
  }

  private nextReceipt(branchId: string) {
    this.receiptSeq[branchId] = (this.receiptSeq[branchId] ?? 0) + 1;
    return receiptNumber(branchId, this.receiptSeq[branchId]);
  }

  async addEvent(id: string, e: NewEvent) {
    const s = this.shipments.find((x) => x.id === id);
    if (!s) throw new Error('Shipment not found');
    if (e.source === 'MANUAL' && (!e.recordedBy || !e.verified)) throw new Error('Manual tracking updates must be recorded by staff and verified');
    s.events.push({ status: e.status, at: e.at, location: e.location, note: e.note, recordedAt: new Date().toISOString(), recordedBy: this.userName(e.recordedBy), source: e.source });
    s.status = e.status;
    if (e.status === 'DELIVERED') s.eta = null;
  }

  async listAggregators() { return this.aggregators; }

  async allocate(id: string, a: NewAllocation, journal: JournalLine[]) {
    const s = this.shipments.find((x) => x.id === id);
    if (!s) throw new Error('Shipment not found');
    const agg = this.aggregators.find((x) => x.code === a.aggregatorCode);
    if (!agg) throw new Error('Unknown aggregator');
    const clash = this.shipments.find((x) => x.id !== id && x.allocation && x.allocation.awb === a.awb && x.allocation.courierName.toLowerCase() === a.courierName.toLowerCase());
    if (clash) throw new AllocationConflictError('This AWB is already allocated to another shipment');
    const now = new Date().toISOString();
    for (const h of this.allocationHistory) if (h.shipmentId === id && !h.supersededAt) Object.assign(h, { supersededAt: now, supersededBy: a.userId, reason: a.reason });
    this.allocationHistory.push({ shipmentId: id, supersededAt: null, supersededBy: null, reason: null });
    this.post(s, journal, now, null);
    s.allocation = {
      aggregatorCode: agg.code, aggregator: agg.name, aggregatorRef: a.aggregatorRef, courierName: a.courierName, partnerCode: null,
      awb: a.awb, partnerCost: a.partnerCost, allocatedBy: this.userName(a.userId), allocatedAt: now,
    };
  }

  async collect(id: string, c: NewCollection, journal: (receiptNo: string) => JournalLine[]) {
    const s = this.shipments.find((x) => x.id === id);
    if (!s) throw new Error('Shipment not found');
    const receiptNo = this.nextReceipt(s.branchId);
    const now = new Date().toISOString();
    const p: PaymentRec = { id: randomUUID(), method: c.method, amount: c.amount, at: now, receiptNo, reference: c.reference, collectedBy: this.userName(c.userId), simulated: c.simulated };
    this.post(s, journal(receiptNo), now, receiptNo);
    s.payments.push(p);
    return p;
  }


  // ------------------------------------------------------------ billing

  async searchContacts(branchId: string | null, q: string, limit: number) {
    const term = q.trim().toLowerCase(); const digits = term.replace(/\D/g, '');
    return this.contacts
      .filter((c) => (!branchId || c.branchId === branchId) && (c.name.toLowerCase().startsWith(term) || c.name.toLowerCase().includes(` ${term}`) || (!!digits && c.phone.startsWith(digits))))
      .sort((a, b) => b.useCount - a.useCount || b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, limit).map(({ branchId: _b, ...c }) => ({ ...c }));
  }
  async pincodeOffices(_pin: string) { return []; } // demo mode: no local directory; the India Post lookup is used
  async getCompany() { return { ...this.company }; }
  async setCompany(c: Omit<CompanySettings, 'invoicePrefix'>) { this.company = { ...this.company, ...c }; return this.getCompany(); }
  async listInvoices({ branchId, limit, offset }: { branchId: string | null; limit: number; offset: number }) {
    const rows = this.invoices.filter((i) => !branchId || i.branchId === branchId);
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }
  async findInvoice(number: string, branchId: string | null) { return this.invoices.find((i) => i.number === number && (!branchId || i.branchId === branchId)) ?? null; }
  async listLedger({ branchId, limit, offset }: { branchId: string | null; limit: number; offset: number }) {
    const rows = this.ledger.filter((l) => !branchId || l.branchId === branchId).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }
  async trialBalance(branchId: string | null) {
    const m = new Map<LedgerAccountCode, { debit: number; credit: number }>();
    for (const l of this.ledger) {
      if (branchId && l.branchId !== branchId) continue;
      const a = m.get(l.account) ?? { debit: 0, credit: 0 };
      a.debit = r2(a.debit + l.debit); a.credit = r2(a.credit + l.credit); m.set(l.account, a);
    }
    return [...m].map(([account, v]) => ({ account, ...v }));
  }

  async listBranches(branchId: string | null) { return this.branches.filter((b) => !branchId || b.id === branchId); }
  async audit(e: { userId: string | null; action: string; entity: string; entityId: string; detail?: unknown }) {
    this.auditLog.unshift({ at: new Date().toISOString(), userId: e.userId, userName: this.userName(e.userId), action: e.action, entity: e.entity, entityId: e.entityId, detail: e.detail ?? null });
  }
}
