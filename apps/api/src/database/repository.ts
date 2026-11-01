import type { ServiceType, UnifiedStatus } from '@veer/core';

/** Tracking event. `at` = when it happened; `recordedAt`/`recordedBy` = who entered it and when (audit). */
export interface ApiEvent { status: UnifiedStatus; at: string; location: string; note: string; recordedAt: string; recordedBy: string | null; source: string }
export interface NewEvent { status: UnifiedStatus; at: string; location: string; note: string; source: 'SYSTEM' | 'MANUAL' | 'PARTNER_WEBHOOK'; recordedBy: string | null; verified: boolean; rawStatus?: string }

/** Active courier allocation, recorded by staff after booking in the external aggregator account. */
export interface AllocationRecord {
  aggregatorCode: string; aggregator: string; aggregatorRef: string; courierName: string; partnerCode: string | null;
  awb: string; partnerCost: number; allocatedBy: string | null; allocatedAt: string;
}
export interface NewAllocation { aggregatorCode: string; aggregatorRef: string; courierName: string; awb: string; partnerCost: number; userId: string; reason: string | null }
export interface AggregatorRecord { code: string; name: string; mode: 'MANUAL' | 'API'; portalUrl: string | null; isDemo: boolean }

export type ApiPaymentMethod = 'ONLINE_GATEWAY' | 'UPI_GATEWAY' | 'CASH' | 'COUNTER_UPI' | 'COUNTER_CARD';
/** Money actually received (or refunded: negative amount). Pending dues are not payment records. */
export interface PaymentRec { id: string; method: ApiPaymentMethod; amount: number; at: string; receiptNo: string | null; reference: string | null; collectedBy: string | null; simulated: boolean }
export interface NewCollection { method: 'CASH' | 'COUNTER_UPI' | 'COUNTER_CARD'; amount: number; reference: string | null; userId: string; simulated: boolean }

export type LedgerAccountCode = 'CUSTOMER_RECEIVABLE' | 'FREIGHT_REVENUE' | 'GST_PAYABLE' | 'BRANCH_CASH' | 'GATEWAY_CLEARING' | 'COURIER_COST' | 'AGGREGATOR_PAYABLE';
/** One journal line. Every journal handed to the repository must balance; Postgres re-checks at commit. */
export interface JournalLine { account: LedgerAccountCode; debit: number; credit: number; memo: string }
export interface LedgerRow extends JournalLine { journalId: string; postedAt: string; branchId: string; trackingNumber: string | null; receiptNo: string | null }

export interface CompanySettings { legalName: string; gstin: string | null; address: string | null; stateCode: string | null; invoicePrefix: string }
/** Invoice amounts. GST is split CGST/SGST (B2C, intra-state place of supply) unless IGST is set. */
export interface InvoiceAmounts { taxable: number; cgst: number; sgst: number; igst: number; total: number }
export interface InvoiceRecord extends InvoiceAmounts {
  number: string; issuedAt: string; branchId: string; trackingNumber: string | null; isTaxInvoice: boolean;
  sellerLegalName: string | null; sellerGstin: string | null; isDemo: boolean;
  customer: { name: string; phone: string; address: string } | null; origin: string | null; destination: string | null;
}

/** One post office row for a PIN (from the local India Post directory). */
export interface PincodeOffice { name: string; officeType: string | null; delivery: boolean; district: string; state: string }

export class AllocationConflictError extends Error {}
import type { Role } from '../common/roles';

export interface StaffRecord { id: string; email: string; name: string; role: Role; branchId: string | null; active: boolean }
export interface NewStaff { email: string; name: string; role: Role; branchId: string | null; passwordHash: string }
export interface AuditRecord { at: string; userId: string | null; userName: string | null; action: string; entity: string; entityId: string; detail: unknown }
export interface AuditQuery { entity?: string; action?: string; limit: number; offset: number }

export class DuplicateEmailError extends Error { constructor() { super('A user with this email already exists'); } }

export interface UserRecord { id: string; email: string; name: string; role: Role; branchId: string | null; passwordHash: string; active: boolean }

export interface ShipmentRecord {
  id: string;
  trackingNumber: string;
  bookedAt: string;
  branchId: string;
  customerId: string | null;
  origin: string; destination: string; originPin: string; destPin: string;
  status: UnifiedStatus;
  service: ServiceType;
  chargeableWeightKg: number;
  amount: number;
  /** Estimated courier cost from the rate card at booking; the real cost is known only at allocation. */
  estimatedPartnerCost: number | null;
  allocation: AllocationRecord | null;
  payments: PaymentRec[];
  invoiceNumber: string | null;
  eta: string | null;
  paymentMode: 'UPI' | 'ONLINE' | 'CASH' | 'COUNTER' | 'CREDIT';
  events: ApiEvent[];
  isDemo: boolean;
}

