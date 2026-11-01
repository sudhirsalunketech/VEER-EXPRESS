import type { CourierProvider, PartnerConfig, PartnerTrackingEvent } from './courier-provider';

/**
 * For partners with no API access (common for franchise accounts). Staff book on the partner's own
 * portal/counter, then enter the partner AWB and status updates in Veer admin. Customers still see
 * only Veer tracking.
 */
export class GenericCourierProvider implements CourierProvider {
  readonly code: string;
  constructor(cfg: PartnerConfig) { this.code = cfg.code; }
  capabilities() { return { booking: false, tracking: false, rates: false, serviceability: false, webhooks: false }; }
  async checkServiceability() { return { serviceable: true, source: 'RATE_TABLE' as const }; }
  async createShipment() { return { partnerAwb: null, requiresManualAwb: true }; }
  async track(): Promise<PartnerTrackingEvent[]> { return []; }
  parseWebhook(): PartnerTrackingEvent[] { throw new Error('Generic provider does not accept webhooks'); }
}
