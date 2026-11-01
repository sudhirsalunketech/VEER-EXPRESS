import { Injectable } from '@nestjs/common';
import { DEMO_RATE_CARDS, normalizeStatus, type UnifiedStatus } from '@veer/core';
import type { CourierProvider, PartnerConfig } from './courier-provider';
import { MockCourierProvider } from './mock.provider';
import { BlueDartProvider } from './bluedart.provider';
import { TrackonProvider } from './trackon.provider';
import { GenericCourierProvider } from './generic.provider';

type AdapterName = 'MockCourierProvider' | 'BlueDartProvider' | 'TrackonProvider' | 'GenericCourierProvider';
const ADAPTERS: Record<AdapterName, new (c: PartnerConfig) => CourierProvider> = {
  MockCourierProvider, BlueDartProvider, TrackonProvider, GenericCourierProvider,
};

/** Default partner raw-status vocabulary used by mock/generic flows. Real partners configure their own map. */
export const DEFAULT_STATUS_MAP: Record<string, UnifiedStatus> = {
  BOOKED: 'BOOKED', MANIFESTED: 'BOOKED', PICKED: 'PICKED_UP', PICKED_UP: 'PICKED_UP', IN_TRANSIT: 'IN_TRANSIT', DISPATCHED: 'IN_TRANSIT',
  REACHED_DESTINATION: 'ARRIVED_AT_DESTINATION_HUB', ARRIVED_AT_DESTINATION_HUB: 'ARRIVED_AT_DESTINATION_HUB',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', OFD: 'OUT_FOR_DELIVERY', DELIVERED: 'DELIVERED',
  UNDELIVERED: 'EXCEPTION', CONSIGNEE_NOT_AVAILABLE: 'EXCEPTION', EXCEPTION: 'EXCEPTION',
};

export interface RegisteredPartner { config: PartnerConfig; adapter: AdapterName; provider: CourierProvider }

@Injectable()
export class CourierRegistry {
  private partners = new Map<string, RegisteredPartner>();

  register(config: PartnerConfig, adapter: AdapterName) {
    if (!ADAPTERS[adapter]) throw new Error(`Unknown adapter ${adapter}`);
    this.partners.set(config.code, { config, adapter, provider: new ADAPTERS[adapter](config) });
  }

  get(code: string): CourierProvider {
    const p = this.partners.get(code);
    if (!p) throw new Error(`Courier partner ${code} is not registered`);
    return p.provider;
  }

  normalize(code: string, raw: string): UnifiedStatus | null {
    const p = this.partners.get(code);
    return normalizeStatus(raw, { ...DEFAULT_STATUS_MAP, ...(p?.config.statusMap ?? {}) });
  }

  /** Safe listing for admin UI — never includes credentials or secrets. */
  list() {
    return [...this.partners.values()].map(({ config, adapter, provider }) => ({
      code: config.code, name: config.name, adapter, environment: config.environment, enabled: config.enabled,
      apiBaseUrl: config.apiBaseUrl ?? null, authType: config.authType, capabilities: provider.capabilities(),
      hasCredentials: !!config.credentials, webhookConfigured: !!config.webhookSecret,
    }));
  }

  /**
   * Demo wiring: every demo partner is backed by MockCourierProvider (no live APIs are called), and the
   * real-partner adapters are registered disabled so their structure is visible. Production loads from DB.
   */
  static demo(): CourierRegistry {
    const r = new CourierRegistry();
    for (const c of DEMO_RATE_CARDS) {
      r.register({ code: c.partnerCode, name: c.partnerName, environment: 'TEST', enabled: c.enabled, authType: 'NONE', statusMap: {}, webhookSecret: 'mock-webhook-secret' }, 'MockCourierProvider');
    }
    r.register({ code: 'BLUEDART_API', name: 'Blue Dart (API adapter — awaiting credentials)', environment: 'TEST', enabled: false, authType: 'API_KEY', statusMap: {} }, 'BlueDartProvider');
    r.register({ code: 'TRACKON_API', name: 'Trackon (API adapter — awaiting credentials)', environment: 'TEST', enabled: false, authType: 'API_KEY', statusMap: {} }, 'TrackonProvider');
    r.register({ code: 'GENERIC', name: 'Generic / manual partner', environment: 'PRODUCTION', enabled: true, authType: 'NONE', statusMap: {} }, 'GenericCourierProvider');
    return r;
  }
}
