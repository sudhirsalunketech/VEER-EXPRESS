import type { BookingRequest, BookingResult, PartnerTrackingEvent } from './courier-provider';
import { ProviderNotConfiguredError } from './courier-provider';
import { HttpPartnerProvider } from './http-partner.provider';

/**
 * BlueDart adapter — STRUCTURE ONLY. Not operational.
 *
 * To activate: obtain API access from BlueDart for this franchise account, record the documented endpoint
 * paths in courier_partners/config, store credentials encrypted in courier_credentials, implement the
 * payload mappings below against the official spec, and verify end-to-end in the partner's test environment.
 * Until then booking returns requiresManualAwb=true and staff enter the AWB via the Generic flow.
 */
export class BlueDartProvider extends HttpPartnerProvider {
  protected authHeaders(): Record<string, string> {
    throw new ProviderNotConfiguredError(this.cfg.name, 'authentication');
  }
  protected toPartnerBooking(_req: BookingRequest): unknown {
    throw new ProviderNotConfiguredError(this.cfg.name, 'booking payload mapping');
  }
  protected fromPartnerBooking(_res: unknown): BookingResult {
    throw new ProviderNotConfiguredError(this.cfg.name, 'booking response mapping');
  }
  protected fromPartnerTracking(_res: unknown): PartnerTrackingEvent[] {
    throw new ProviderNotConfiguredError(this.cfg.name, 'tracking response mapping');
  }
}
