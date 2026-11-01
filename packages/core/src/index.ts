/**
 * @veer/core — pure, framework-free business logic shared by the web demo and the NestJS API.
 * All money values are in paise-free rupees rounded to 2 decimals. All rate values in the
 * demo seed are SAMPLE FIGURES ONLY.
 */

export type ServiceType = 'EXPRESS' | 'STANDARD' | 'SURFACE';
export type ShipmentKind = 'DOCUMENT' | 'PARCEL';
export type Zone = 'LOCAL' | 'WITHIN_STATE' | 'METRO' | 'REST_OF_INDIA' | 'SPECIAL';

/** Unified customer-facing statuses. Partner statuses are mapped into these. */
export const UNIFIED_STATUSES = [
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
] as const;
export type UnifiedStatus = (typeof UNIFIED_STATUSES)[number];

export const STATUS_LABEL: Record<UnifiedStatus, string> = {
  BOOKED: 'Booked',
  PICKED_UP: 'Pickup completed',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_DESTINATION_HUB: 'Arrived at destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  EXCEPTION: 'Delivery exception',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- weight

export interface Dimensions { lengthCm: number; widthCm: number; heightCm: number }

export function volumetricWeightKg(d: Dimensions, divisor: number): number {
  if (divisor <= 0) throw new Error('Volumetric divisor must be positive');
  for (const v of [d.lengthCm, d.widthCm, d.heightCm]) {
    if (!(v >= 0)) throw new Error('Dimensions must be non-negative numbers');
  }
  return round2((d.lengthCm * d.widthCm * d.heightCm) / divisor);
}

export function chargeableWeightKg(actualKg: number, d: Dimensions, divisor: number): number {
  if (!(actualKg > 0)) throw new Error('Actual weight must be greater than zero');
  return round2(Math.max(actualKg, volumetricWeightKg(d, divisor)));
}

// ---------------------------------------------------------------- zones

/** Simple PIN-prefix based zoning. Real deployments load zone tables from courier_serviceability. */
const METRO_PREFIXES = ['110', '400', '560', '600', '700', '500']; // Delhi, Mumbai, Bengaluru, Chennai, Kolkata, Hyderabad
const SPECIAL_PREFIXES = ['19', '18', '79', '78', '744']; // J&K, NE, A&N (sample)

export function isValidPin(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(pin);
}

/** India Post circles by 2-digit PIN prefix (subset; unknown prefixes fall back to the prefix itself). */
const CIRCLES: [string, number, number][] = [
  ['DL', 11, 11], ['HR', 12, 13], ['PB', 14, 16], ['HP', 17, 17], ['JK', 18, 19], ['UP', 20, 28],
  ['RJ', 30, 34], ['GJ', 36, 39], ['MH', 40, 44], ['MP', 45, 48], ['CG', 49, 49], ['AP', 50, 53],
  ['KA', 56, 59], ['TN', 60, 64], ['KL', 67, 69], ['WB', 70, 74], ['OD', 75, 77], ['NE', 78, 79],
  ['BR', 80, 85],
];
export function postalCircle(pin: string): string {
  const n = Number(pin.slice(0, 2));
  return CIRCLES.find(([, a, b]) => n >= a && n <= b)?.[0] ?? pin.slice(0, 2);
}

export function resolveZone(origin: string, dest: string): Zone {
  if (!isValidPin(origin) || !isValidPin(dest)) throw new Error('Invalid PIN code');
  if (SPECIAL_PREFIXES.some((p) => dest.startsWith(p))) return 'SPECIAL';
  if (origin.slice(0, 3) === dest.slice(0, 3)) return 'LOCAL';
  if (postalCircle(origin) === postalCircle(dest)) return 'WITHIN_STATE';
  if (METRO_PREFIXES.includes(origin.slice(0, 3)) && METRO_PREFIXES.includes(dest.slice(0, 3))) return 'METRO';
  return 'REST_OF_INDIA';
}

// ---------------------------------------------------------------- rate cards

export interface RateSlab {
  zone: Zone;
  service: ServiceType;
  /** price for the first `baseWeightKg` */
  basePrice: number;
  baseWeightKg: number;
  /** price per additional `stepKg` (e.g. 0.5 for per-500g, 1 for per-kg) */
  additionalPrice: number;
  stepKg: number;
  minCharge: number;
  tatDays: number;
}

export interface CourierRateCard {
  partnerCode: string;
  partnerName: string;
  volumetricDivisor: number;
  fuelSurchargePct: number;
  remoteAreaSurcharge: number;
  priority: number; // lower = preferred
  enabled: boolean;
  slabs: RateSlab[];
  /** PIN prefixes not serviced by this partner (sample serviceability) */
  nonServiceablePrefixes: string[];
}

export interface PricingConfig {
  markupFlat: number;
  markupPct: number;
  insurancePct: number;
  insuranceMin: number;
  gstPct: number;
}

export function partnerCost(card: CourierRateCard, zone: Zone, service: ServiceType, chargeableKg: number): { cost: number; tatDays: number } | null {
  const slab = card.slabs.find((s) => s.zone === zone && s.service === service);
  if (!slab) return null;
  const extra = Math.max(0, chargeableKg - slab.baseWeightKg);
  const steps = Math.ceil(round2(extra / slab.stepKg));
  let cost = slab.basePrice + steps * slab.additionalPrice;
  cost = Math.max(cost, slab.minCharge);
  cost += (cost * card.fuelSurchargePct) / 100;
  if (zone === 'SPECIAL') cost += card.remoteAreaSurcharge;
  return { cost: round2(cost), tatDays: slab.tatDays };
}

export interface QuoteInput {
  originPin: string;
  destPin: string;
  actualWeightKg: number;
  dims: Dimensions;
  service: ServiceType;
  declaredValue: number;
  insurance: boolean;
}

export interface CustomerQuote {
  zone: Zone;
  service: ServiceType;
  chargeableWeightKg: number;
  volumetricWeightKg: number;
  freight: number;
  insurance: number;
  taxableValue: number;
  gst: number;
  total: number;
  estimatedDays: number;
}

/** Internal quote: never send this to a customer-facing API response. */
export interface InternalQuote extends CustomerQuote {
  partnerCode: string;
  partnerName: string;
  partnerCost: number;
  grossMargin: number;
}

export function buildQuote(card: CourierRateCard, cfg: PricingConfig, input: QuoteInput): InternalQuote | null {
  if (!card.enabled) return null;
  if (card.nonServiceablePrefixes.some((p) => input.destPin.startsWith(p) || input.originPin.startsWith(p))) return null;
  const zone = resolveZone(input.originPin, input.destPin);
  const vol = volumetricWeightKg(input.dims, card.volumetricDivisor);
  const cw = chargeableWeightKg(input.actualWeightKg, input.dims, card.volumetricDivisor);
  const pc = partnerCost(card, zone, input.service, cw);
  if (!pc) return null;
  const freight = round2(pc.cost + cfg.markupFlat + (pc.cost * cfg.markupPct) / 100);
  const insurance = input.insurance ? round2(Math.max(cfg.insuranceMin, (input.declaredValue * cfg.insurancePct) / 100)) : 0;
  const taxable = round2(freight + insurance);
  const gst = round2((taxable * cfg.gstPct) / 100);
  return {
    zone,
    service: input.service,
    chargeableWeightKg: cw,
    volumetricWeightKg: vol,
    freight,
    insurance,
    taxableValue: taxable,
    gst,
    total: round2(taxable + gst),
    estimatedDays: pc.tatDays,
    partnerCode: card.partnerCode,
    partnerName: card.partnerName,
    partnerCost: pc.cost,
    grossMargin: round2(freight - pc.cost),
  };
}

/** Strip internal fields. Use at every customer-facing boundary. */
export function toCustomerQuote(q: InternalQuote): CustomerQuote {
  const { partnerCode: _a, partnerName: _b, partnerCost: _c, grossMargin: _d, ...pub } = q;
  return pub;
}

// ---------------------------------------------------------------- allocation

export type AllocationMode = 'MANUAL' | 'CHEAPEST' | 'RULE_BASED';

export interface AllocationRule {
  /** match conditions; undefined = any */
  zone?: Zone;
  service?: ServiceType;
  minWeightKg?: number;
  maxWeightKg?: number;
  preferPartner: string;
}

export interface AllocationResult {
  chosen: InternalQuote | null;
  candidates: InternalQuote[];
  reason: string;
}

export function allocate(
  cards: CourierRateCard[],
  cfg: PricingConfig,
  input: QuoteInput,
  mode: AllocationMode,
  opts: { manualPartner?: string; rules?: AllocationRule[] } = {},
): AllocationResult {
  const candidates = cards
    .map((c) => buildQuote(c, cfg, input))
    .filter((q): q is InternalQuote => q !== null)
    .sort((a, b) => a.partnerCost - b.partnerCost || priorityOf(cards, a) - priorityOf(cards, b));
  if (candidates.length === 0) return { chosen: null, candidates, reason: 'No eligible courier partner services this route' };

  if (mode === 'MANUAL') {
    const q = candidates.find((c) => c.partnerCode === opts.manualPartner);
    return q
      ? { chosen: q, candidates, reason: `Manually allocated to ${q.partnerName}` }
      : { chosen: null, candidates, reason: 'Selected partner is not eligible for this shipment' };
  }
  if (mode === 'RULE_BASED') {
    const zone = candidates[0].zone;
    const cw = candidates[0].chargeableWeightKg;
    for (const r of opts.rules ?? []) {
      if (r.zone && r.zone !== zone) continue;
      if (r.service && r.service !== input.service) continue;
      if (r.minWeightKg !== undefined && cw < r.minWeightKg) continue;
      if (r.maxWeightKg !== undefined && cw > r.maxWeightKg) continue;
      const q = candidates.find((c) => c.partnerCode === r.preferPartner);
      if (q) return { chosen: q, candidates, reason: `Rule matched → ${q.partnerName}` };
    }
    // fall through to priority, then cost
    const byPriority = [...candidates].sort((a, b) => priorityOf(cards, a) - priorityOf(cards, b) || a.partnerCost - b.partnerCost);
    return { chosen: byPriority[0], candidates, reason: `No rule matched; highest-priority eligible partner ${byPriority[0].partnerName}` };
  }
  return { chosen: candidates[0], candidates, reason: `Cheapest eligible partner ${candidates[0].partnerName}` };
}

function priorityOf(cards: CourierRateCard[], q: InternalQuote) {
  return cards.find((c) => c.partnerCode === q.partnerCode)?.priority ?? 999;
}

// ---------------------------------------------------------------- tracking numbers

/**
 * Veer tracking number: VX + yymmdd + 6 random digits + mod-11-style check digit.
 * Uniqueness is enforced by a DB unique index; callers retry on collision.
 */
export function generateTrackingNumber(date = new Date(), rand: () => number = Math.random): string {
  const ymd = date.toISOString().slice(2, 10).replace(/-/g, '');
  const body = ymd + Array.from({ length: 6 }, () => Math.floor(rand() * 10)).join('');
  return `VX${body}${checkDigit(body)}`;
}

function checkDigit(digits: string): number {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = digits.split('').reduce((s, d, i) => s + Number(d) * weights[i % weights.length], 0);
  const r = 11 - (sum % 11);
  return r >= 10 ? 0 : r;
}

export function isValidTrackingNumber(tn: string): boolean {
  const m = /^VX(\d{12})(\d)$/.exec(tn.trim().toUpperCase());
  return !!m && checkDigit(m[1]) === Number(m[2]);
}

// ---------------------------------------------------------------- status normalization

/** Per-partner raw status → unified status. Configurable in DB (courier_partners.status_map). */
export function normalizeStatus(rawStatus: string, map: Record<string, UnifiedStatus>): UnifiedStatus | null {
  const key = rawStatus.trim().toUpperCase();
  return map[key] ?? null;
}
export * from './seed';
export * from './operations';
