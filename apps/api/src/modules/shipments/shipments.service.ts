import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import {
  DEMO_PRICING, DEMO_RATE_CARDS, STALE_AFTER_HOURS, STATUS_LABEL, allocate, balanceDue, generateTrackingNumber, hoursSinceLastUpdate,
  paymentStatus, toCustomerQuote, validateAllocation, validateCollection, validateTrackingUpdate,
  type AllocationMode, type CourierRateCard, type PaymentRecord, type PricingConfig, type QuoteInput, type UnifiedStatus,
} from '@veer/core';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../../config';
import {
  AllocationConflictError, REPOSITORY,
  type ApiPaymentMethod, type JournalLine, type NewShipment, type Repository, type ShipmentRecord,
} from '../../database/repository';
import { CourierRegistry } from '../couriers/courier-registry';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway';
import { NotificationService, type TemplateKey } from '../notifications/notifications';
import { allocationJournal, bookingJournal, invoiceAmounts, paymentJournal } from '../ledger/journals';
import { INTERNAL_COST_ROLES, branchScope, type AuthUser } from '../../common/roles';

const pin = z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid PIN code');
const phone = z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number');
const email = z.string().trim().toLowerCase().max(120).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Invalid e-mail address');
const party = z.object({
  name: z.string().trim().min(1).max(120), phone, address: z.string().trim().min(8).max(400),
  /** Optional: bill and tracking details are e-mailed here. */
  email: z.union([email, z.literal('').transform(() => null), z.null()]).optional(),
});

export const QuoteSchema = z.object({
  originPin: pin, destPin: pin,
  actualWeightKg: z.number().positive().max(70),
  dims: z.object({ lengthCm: z.number().positive().max(200), widthCm: z.number().positive().max(200), heightCm: z.number().positive().max(200) }),
  service: z.enum(['EXPRESS', 'STANDARD', 'SURFACE']),
  declaredValue: z.number().min(0).max(1_000_000).default(0),
  insurance: z.boolean().default(false),
});

export const BookingSchema = QuoteSchema.extend({
  kind: z.enum(['DOCUMENT', 'PARCEL']),
  packageType: z.string().max(40).default('Box'),
  sender: party, receiver: party,
  originCity: z.string().max(80).optional(), destCity: z.string().max(80).optional(),
  paymentMode: z.enum(['UPI', 'ONLINE', 'CASH', 'COUNTER', 'CREDIT']),
  /** For ONLINE/UPI: proof from the gateway checkout, verified server-side. */
  payment: z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).optional(),
  branchId: z.string().max(40).optional(),
});
export type BookingInput = z.infer<typeof BookingSchema>;

export const AllocationSchema = z.object({
  aggregatorCode: z.string().max(40).optional(),
  aggregatorRef: z.string().trim().max(40),
  courierName: z.string().trim().max(60),
  awb: z.string().trim().max(30).transform((s) => s.toUpperCase()),
  partnerCost: z.number(),
  /** Required when replacing an existing allocation. */
  reason: z.string().trim().max(300).optional(),
});

export const TrackingUpdateSchema = z.object({
  status: z.enum(['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION']),
  /** When it happened, as shown on the courier's tracking page. */
  occurredAt: z.string().max(40),
  location: z.string().trim().max(120),
  remarks: z.string().trim().max(300).default(''),
  /** Staff confirm they checked this on the courier's tracking page. */
  verified: z.boolean(),
});

export const CollectionSchema = z.object({
  method: z.enum(['CASH', 'COUNTER_UPI', 'COUNTER_CARD']),
  amount: z.number(),
  reference: z.string().trim().max(60).default(''),
});

const STATUS_TEMPLATE: Partial<Record<UnifiedStatus, TemplateKey>> = {
  PICKED_UP: 'picked_up', IN_TRANSIT: 'in_transit', OUT_FOR_DELIVERY: 'out_for_delivery', DELIVERED: 'delivered', EXCEPTION: 'delivery_exception',
};

