/** PIN code lookup via the Veer API (local India Post directory → free India Post service). */
import { useEffect, useState } from 'react';
import { call } from './api';

export interface PincodeInfo {
  pin: string; found: boolean; label: string | null; district: string | null; state: string | null;
  areas: string[]; deliverable: boolean | null; source: string; unverified: boolean;
}
export type PinState = { status: 'idle' } | { status: 'checking' } | { status: 'unavailable' } | { status: 'done'; info: PincodeInfo };

const cache = new Map<string, PincodeInfo>();
const pending = new Map<string, Promise<PincodeInfo>>();

export function lookupPincode(pin: string): Promise<PincodeInfo> {
  const hit = cache.get(pin);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(pin);
  if (!p) {
    p = call<PincodeInfo>(`/public/pincodes/${pin}`)
      .then((info) => { if (!info.unverified) cache.set(pin, info); return info; })
      .finally(() => pending.delete(pin));
    pending.set(pin, p);
  }
  return p;
}

/** Looked-up city (district) for a PIN if known, else the given fallback. Synchronous: uses the cache only. */
export const knownPlace = (pin: string, fallback: string) => cache.get(pin)?.district ?? fallback;

/** Looks the PIN up once it has 6 digits (debounced). 'unavailable' = the API could not be reached. */
export function usePincode(pin: string): PinState {
  const [state, setState] = useState<PinState>({ status: 'idle' });
  useEffect(() => {
    if (!/^[1-9][0-9]{5}$/.test(pin)) { setState({ status: 'idle' }); return; }
    const hit = cache.get(pin);
    if (hit) { setState({ status: 'done', info: hit }); return; }
    let live = true;
    setState({ status: 'checking' });
    const t = setTimeout(() => {
      lookupPincode(pin).then((info) => live && setState({ status: 'done', info }), () => live && setState({ status: 'unavailable' }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [pin]);
  return state;
}
