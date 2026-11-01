/**
 * DEMO DATA — every value in this file is a SAMPLE FIGURE for presentation only.
 * Partner names are used to illustrate multi-partner routing; rates are not real partner tariffs.
 */
import type { CourierRateCard, PricingConfig, RateSlab, ServiceType, UnifiedStatus, Zone } from './index';
import { receiptNumber, type Allocation, type PaymentRecord, type TrackingEvent } from './operations';

const zones: Zone[] = ['LOCAL', 'WITHIN_STATE', 'METRO', 'REST_OF_INDIA', 'SPECIAL'];
const zoneFactor: Record<Zone, number> = { LOCAL: 1, WITHIN_STATE: 1.25, METRO: 1.5, REST_OF_INDIA: 1.8, SPECIAL: 2.4 };
const tat: Record<ServiceType, Record<Zone, number>> = {
  EXPRESS: { LOCAL: 1, WITHIN_STATE: 1, METRO: 2, REST_OF_INDIA: 3, SPECIAL: 5 },
  STANDARD: { LOCAL: 1, WITHIN_STATE: 2, METRO: 3, REST_OF_INDIA: 5, SPECIAL: 7 },
  SURFACE: { LOCAL: 2, WITHIN_STATE: 3, METRO: 5, REST_OF_INDIA: 7, SPECIAL: 10 },
};

function slabs(base: Partial<Record<ServiceType, number>>, tatDelta = 0): RateSlab[] {
  const out: RateSlab[] = [];
  for (const service of Object.keys(base) as ServiceType[]) {
    for (const zone of zones) {
      const b = Math.round(base[service]! * zoneFactor[zone]);
      out.push({
        zone,
        service,
        basePrice: b,
        baseWeightKg: service === 'SURFACE' ? 3 : 0.5,
        additionalPrice: service === 'SURFACE' ? Math.round(b * 0.22) : Math.round(b * 0.6),
        stepKg: service === 'SURFACE' ? 1 : 0.5,
        minCharge: b,
        tatDays: tat[service][zone] + tatDelta,
      });
    }
  }
  return out;
}

export const DEMO_RATE_CARDS: CourierRateCard[] = [
  { partnerCode: 'BLUEDART', partnerName: 'Blue Dart', volumetricDivisor: 5000, fuelSurchargePct: 12, remoteAreaSurcharge: 60, priority: 1, enabled: true, nonServiceablePrefixes: ['744'], slabs: slabs({ EXPRESS: 72, STANDARD: 58 }) },
  { partnerCode: 'DTDC', partnerName: 'DTDC', volumetricDivisor: 5000, fuelSurchargePct: 10, remoteAreaSurcharge: 50, priority: 2, enabled: true, nonServiceablePrefixes: [], slabs: slabs({ EXPRESS: 60, STANDARD: 45, SURFACE: 110 }) },
  { partnerCode: 'TRACKON', partnerName: 'Trackon', volumetricDivisor: 4500, fuelSurchargePct: 8, remoteAreaSurcharge: 70, priority: 3, enabled: true, nonServiceablePrefixes: ['19', '79'], slabs: slabs({ EXPRESS: 55, STANDARD: 40 }, 1) },
  { partnerCode: 'REGIONAL', partnerName: 'Regional Surface Partner', volumetricDivisor: 4000, fuelSurchargePct: 6, remoteAreaSurcharge: 80, priority: 4, enabled: true, nonServiceablePrefixes: ['18', '19', '78', '79', '744'], slabs: slabs({ SURFACE: 90, STANDARD: 42 }, 1) },
  { partnerCode: 'MOCK', partnerName: 'Mock Courier (sandbox)', volumetricDivisor: 5000, fuelSurchargePct: 0, remoteAreaSurcharge: 0, priority: 9, enabled: false, nonServiceablePrefixes: [], slabs: slabs({ EXPRESS: 80, STANDARD: 60, SURFACE: 120 }) },
];

export const DEMO_PRICING: PricingConfig = { markupFlat: 30, markupPct: 0, insurancePct: 2, insuranceMin: 50, gstPct: 18 };

/** Veer Express operates from a single branch (Kamothe, Navi Mumbai). */
export const DEMO_BRANCHES = [
  { id: 'BR-KMT', name: 'Veer Express — Kamothe', city: 'Navi Mumbai', pin: '410209', address: 'Shop No. 11, Sector 20, Kamothe, Navi Mumbai' },
];
export const HEAD_BRANCH = 'BR-KMT';