const asCore = (s: ShipmentRecord): PaymentRecord[] => s.payments.map((p) => ({ ...p, collectedBy: p.collectedBy ?? '' }));
export const payStatus = (s: ShipmentRecord) => paymentStatus(s.amount, asCore(s));
export const dueOf = (s: ShipmentRecord) => balanceDue(s.amount, asCore(s));
const lastUpdatedAt = (s: ShipmentRecord) => s.events.reduce((m, e) => (e.recordedAt > m ? e.recordedAt : m), s.bookedAt);

/**
 * Customer-safe projection — the ONLY shape public endpoints may return. No courier, AWB, aggregator,
 * cost, staff names or payment details. Tracking is entered by staff, so it says when it was last updated.
 */
export function toPublicTracking(s: ShipmentRecord) {
  return {
    trackingNumber: s.trackingNumber, bookedAt: s.bookedAt, origin: s.origin, destination: s.destination,
    status: s.status, statusLabel: STATUS_LABEL[s.status], estimatedDelivery: s.eta,
    dispatched: !!s.allocation,
    lastUpdatedAt: lastUpdatedAt(s),
    updateNotice: 'Tracking is updated by Veer Express staff from courier records. It is not real-time tracking.',
    events: s.events.map((e) => ({ status: e.status, label: STATUS_LABEL[e.status], at: e.at, location: e.location, note: e.note })),
  };
}

/** Staff projection. Courier, AWB, aggregator and cost only for roles allowed to see partner economics. */
export function toInternal(s: ShipmentRecord, user: AuthUser) {
  const { allocation, estimatedPartnerCost, ...rest } = s;
  const base = { ...rest, paymentStatus: payStatus(s), balanceDue: dueOf(s), lastUpdatedAt: lastUpdatedAt(s), allocated: !!allocation };
  if (!INTERNAL_COST_ROLES.includes(user.role)) return { ...base, allocatedAt: allocation?.allocatedAt ?? null };
  const margin = allocation ? Math.round((s.amount / 1.18 - allocation.partnerCost) * 100) / 100 : null;
  return { ...base, allocation, estimatedPartnerCost, grossMarginExGst: margin };
}

