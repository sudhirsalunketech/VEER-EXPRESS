import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, Info, MapPin, Package, Search } from 'lucide-react';
import { NEXT_STATUSES, SHOWCASE_TRACKING, STATUS_LABEL, type UnifiedStatus } from '@veer/core';
import { PRESENTER, demo } from '../demo/store';
import { useData, useLoad } from '../data/source';
import { StatusBadge, fmtDate } from './ui';

const MILESTONES: [UnifiedStatus, string][] = [
  ['BOOKED', 'Booked'], ['PICKED_UP', 'Pickup completed'], ['IN_TRANSIT', 'In transit'],
  ['ARRIVED_AT_DESTINATION_HUB', 'At destination hub'], ['OUT_FOR_DELIVERY', 'Out for delivery'], ['DELIVERED', 'Delivered'],
];
const SHORT: Record<UnifiedStatus, string> = { BOOKED: 'Booked', PICKED_UP: 'Picked up', IN_TRANSIT: 'In transit', ARRIVED_AT_DESTINATION_HUB: 'At hub', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', EXCEPTION: 'Exception' };

function relative(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60e3);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} hours ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export default function TrackingView({ initial, showDemoControls = false }: { initial?: string; showDemoControls?: boolean }) {
  const src = useData();
  const [input, setInput] = useState(initial ?? (src.kind === 'demo' ? SHOWCASE_TRACKING : ''));
  const [tn, setTn] = useState(initial ?? '');
  const [tick, setTick] = useState(0);
  const [demoMsg, setDemoMsg] = useState('');
  useEffect(() => { if (initial) { setInput(initial); setTn(initial); } }, [initial]);
  const isDemo = src.kind === 'demo';
  const { value: data, loading, error } = useLoad((d) => (tn ? d.track(tn) : Promise.resolve(null)), [tn, tick], null);

  // sample scenarios and presenter controls exist only for demo data
  const all = isDemo ? demo.shipments() : [];
  const samples = (['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'] as UnifiedStatus[])
    .map((st) => all.find((s) => s.status === st)).filter((s): s is NonNullable<typeof s> => !!s);
  const reached = new Set(data?.events.map((e) => e.status));
  const exception = data?.status === 'EXCEPTION';

  /** Presenter control: records the next update exactly as operations staff would (audited). */
  const simulate = (exc: boolean) => {
    if (!data) return;
    const cur = all.find((s) => s.trackingNumber === data.trackingNumber)!;
    const status: UnifiedStatus = exc ? 'EXCEPTION' : NEXT_STATUSES[cur.status].find((s) => s !== 'EXCEPTION' && s !== 'IN_TRANSIT') ?? NEXT_STATUSES[cur.status][0];
    const location = ['PICKED_UP'].includes(status) ? cur.origin : status === 'IN_TRANSIT' ? `${cur.origin} → ${cur.destination}` : cur.destination;
    const r = demo.addTrackingUpdate(PRESENTER, cur.trackingNumber, {
      status, occurredAt: new Date().toISOString(), location, verified: true,
      remarks: exc ? 'Delivery attempted — consignee unavailable. Re-attempt scheduled' : '',
    });
    setDemoMsg(r.ok ? '' : r.error);
    setTick((t) => t + 1);
  };

  return (
    <div className="space-y-5">
      <form className="card flex flex-col gap-2 p-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setTn(input.trim().toUpperCase()); }}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-navy-200" />
          <input className="input pl-9 font-mono uppercase" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Veer Express tracking number (e.g. VX…)" aria-label="Tracking number" />
        </div>
        <button className="btn-primary">Track shipment</button>
      </form>
      {isDemo && <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="text-navy-400">Demo scenarios:</span>
        {samples.map((s) => <button key={s.trackingNumber} onClick={() => { setInput(s.trackingNumber); setTn(s.trackingNumber); setDemoMsg(''); }} className="rounded-full border border-navy-100 px-2 py-0.5 hover:border-brand-500">{SHORT[s.status]}</button>)}
      </div>}

      {error && <div className="card p-6 text-center text-sm text-rose-700">{error}</div>}
      {tn && loading && !data && <div className="card p-6 text-center text-sm text-navy-400">Looking up {tn}…</div>}
      {tn && !loading && !error && !data && <div className="card p-6 text-center text-sm text-navy-400">No shipment found for <b>{tn}</b>. Check the number on your receipt.</div>}

      {data && (
        <div className="card animate-rise overflow-hidden" key={data.trackingNumber + data.events.length}>
          <div className="flex flex-wrap items-start justify-between gap-3 bg-navy-800 p-5 text-white">
            <div>
              <div className="text-xs uppercase tracking-widest text-navy-200">Veer Express tracking number</div>
              <div className="font-display text-2xl font-extrabold tracking-wider">{data.trackingNumber}</div>
              <div className="mt-1 text-sm text-navy-100">Booked {fmtDate(data.bookedAt)}</div>
            </div>
            <div className="text-right">
              <StatusBadge status={data.status} />
              <div className="mt-2 flex items-center justify-end gap-1 text-xs text-navy-100"><Clock className="h-3.5 w-3.5" />Last updated {fmtDate(data.lastUpdatedAt)} ({relative(data.lastUpdatedAt)})</div>
            </div>
          </div>
          <div className="grid gap-4 border-b border-navy-100 p-5 sm:grid-cols-3">
            <Info2 icon={<MapPin className="h-4 w-4" />} label="From" value={data.origin} />
            <Info2 icon={<MapPin className="h-4 w-4 text-brand-500" />} label="To" value={data.destination} />
            <Info2 icon={<Package className="h-4 w-4" />} label={data.status === 'DELIVERED' ? 'Delivered on' : 'Estimated delivery'} value={data.status === 'DELIVERED' ? fmtDate(data.events.at(-1)!.at) : data.eta ? new Date(data.eta).toDateString() : 'To be confirmed'} />
          </div>

          {!data.dispatched && <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-navy-50 p-3 text-sm text-navy-700"><Info className="mt-0.5 h-4 w-4 shrink-0" />Your shipment is booked. Our team is arranging dispatch with the best-fit courier — the next update will appear here once it is picked up.</div>}

          <div className="overflow-x-auto px-5 pt-5">
            <div className="flex min-w-[540px] items-start">
              {MILESTONES.map(([s, l], i) => {
                const done = reached.has(s);
                return (
                  <div key={s} className="flex flex-1 flex-col items-center text-center">
                    <div className="flex w-full items-center">
                      <div className={`h-1 flex-1 ${i === 0 ? 'opacity-0' : done ? 'bg-brand-500' : 'bg-navy-100'}`} />
                      {done ? <CheckCircle2 className="h-6 w-6 text-brand-500" /> : <Circle className="h-6 w-6 text-navy-100" />}
                      <div className={`h-1 flex-1 ${i === MILESTONES.length - 1 ? 'opacity-0' : reached.has(MILESTONES[i + 1][0]) ? 'bg-brand-500' : 'bg-navy-100'}`} />
                    </div>
                    <div className={`mt-2 text-[11px] font-semibold ${done ? 'text-navy-800' : 'text-navy-200'}`}>{l}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {exception && <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="h-4 w-4" />Delivery exception — our team will re-attempt. Contact support if you need help.</div>}

          <ol className="space-y-0 p-5">
            {[...data.events].reverse().map((e, i) => (
              <li key={i} className="relative border-l-2 border-navy-100 pb-5 pl-5 last:pb-0">
                <span className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${i === 0 ? 'bg-brand-500 ring-4 ring-brand-100' : 'bg-navy-200'}`} />
                <div className="text-sm font-semibold">{STATUS_LABEL[e.status]}{e.note && e.note !== STATUS_LABEL[e.status] && <span className="font-normal text-navy-600"> — {e.note}</span>}</div>
                <div className="text-xs text-navy-400">{fmtDate(e.at)} · {e.location}</div>
              </li>
            ))}
          </ol>
          <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">Tracking updates are checked and entered by the Veer Express operations team several times a day. This is not real-time GPS tracking — the time shown with each event is when it happened; "Last updated" is when we last recorded a change.</p>

          {showDemoControls && isDemo && data.status !== 'DELIVERED' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-amber-300 bg-amber-50 p-4 text-sm">
              <span className="font-semibold text-amber-900">Presenter controls (demo):</span>
              <button className="btn-navy py-1.5" onClick={() => simulate(false)}>Record next staff update</button>
              {data.status !== 'EXCEPTION' && <button className="btn-ghost py-1.5" onClick={() => simulate(true)}>Record delivery exception</button>}
              <span className="w-full text-xs text-amber-900">Each click records an update exactly as an operations executive would after checking the courier's site — it appears in the Tracking desk timeline and Audit log.</span>
              {demoMsg && <span className="w-full text-xs font-semibold text-rose-700">{demoMsg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Info2({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div><div className="label flex items-center gap-1">{icon}{label}</div><div className="font-semibold">{value}</div></div>;
}