export const DEMO_CUSTOMERS = [
  ['C001', 'Aarav Sharma (demo)', '9800000001', 'Kamothe'],
  ['C002', 'Priya Nair (demo)', '9800000002', 'Kharghar'],
  ['C003', 'Rohan Kulkarni (demo)', '9800000003', 'Panvel'],
  ['C004', 'Sneha Patil (demo)', '9800000004', 'Kamothe'],
  ['C005', 'Demo Textiles Pvt Ltd', '9800000005', 'Vashi'],
  ['C006', 'Imran Shaikh (demo)', '9800000006', 'Nerul'],
  ['C007', 'Kavya Iyer (demo)', '9800000007', 'Kharghar'],
  ['C008', 'Demo Pharma Distributors', '9800000008', 'Panvel'],
  ['C009', 'Vikram Joshi (demo)', '9800000009', 'Kamothe'],
  ['C010', 'Ananya Deshmukh (demo)', '9800000010', 'Vashi'],
].map(([id, name, phone, city]) => ({ id, name, phone: phone.replace(/(\d{2})\d{6}(\d{2})/, '$1xxxxxx$2'), city, branchId: HEAD_BRANCH }));

/** Roles in use: Super Admin, Admin (operations), Booking Staff (counter), Accountant. */
export const DEMO_STAFF = [
  { id: 'U1', name: 'Demo Super Admin', role: 'SUPER_ADMIN', branchId: null, email: 'superadmin@demo.veer' },
  { id: 'U2', name: 'Demo Admin', role: 'ADMIN', branchId: null, email: 'admin@demo.veer' },
  { id: 'U4', name: 'Demo Counter Staff', role: 'BOOKING_STAFF', branchId: HEAD_BRANCH, email: 'staff@demo.veer' },
  { id: 'U5', name: 'Demo Accountant', role: 'ACCOUNTANT', branchId: null, email: 'accounts@demo.veer' },
];

const CITY_PIN: Record<string, string> = {
  Kamothe: '410209', Kharghar: '410210', Panvel: '410206', Vashi: '400703', Nerul: '400706',
  Pune: '411001', Mumbai: '400053', Nashik: '422001', Delhi: '110001', Bengaluru: '560001', Chennai: '600001',
  Kolkata: '700001', Hyderabad: '500001', Jaipur: '302001', Guwahati: '781001', Ahmedabad: '380001', Lucknow: '226001',
};

export type DemoEvent = TrackingEvent;
export interface DemoShipment {
  trackingNumber: string; bookedAt: string; customerId: string; branchId: string;
  origin: string; destination: string; originPin: string; destPin: string;
  status: UnifiedStatus; service: ServiceType; weightKg: number; amount: number;
  /** Legacy partner fields used by the API's in-memory repository. The web demo uses `allocation`. */
  partnerCode: string; partnerAwb: string; partnerCost: number; eta: string | null;
  /** How the customer chose to pay at booking. Actual money received is in `payments`. */
  paymentMode: 'UPI' | 'ONLINE' | 'CASH' | 'COUNTER' | 'CREDIT';
  events: DemoEvent[];
  /** null = awaiting manual allocation by operations staff */
  allocation: Allocation | null;
  payments: PaymentRecord[];
  /** Cheapest sample rate at booking — used only as a hint on the allocation screen */
  estimatedPartnerCost: number;
}

export const DEMO_AGGREGATOR = 'Aggregator account (demo)';
export const DEMO_OPS_STAFF = 'Demo Operations Executive';

const SCENARIOS: UnifiedStatus[][] = [
  ['BOOKED'],
  ['BOOKED', 'PICKED_UP'],
  ['BOOKED', 'PICKED_UP', 'IN_TRANSIT'],
  ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB'],
  ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY'],
  ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'EXCEPTION'],
];
const NOTES: Record<UnifiedStatus, string> = {
  BOOKED: 'Shipment booked at Veer Express counter',
  PICKED_UP: 'Shipment picked up',
  IN_TRANSIT: 'Shipment in transit to destination city',
  ARRIVED_AT_DESTINATION_HUB: 'Arrived at destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery with delivery associate',
  DELIVERED: 'Delivered — received by consignee',
  EXCEPTION: 'Delivery attempted — consignee unavailable. Re-attempt scheduled',
};
const PARTNER_NAME: Record<string, string> = { BLUEDART: 'Blue Dart', DTDC: 'DTDC', TRACKON: 'Trackon', REGIONAL: 'Regional Surface Partner' };

/**
 * Sample dates are anchored to the current hour so the operations queues always show a
 * realistic mix of recent and overdue updates. Tracking numbers stay fixed.
 */