@Injectable()
export class ShipmentsService {
  /** Demo: rate cards from @veer/core seed. Production: loaded from courier_rate_cards / pricing_settings. */
  private rateCards: CourierRateCard[] = DEMO_RATE_CARDS;
  private pricing: PricingConfig = DEMO_PRICING;
  private rules = [{ zone: 'SPECIAL' as const, preferPartner: 'DTDC' }];

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CourierRegistry) private readonly couriers: CourierRegistry,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** Rate-card estimate. In the aggregator model this prices the booking; the actual courier is chosen at allocation. */
  allocate(input: QuoteInput, mode: AllocationMode = 'CHEAPEST', manualPartner?: string) {
    return allocate(this.rateCards, this.pricing, input, mode, { manualPartner, rules: this.rules });
  }

  quotePublic(input: QuoteInput) {
    const r = this.allocate(input);
    if (!r.chosen) throw new UnprocessableEntityException('This service is not available on this route');
    return { ...toCustomerQuote(r.chosen), sample: this.cfg.mode !== 'production' };
  }

  async createPaymentOrder(input: QuoteInput) {
    const q = this.quotePublic(input);
    return this.gateway.createOrder(q.total, `quote-${Date.now()}`);
  }

  private async load(user: AuthUser | null, tn: string) {
    const s = await this.repo.findShipment(tn, user ? branchScope(user) : null);
    if (!s) throw new NotFoundException('Shipment not found'); // same response whether absent or another branch's
    return s;
  }

  async book(input: BookingInput, user: AuthUser | null) {
    const isStaff = !!user && user.role !== 'CUSTOMER';
    const r = this.allocate(input);
    if (!r.chosen) throw new UnprocessableEntityException(r.reason);
    const q = r.chosen;

    // Single branch today (Kamothe): public bookings go to the head branch; staff book for their own branch.
    const scope = user ? branchScope(user) : null;
    const branchId = scope ?? (isStaff ? input.branchId : undefined) ?? this.cfg.headBranch;
    if (!(await this.repo.branchExists(branchId))) throw new BadRequestException('Unknown branch');

    // Payment — only money actually received becomes a payment record. COUNTER/CREDIT stay due.
    let payment: NewShipment['payment'] = null;
    if (input.paymentMode === 'ONLINE' || input.paymentMode === 'UPI') {
      const method: ApiPaymentMethod = input.paymentMode === 'UPI' ? 'UPI_GATEWAY' : 'ONLINE_GATEWAY';
      if (this.gateway.name === 'SIMULATED') {
        payment = { method, amount: q.total, simulated: true, gatewayRef: `sim_${Date.now()}`, collectedBy: null };
      } else {
        if (!input.payment || !this.gateway.verifyPayment(input.payment)) throw new BadRequestException('Payment verification failed');
        payment = { method, amount: q.total, simulated: false, gatewayRef: input.payment.paymentId, collectedBy: null };
      }
    } else if (input.paymentMode === 'CASH') {
      // Cash is handed over at a branch counter, so only logged-in staff can record it.
      if (!isStaff) throw new BadRequestException('Cash payments can only be recorded by branch staff');
      payment = { method: 'CASH', amount: q.total, simulated: this.cfg.mode === 'demo', gatewayRef: null, collectedBy: user!.id };
    } else if (input.paymentMode === 'CREDIT' && !isStaff) {
      throw new BadRequestException('Credit accounts can only be used by staff for approved customers');
    }

    let tn = generateTrackingNumber();
    for (let i = 0; await this.repo.trackingNumberExists(tn); i++) {
      if (i > 5) throw new ConflictException('Could not allocate tracking number');
      tn = generateTrackingNumber();
    }

    const now = new Date();
    const journals: JournalLine[][] = [bookingJournal(q.total)];
    if (payment) journals.push(paymentJournal(payment.method, payment.amount, payment.gatewayRef ?? 'at booking'));
    const saved = await this.repo.createShipment({
      trackingNumber: tn, bookedAt: now.toISOString(), branchId, customerId: null, createdBy: user?.id ?? null,
      origin: input.originCity ?? `PIN ${input.originPin}`, destination: input.destCity ?? `PIN ${input.destPin}`,
      originPin: input.originPin, destPin: input.destPin, status: 'BOOKED', service: q.service,
      chargeableWeightKg: q.chargeableWeightKg, amount: q.total, estimatedPartnerCost: q.partnerCost,
      eta: new Date(now.getTime() + q.estimatedDays * 86400e3).toISOString().slice(0, 10),
      paymentMode: input.paymentMode, isDemo: this.cfg.mode === 'demo',
      sender: input.sender, receiver: input.receiver, saveContacts: true,
      package: { kind: input.kind, type: input.packageType, actualWeightKg: input.actualWeightKg, ...input.dims, declaredValue: input.declaredValue, insurance: input.insurance },
      payment, journals, invoice: invoiceAmounts(q.total),
    });

    await this.repo.audit({ userId: user?.id ?? null, action: 'SHIPMENT.CREATE', entity: 'shipment', entityId: tn, detail: { branchId, paymentMode: input.paymentMode, estimatedPartnerCost: q.partnerCost } });
    const vars = { name: input.sender.name, tn, dest: saved.destination, trackUrl: `/track?tn=${tn}`, amount: q.total.toFixed(2) };
    await this.notifications.notify(['WHATSAPP', 'SMS'], input.sender.phone, 'booking_confirmation', vars);
    if (payment) await this.notifications.notify(['SMS'], input.sender.phone, 'payment_confirmation', vars);
    // bill + tracking details by e-mail, only when the customer gave an address
    let emailStatus: 'NONE' | 'SIMULATED' | 'SENT' | 'FAILED' = 'NONE';
    if (input.sender.email) {
      const PAY: Record<string, string> = { UPI: 'Paid (UPI)', ONLINE: 'Paid online', CASH: 'Paid (cash)', COUNTER: 'Due at counter', CREDIT: 'Credit account' };
      [emailStatus] = await this.notifications.notify(['EMAIL'], input.sender.email, 'booking_email', {
        ...vars, origin: saved.origin, invoice: saved.invoiceNumber ?? '—', payment: PAY[input.paymentMode] ?? input.paymentMode,
      });
    }

    return {
      trackingNumber: tn, quote: toCustomerQuote(q),
      shipmentStatus: saved.status,
      paymentStatus: payStatus(saved), balanceDue: dueOf(saved),
      receiptNo: saved.payments[0]?.receiptNo ?? null,
      invoiceNumber: saved.invoiceNumber,
      emailStatus, emailTo: input.sender.email ?? null,
      simulatedPayment: saved.payments[0]?.simulated ?? false,
    };
  }

  async trackPublic(tn: string) {
    return toPublicTracking(await this.load(null, tn.trim().toUpperCase()));
  }

  async list(user: AuthUser, q: { status?: UnifiedStatus; q?: string; page: number; pageSize: number }) {
    const { rows, total } = await this.repo.listShipments({ branchId: branchScope(user), status: q.status, q: q.q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    return { rows: rows.map((s) => toInternal(s, user)), total, page: q.page, pageSize: q.pageSize };
  }

  async getInternal(user: AuthUser, tn: string) {
    return toInternal(await this.load(user, tn), user);
  }

  // ------------------------------------------------------------ operations queues

  /** Booked shipments still waiting for staff to book them in the aggregator account, oldest first. */
  async allocationQueue(user: AuthUser) {
    const { rows } = await this.repo.listShipments({ branchId: branchScope(user), allocated: false, open: true, limit: 500, offset: 0 });
    return rows.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt)).map((s) => ({
      ...toInternal(s, user), waitingHours: Math.round((Date.now() - Date.parse(s.bookedAt)) / 360e3) / 10,
    }));
  }

  /** Allocated, undelivered shipments ordered by how long since staff last recorded an update. */
  async trackingQueue(user: AuthUser) {
    const { rows } = await this.repo.listShipments({ branchId: branchScope(user), allocated: true, open: true, limit: 500, offset: 0 });
    return rows
      .map((s) => ({ s, h: hoursSinceLastUpdate(s.events) }))
      .sort((a, b) => b.h - a.h)
      .map(({ s, h }) => ({ ...toInternal(s, user), hoursSinceUpdate: Math.round(h * 10) / 10, stale: h >= STALE_AFTER_HOURS }));
  }

  listAggregators() { return this.repo.listAggregators(); }

  // ------------------------------------------------------------ allocation

  async allocateCourier(user: AuthUser, tn: string, body: z.infer<typeof AllocationSchema>) {
    const s = await this.load(user, tn);
    if (s.status === 'DELIVERED' || (s.status as string) === 'CANCELLED') throw new ConflictException('Shipment is closed');
    const err = validateAllocation(body);
    if (err) throw new UnprocessableEntityException(err);
    if (s.allocation && (body.reason ?? '').length < 5) throw new ConflictException('Shipment is already allocated. Give a reason to re-allocate it.');

    const aggregators = await this.repo.listAggregators();
    const agg = body.aggregatorCode ? aggregators.find((a) => a.code === body.aggregatorCode) : aggregators.find((a) => a.code !== 'LEGACY');
    if (!agg) throw new UnprocessableEntityException('Select an active aggregator account');

    // copy before writing: the stored record may be updated in place
    const prev = s.allocation ? { ...s.allocation } : null;
    const next = { courierName: body.courierName, awb: body.awb, partnerCost: Math.round(body.partnerCost * 100) / 100 };
    try {
      await this.repo.allocate(s.id, { aggregatorCode: agg.code, aggregatorRef: body.aggregatorRef, ...next, userId: user.id, reason: prev ? body.reason! : null },
        allocationJournal(next, prev));
    } catch (e) {
      if (e instanceof AllocationConflictError) throw new ConflictException(e.message);
      throw e;
    }
    await this.repo.audit({
      userId: user.id, action: prev ? 'SHIPMENT.REALLOCATE' : 'SHIPMENT.ALLOCATE', entity: 'shipment', entityId: s.trackingNumber,
      detail: { aggregator: agg.code, aggregatorRef: body.aggregatorRef, ...next, ...(prev ? { previous: { courierName: prev.courierName, awb: prev.awb, partnerCost: prev.partnerCost }, reason: body.reason } : {}) },
    });
    return toInternal((await this.repo.findShipment(s.trackingNumber, null))!, user);
  }

  // ------------------------------------------------------------ manual tracking

  async recordTracking(user: AuthUser, tn: string, u: z.infer<typeof TrackingUpdateSchema>) {
    const s = await this.load(user, tn);
    const err = validateTrackingUpdate({ status: s.status, events: s.events, allocated: !!s.allocation }, { ...u, occurredAt: u.occurredAt });
    if (err) throw new UnprocessableEntityException(err);
    const at = new Date(u.occurredAt).toISOString();
    const from = s.status;
    await this.applyEvent(s, { status: u.status, at, location: u.location, note: u.remarks || STATUS_LABEL[u.status], source: 'MANUAL', recordedBy: user.id, verified: true });
    await this.repo.audit({ userId: user.id, action: 'TRACKING.UPDATE', entity: 'shipment', entityId: s.trackingNumber, detail: { from, to: u.status, occurredAt: at, location: u.location, remarks: u.remarks } });
    return toInternal((await this.repo.findShipment(s.trackingNumber, null))!, user);
  }

  // ------------------------------------------------------------ counter collection

  async collect(user: AuthUser, tn: string, c: z.infer<typeof CollectionSchema>) {
    const s = await this.load(user, tn);
    const due = dueOf(s);
    if (due <= 0) throw new ConflictException('Nothing is due on this shipment');
    const err = validateCollection(due, c);
    if (err) throw new UnprocessableEntityException(err);
    const amount = Math.round(c.amount * 100) / 100;
    const p = await this.repo.collect(s.id, { method: c.method, amount, reference: c.reference || null, userId: user.id, simulated: this.cfg.mode === 'demo' },
      (receiptNo) => paymentJournal(c.method, amount, receiptNo));
    await this.repo.audit({ userId: user.id, action: 'PAYMENT.COLLECT', entity: 'shipment', entityId: s.trackingNumber, detail: { receiptNo: p.receiptNo, method: c.method, amount } });
    const after = (await this.repo.findShipment(s.trackingNumber, null))!;
    return { receipt: p, paymentStatus: payStatus(after), balanceDue: dueOf(after), shipmentStatus: after.status };
  }

  // ------------------------------------------------------------ partner webhooks (only for couriers with a verified API)

  /** Partner webhook → verify → normalise → apply. Unknown AWBs/statuses are ignored (logged), not errors to the partner. */
  async handleWebhook(partnerCode: string, headers: Record<string, string | undefined>, body: unknown) {
    let provider;
    try { provider = this.couriers.get(partnerCode); } catch { throw new NotFoundException('Unknown courier partner'); }
    let events;
    try { events = provider.parseWebhook(headers, body); } catch { throw new UnauthorizedException('Webhook rejected'); }
    let applied = 0;
    for (const ev of events) {
      const status = this.couriers.normalize(partnerCode, ev.rawStatus);
      const s = await this.repo.findByPartnerAwb(partnerCode, ev.partnerAwb);
      if (!status || !s || s.status === 'DELIVERED') continue;
      await this.applyEvent(s, { status, at: ev.at, location: ev.location, note: ev.remark ?? STATUS_LABEL[status], source: 'PARTNER_WEBHOOK', recordedBy: null, verified: false, rawStatus: ev.rawStatus });
      applied++;
    }
    return { received: events.length, applied };
  }

  private async applyEvent(s: ShipmentRecord, e: Parameters<Repository['addEvent']>[1]) {
    await this.repo.addEvent(s.id, e);
    const tpl = STATUS_TEMPLATE[e.status];
    if (tpl) await this.notifications.notify(['WHATSAPP'], 'customer-on-file', tpl, { tn: s.trackingNumber, dest: s.destination, reason: e.note, support: 'your Veer Express branch' });
  }
}