/** Branch address-book entry (counter staff only). */
export interface ContactRecord { id: string; name: string; phone: string; email: string | null; address: string; pin: string; useCount: number; lastUsedAt: string }
export interface PartyInput { name: string; phone: string; address: string; email?: string | null }

export interface NewShipment extends Omit<ShipmentRecord, 'id' | 'events' | 'allocation' | 'payments' | 'invoiceNumber'> {
  createdBy: string | null;
  sender: PartyInput;
  receiver: PartyInput;
  /** Save sender and receiver to the branch address book (same transaction). */
  saveContacts: boolean;
  package: { kind: string; type: string; actualWeightKg: number; lengthCm: number; widthCm: number; heightCm: number; declaredValue: number; insurance: boolean };
  /** Gateway payment verified before booking, or cash taken by staff at booking. null = amount still due. */
  payment: { method: ApiPaymentMethod; amount: number; simulated: boolean; gatewayRef: string | null; collectedBy: string | null } | null;
  journals: JournalLine[][];
  /** The repository numbers the invoice in the same transaction. */
  invoice: InvoiceAmounts;
}

export interface BranchRecord { id: string; name: string; city: string }

/**
 * Persistence boundary. MemoryRepository backs demo mode; PgRepository backs development/production.
 * `branchId` filters are mandatory inputs so callers cannot forget tenant scoping.
 */
export interface Repository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<StaffRecord | null>;
  /** branchId = null lists all staff (global roles only). */
  listStaff(branchId: string | null): Promise<StaffRecord[]>;
  /** Throws DuplicateEmailError if the email is taken. */
  createStaff(s: NewStaff): Promise<StaffRecord>;
  setStaffActive(id: string, active: boolean): Promise<void>;
  branchExists(branchId: string): Promise<boolean>;
  listAudit(q: AuditQuery): Promise<{ rows: AuditRecord[]; total: number }>;
  /** allocated: filter by whether an active allocation exists. open: exclude DELIVERED/CANCELLED. */
  listShipments(opts: { branchId: string | null; status?: UnifiedStatus; q?: string; allocated?: boolean; open?: boolean; limit: number; offset: number }): Promise<{ rows: ShipmentRecord[]; total: number }>;
  findShipment(trackingNumber: string, branchId: string | null): Promise<ShipmentRecord | null>;
  /** Shipment whose active allocation is linked to this courier partner and AWB (partner webhooks). */
  findByPartnerAwb(partnerCode: string, partnerAwb: string): Promise<ShipmentRecord | null>;
  trackingNumberExists(tn: string): Promise<boolean>;
  /** Creates shipment + addresses + package + first event + payment (if any) + ledger journals atomically. */
  createShipment(s: NewShipment): Promise<ShipmentRecord>;
  addEvent(shipmentId: string, e: NewEvent): Promise<void>;
  listAggregators(): Promise<AggregatorRecord[]>;
  /**
   * Supersedes any active allocation and records the new one with its ledger journal, atomically.
   * Throws AllocationConflictError if the AWB is already active on another shipment.
   */
  allocate(shipmentId: string, a: NewAllocation, journal: JournalLine[]): Promise<void>;
  /** Issues the next gapless branch receipt number and records the payment + ledger journal atomically. */
  collect(shipmentId: string, c: NewCollection, journal: (receiptNo: string) => JournalLine[]): Promise<PaymentRec>;
  listLedger(opts: { branchId: string | null; limit: number; offset: number }): Promise<{ rows: LedgerRow[]; total: number }>;
  /** Local PIN directory rows (empty if the directory has not been imported). */
  pincodeOffices(pin: string): Promise<PincodeOffice[]>;
  /** Address-book search by name or mobile within a branch (null = all branches, global roles). */
  searchContacts(branchId: string | null, q: string, limit: number): Promise<ContactRecord[]>;
  getCompany(): Promise<CompanySettings>;
  setCompany(c: Omit<CompanySettings, 'invoicePrefix'>, userId: string): Promise<CompanySettings>;
  listInvoices(opts: { branchId: string | null; limit: number; offset: number }): Promise<{ rows: InvoiceRecord[]; total: number }>;
  findInvoice(number: string, branchId: string | null): Promise<InvoiceRecord | null>;
  /** Totals per account over all entries in scope (not just the current page). */
  trialBalance(branchId: string | null): Promise<{ account: LedgerAccountCode; debit: number; credit: number }[]>;
  listBranches(branchId: string | null): Promise<BranchRecord[]>;
  audit(entry: { userId: string | null; action: string; entity: string; entityId: string; detail?: unknown }): Promise<void>;
}

export const REPOSITORY = Symbol('REPOSITORY');
