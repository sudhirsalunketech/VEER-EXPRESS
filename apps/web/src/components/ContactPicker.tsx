/**
 * Auto-fill for sender / receiver.
 *  - Counter staff: searches the branch address book on the server (name or mobile).
 *  - Customers: their own contacts saved on this device only ("Remember my details").
 */
import { useEffect, useRef, useState } from 'react';
import { BookUser, Loader2, Search, X } from 'lucide-react';
import { useData } from '../data/source';
import type { DemoUser } from '../demo/store';
import { findMyContacts, forgetContact, type MyContact } from '../lib/myContacts';

export interface PickedContact { name: string; phone: string; email: string; address: string; pin: string }
const mask = (p: string) => p.replace(/^(\d{2})\d{5}(\d{3})$/, '$1xxxxx$2');

export default function ContactPicker({ role, staff, onPick }: { role: 'SENDER' | 'RECEIVER'; staff?: DemoUser; onPick: (c: PickedContact) => void }) {
  const src = useData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickedContact[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ver, setVer] = useState(0); // re-read device contacts after "forget"
  const box = useRef<HTMLDivElement>(null);
  const local = !staff;
  const saved = local ? findMyContacts(role, '') : [];
  void ver;

  useEffect(() => {
    if (local) { setResults(findMyContacts(role, q)); return; }
    if (q.trim().length < 2) { setResults([]); setState('idle'); return; }
    let live = true; setState('loading');
    const t = setTimeout(() => {
      src.searchContacts(staff!, q).then(
        (r) => { if (live) { setResults(r.map((c) => ({ name: c.name, phone: c.phone, email: c.email ?? '', address: c.address, pin: c.pin }))); setState('idle'); } },
        () => live && setState('error'));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, local, role, src, staff?.role, staff?.branchId, ver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // close the list when clicking elsewhere
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  if (local && saved.length === 0) return null;
  const pick = (c: PickedContact) => { onPick(c); setOpen(false); setQ(''); };

  return (
    <div ref={box} className="relative mb-4">
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-navy-200 bg-navy-50/50 p-2">
        <BookUser className="ml-1 h-4 w-4 shrink-0 text-brand-600" />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-navy-200" />
          <input className="input h-9 py-1.5 pl-8 text-sm" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            aria-label={`Search saved ${role === 'SENDER' ? 'senders' : 'receivers'}`}
            placeholder={staff ? 'Search customers by name or mobile…' : `Search your saved ${role === 'SENDER' ? 'senders' : 'receivers'}…`} />
        </div>
        {state === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-navy-400" />}
      </div>
      {local && !open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {saved.slice(0, 3).map((c) => (
            <button key={c.phone + c.name} onClick={() => pick(c)} className="rounded-full border border-navy-100 bg-white px-3 py-1 text-xs font-semibold text-navy-700 hover:border-brand-500">
              {c.name} · {mask(c.phone)}
            </button>))}
        </div>)}
      {open && (local || q.trim().length >= 2) && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-navy-100 bg-white py-1 shadow-card">
          {state === 'error' && <li className="px-3 py-2 text-sm text-rose-700">Could not search the address book. Enter the details manually.</li>}
          {state !== 'error' && results.length === 0 && state !== 'loading' && <li className="px-3 py-2 text-sm text-navy-400">No saved contacts match “{q}”.</li>}
          {results.map((c) => (
            <li key={c.phone + c.name} className="flex items-start gap-2 px-3 py-2 hover:bg-navy-50">
              <button role="option" aria-selected="false" className="flex-1 text-left" onClick={() => pick(c)}>
                <div className="text-sm font-semibold text-navy-800">{c.name} <span className="font-normal text-navy-400">· {mask(c.phone)}</span></div>
                <div className="truncate text-xs text-navy-400">{c.address} · PIN {c.pin}{c.email && ` · ${c.email}`}</div>
              </button>
              {local && <button aria-label={`Forget ${c.name}`} title="Forget on this device" className="rounded p-1 text-navy-200 hover:bg-rose-50 hover:text-rose-600"
                onClick={() => { forgetContact({ role, name: c.name, phone: c.phone }); setVer((v) => v + 1); }}><X className="h-3.5 w-3.5" /></button>}
            </li>))}
        </ul>)}
    </div>
  );
}

export type { MyContact };
