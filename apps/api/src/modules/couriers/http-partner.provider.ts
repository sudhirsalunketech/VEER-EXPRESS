import type { BookingRequest, BookingResult, CourierProvider, PartnerConfig, PartnerTrackingEvent, Serviceability } from './courier-provider';
import { ProviderNotConfiguredError } from './courier-provider';

/**
 * Base for HTTP-API partners. Subclasses map Veer requests to the partner's documented payloads.
 * Nothing here is enabled until endpoints + credentials are configured AND verified in the partner sandbox.
 */
export abstract class HttpPartnerProvider implements CourierProvider {
  readonly code: string;
  constructor(protected readonly cfg: PartnerConfig) { this.code = cfg.code; }

  capabilities() {
    const e = this.cfg.endpoints ?? {};
    return { booking: !!e.booking, tracking: !!e.tracking, rates: !!e.rates, serviceability: !!e.serviceability, webhooks: !!this.cfg.webhookSecret };
  }

  protected endpoint(kind: keyof NonNullable<PartnerConfig['endpoints']>): string {
    const path = this.cfg.endpoints?.[kind];
    if (!this.cfg.apiBaseUrl || !path || !this.cfg.credentials) throw new ProviderNotConfiguredError(this.cfg.name, `${kind} API`);
    return new URL(path, this.cfg.apiBaseUrl).toString();
  }

  protected async call<T>(kind: 'booking' | 'tracking' | 'rates' | 'serviceability', body: unknown): Promise<T> {
    const url = this.endpoint(kind);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...this.authHeaders() }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${this.cfg.name} ${kind} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Build auth headers from decrypted credentials per partner auth scheme. */
  protected abstract authHeaders(): Record<string, string>;
  protected abstract toPartnerBooking(req: BookingRequest): unknown;
  protected abstract fromPartnerBooking(res: unknown): BookingResult;
  protected abstract fromPartnerTracking(res: unknown): PartnerTrackingEvent[];

  async checkServiceability(originPin: string, destPin: string): Promise<Serviceability> {
    if (!this.capabilities().serviceability) return { serviceable: true, source: 'RATE_TABLE' }; // fall back to courier_serviceability table
    const r = await this.call<{ serviceable?: boolean }>('serviceability', { originPin, destPin });
    return { serviceable: !!r.serviceable, source: 'API' };
  }
  async createShipment(req: BookingRequest) {
    if (!this.capabilities().booking) return { partnerAwb: null, requiresManualAwb: true };
    return this.fromPartnerBooking(await this.call('booking', this.toPartnerBooking(req)));
  }
  async track(awb: string) {
    if (!this.capabilities().tracking) return [];
    return this.fromPartnerTracking(await this.call('tracking', { awb }));
  }
  parseWebhook(): PartnerTrackingEvent[] {
    throw new ProviderNotConfiguredError(this.cfg.name, 'webhook verification');
  }
}
