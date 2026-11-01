import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BookingRequest, CourierProvider, PartnerConfig, PartnerTrackingEvent } from './courier-provider';

/** Fully working in-process provider for demo mode and automated tests. Moves no real parcels. */
export class MockCourierProvider implements CourierProvider {
  readonly code: string;
  private seq = 0;
  constructor(private readonly cfg: PartnerConfig) { this.code = cfg.code; }

  capabilities() { return { booking: true, tracking: true, rates: false, serviceability: true, webhooks: true }; }
  async checkServiceability(_o: string, dest: string) { return { serviceable: !dest.startsWith('744'), remote: /^(18|19|78|79)/.test(dest), source: 'MOCK' as const }; }
  async createShipment(req: BookingRequest) {
    this.seq += 1;
    return { partnerAwb: `MOCK-${this.code}-${req.veerTrackingNumber.slice(-8)}${this.seq}`, requiresManualAwb: false };
  }
  async track(_awb: string): Promise<PartnerTrackingEvent[]> { return []; }

  /** Mock webhooks are HMAC-SHA256 signed with the configured secret in header x-mock-signature. */
  parseWebhook(headers: Record<string, string | undefined>, body: unknown): PartnerTrackingEvent[] {
    const secret = this.cfg.webhookSecret ?? 'mock-webhook-secret';
    const sig = headers['x-mock-signature'] ?? '';
    const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid webhook signature');
    const b = body as { events?: PartnerTrackingEvent[] };
    if (!Array.isArray(b.events)) throw new Error('Malformed webhook body');
    return b.events;
  }
}