function buildShipments(nowMs = Math.floor(Date.now() / 3600e3) * 3600e3): DemoShipment[] {
  const dests = ['Delhi', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Jaipur', 'Guwahati', 'Ahmedabad', 'Lucknow', 'Mumbai'];
  const partners = ['BLUEDART', 'DTDC', 'TRACKON', 'DTDC', 'REGIONAL'];
  const base = nowMs - 110 * 3600e3;
  const receiptSeq: Record<string, number> = {};
  const out: DemoShipment[] = [];
  for (let i = 0; i < 20; i++) {
    const cust = DEMO_CUSTOMERS[i % 10];
    const origin = cust.city;
    const destination = dests[i % dests.length] === origin ? 'Delhi' : dests[i % dests.length];
    const scen = SCENARIOS[i < 7 ? i : (i * 3) % 7];
    const booked = base + i * 5 * 3600e3;
    const step = Math.min(13 * 3600e3, (nowMs - booked - 1800e3) / Math.max(1, scen.length));
    const iso = (ms: number) => new Date(ms).toISOString();
    const events: DemoEvent[] = scen.map((st, k) => {
      const at = booked + k * step;
      const recorded = Math.min(nowMs - 60e3, at + (k === 0 ? 0 : (25 + ((i + k) % 4) * 15) * 60e3));
      return {
        status: st, at: iso(at),
        location: k < 2 ? origin : k === 2 ? `${origin} → ${destination}` : destination,
        note: NOTES[st], recordedAt: iso(recorded),
        recordedBy: k === 0 ? 'System (booking)' : DEMO_OPS_STAFF, source: k === 0 ? 'SYSTEM' : 'MANUAL',
      };
    });
    const weight = [0.5, 1.2, 2, 3.5, 0.8, 5, 12][i % 7];
    const service: ServiceType = weight > 4 ? 'SURFACE' : i % 2 ? 'EXPRESS' : 'STANDARD';
    const partnerCode = service === 'SURFACE' ? (i % 2 ? 'DTDC' : 'REGIONAL') : partners[i % 4];
    const partnerCost = Math.round(60 + weight * 38 + (i % 5) * 7);
    const amount = Math.round((partnerCost + 30) * 1.18);
    const partnerAwb = `${partnerCode.slice(0, 2)}${String(7700000000 + i * 1311)}`;
    const paymentMode = (['UPI', 'ONLINE', 'CASH', 'COUNTER', 'CREDIT'] as const)[i % 5];

    const allocation: Allocation | null = scen.length === 1 ? null : {
      aggregator: DEMO_AGGREGATOR, aggregatorRef: `AGG-${String(554100 + i * 17)}`, courierName: PARTNER_NAME[partnerCode],
      awb: partnerAwb, partnerCost, allocatedBy: DEMO_OPS_STAFF, allocatedAt: iso(booked + Math.min(40 * 60e3, step / 2)),
    };

    const payments: PaymentRecord[] = [];
    const counter = (method: PaymentRecord['method'], at: number, reference: string | null) => {
      receiptSeq[cust.branchId] = (receiptSeq[cust.branchId] ?? 0) + 1;
      payments.push({ id: `PAY-${1001 + i}`, method, amount, at: iso(at), receiptNo: receiptNumber(cust.branchId, receiptSeq[cust.branchId]), reference, collectedBy: 'Demo Counter Staff', simulated: true });
    };
    if (paymentMode === 'UPI' || paymentMode === 'ONLINE') {
      payments.push({ id: `PAY-${1001 + i}`, method: paymentMode === 'UPI' ? 'UPI_GATEWAY' : 'ONLINE_GATEWAY', amount, at: iso(booked), receiptNo: null, reference: `pay_demo${String(880000 + i * 7)}`, collectedBy: 'Payment gateway', simulated: true });
    } else if (paymentMode === 'CASH') counter('CASH', booked, null);
    else if (paymentMode === 'COUNTER' && i % 2 === 0) counter('COUNTER_UPI', booked + 2 * 3600e3, `UPI${String(41000000 + i * 913)}`);
    // COUNTER (odd) and CREDIT stay unpaid → payment status PENDING, independent of delivery status

    out.push({
      trackingNumber: `VX2610${String(20 + Math.floor(i / 3)).padStart(2, '0')}${String(100200 + i * 37)}${(i * 7) % 10}`,
      bookedAt: iso(booked), customerId: cust.id, branchId: cust.branchId,
      origin, destination, originPin: CITY_PIN[origin], destPin: CITY_PIN[destination],
      status: scen[scen.length - 1], service, weightKg: weight, amount,
      partnerCode, partnerAwb, partnerCost,
      eta: scen.includes('DELIVERED') ? null : new Date(booked + 4 * 86400e3).toISOString().slice(0, 10),
      paymentMode, events, allocation, payments, estimatedPartnerCost: partnerCost,
    });
  }
  return out;
}

export const DEMO_SHIPMENTS = buildShipments();

/** Headline shipment for the client meeting walk-through. */
export const SHOWCASE_TRACKING = DEMO_SHIPMENTS[4].trackingNumber;
