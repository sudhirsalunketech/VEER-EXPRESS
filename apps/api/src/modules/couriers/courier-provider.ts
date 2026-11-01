import type { ServiceType, UnifiedStatus } from '@veer/core';

/** Partner configuration loaded from courier_partners (+ decrypted courier_credentials, server-side only). */
export interface PartnerConfig {
  code: string;
  name: string;
  environment: 'TEST' | 'PRODUCTION';
  enabled: boolean;
  apiBaseUrl?: string;
  authType: 'NONE' | 'API_KEY' | 'BASIC' | 'OAUTH2' | 'JWT';
  /** Endpoint paths are configured per partner from the partner's official documentation — never hardcoded/guessed. */
  endpoints?: Partial<Record<'booking' | 'tracking' | 'rates' | 'serviceability', string>>;
  credentials?: Record<string, string>;
  webhookSecret?: string;
  statusMap: Record<string, UnifiedStatus>;
}

export interface Capabilities { booking: boolean; tracking: boolean; rates: boolean; serviceability: boolean; webhooks: boolean }
export interface Party { name: string; phone: string; address: string; pin: string }
export interface BookingRequest {
  veerTrackingNumber: string; service: ServiceType; sender: Party; receiver: Party;
  weightKg: number; dims: { lengthCm: number; widthCm: number; heightCm: number }; declaredValue: number; kind: 'DOCUMENT' | 'PARCEL';
}
export interface BookingResult { partnerAwb: string | null; labelUrl?: string; requiresManualAwb: boolean }
export interface PartnerTrackingEvent { partnerAwb: string; rawStatus: string; at: string; location: string; remark?: string }
export interface Serviceability { serviceable: boolean; remote?: boolean; source: 'API' | 'RATE_TABLE' | 'MOCK' }

export class ProviderNotConfiguredError extends Error {
  constructor(partner: string, what: string) {
    super(`${partner}: ${what} is not configured. Add the endpoint and credentials from the partner's official API documentation and test in sandbox first.`);
  }
}

/**
 * Contract every courier integration implements. The booking system only talks to this interface,
 * so new partners are added by writing an adapter and registering it — no booking-flow changes.
 */
export interface CourierProvider {
  readonly code: string;
  capabilities(): Capabilities;
  checkServiceability(originPin: string, destPin: string): Promise<Serviceability>;
  createShipment(req: BookingRequest): Promise<BookingResult>;
  track(partnerAwb: string): Promise<PartnerTrackingEvent[]>;
  /** Verify signature + parse a partner webhook payload. Must throw on invalid signature. */
  parseWebhook(headers: Record<string, string | undefined>, body: unknown): PartnerTrackingEvent[];
}
