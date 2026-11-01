import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, type PincodeOffice, type Repository } from '../../database/repository';

export interface PincodeInfo {
  pin: string;
  found: boolean;
  /** Short display name, e.g. "Andheri, Mumbai". */
  label: string | null;
  district: string | null;
  state: string | null;
  areas: string[];
  deliverable: boolean | null;
  source: 'LOCAL_DIRECTORY' | 'INDIA_POST' | 'NONE';
  /** true when the outside service could not be reached — the PIN may still be valid. */
  unverified: boolean;
}

const TTL_FOUND = 24 * 3600e3;
const TTL_MISS = 3600e3;
const MAX_CACHE = 5000;
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * PIN code lookup: the local India Post directory first, then the free India Post lookup service
 * (api.postalpincode.in — no key, no SLA), cached in memory. Never fails a booking on its own.
 */
@Injectable()
export class PincodeService {
  private readonly log = new Logger('Pincodes');
  private cache = new Map<string, { at: number; info: PincodeInfo }>();
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  /** Overridable for tests. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  async lookup(pin: string): Promise<PincodeInfo> {
    const hit = this.cache.get(pin);
    if (hit && Date.now() - hit.at < (hit.info.found ? TTL_FOUND : TTL_MISS)) return hit.info;

    const local = await this.repo.pincodeOffices(pin);
    if (local.length) return this.remember(pin, this.build(pin, local, 'LOCAL_DIRECTORY'));

    try {
      const res = await this.fetcher(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { Status: string; PostOffice: { Name: string; BranchType?: string; DeliveryStatus?: string; District: string; State: string }[] | null }[];
      const offices = (body?.[0]?.PostOffice ?? []).map((o) => ({
        name: tidy(o.Name), officeType: o.BranchType ?? null, delivery: o.DeliveryStatus !== 'Non-Delivery', district: tidy(o.District), state: tidy(o.State),
      }));
      return this.remember(pin, offices.length ? this.build(pin, offices, 'INDIA_POST') : this.none(pin, false));
    } catch (e) {
      this.log.warn(`India Post lookup failed for ${pin}: ${(e as Error).message}`);
      return this.none(pin, true); // not cached: try again next time
    }
  }

  private build(pin: string, offices: PincodeOffice[], source: PincodeInfo['source']): PincodeInfo {
    const head = offices.find((o) => /head/i.test(o.officeType ?? '') || o.officeType === 'H.O') ?? offices[0];
    const areas = [...new Set(offices.map((o) => o.name))];
    const district = head.district;
    const place = areas.length === 1 || !head ? areas[0] : head.name;
    return {
      pin, found: true, district, state: head.state, areas: areas.slice(0, 12),
      label: place && place.toLowerCase() !== district.toLowerCase() ? `${place}, ${district}` : district,
      deliverable: offices.some((o) => o.delivery), source, unverified: false,
    };
  }

  private none(pin: string, unverified: boolean): PincodeInfo {
    return { pin, found: false, label: null, district: null, state: null, areas: [], deliverable: null, source: 'NONE', unverified };
  }

  private remember(pin: string, info: PincodeInfo) {
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(pin, { at: Date.now(), info });
    return info;
  }
}
