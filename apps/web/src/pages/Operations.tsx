/**
 * Manual operations screens (demo mode): courier allocation via the aggregator account,
 * the tracking desk for staff-entered updates, counter collections, ledger, payments and audit.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Copy, ExternalLink, Printer, Truck, X } from 'lucide-react';
import {
  DEMO_PRICING, DEMO_RATE_CARDS, NEXT_STATUSES, STALE_AFTER_HOURS, STATUS_LABEL, allocate, balanceDue, hoursSinceLastUpdate,
  trialBalance, type CollectionInput, type DemoShipment, type PaymentStatus, type UnifiedStatus,
} from '@veer/core';
import { can, demo, payStatus, type DemoUser } from '../demo/store';
import { useData, useLoad } from '../data/source';
import { DataTable, Kpi, StatusBadge, fmtDate, inr, type Column } from '../components/ui';
import { openPaymentReceipt } from '../components/receipt';

const branchName = (id: string) => demo.branches.find((b) => b.id === id)?.city ?? id;
const COURIERS = [...new Set(DEMO_RATE_CARDS.filter((c) => c.enabled).map((c) => c.partnerName)), 'Other'];
const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
const ago = (iso: string) => { const h = (Date.now() - new Date(iso).getTime()) / 3600e3; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };

export const PageHead = ({ t, s, children }: { t: string; s?: string; children?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-extrabold">{t}</h1>{s && <p className="text-sm text-navy-400">{s}</p>}</div>{children}</div>
);

const PAY_STYLE: Record<PaymentStatus, string> = {
  PAID: 'bg-emerald-50 text-emerald-700', PARTIALLY_PAID: 'bg-amber-50 text-amber-800', PENDING: 'bg-rose-50 text-rose-700', REFUNDED: 'bg-navy-50 text-navy-600',
};
const PAY_LABEL: Record<PaymentStatus, string> = { PAID: 'Paid', PARTIALLY_PAID: 'Part paid', PENDING: 'Payment due', REFUNDED: 'Refunded' };
export function PayBadge({ status }: { status: PaymentStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${PAY_STYLE[status]}`}>{PAY_LABEL[status]}</span>;
}
export const AllocBadge = ({ s }: { s: DemoShipment }) => s.allocation
  ? <span className="whitespace-nowrap text-xs"><b>{s.allocation.courierName}</b> <span className="font-mono text-navy-400">{s.allocation.awb}</span></span>
  : <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Awaiting allocation</span>;

function Msg({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ${ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-800'}`}>{ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{children}</span></div>;
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="block"><span className="label">{label}</span>{children}</label>;

// ---------------------------------------------------------------- allocation queue

export function AllocationQueue({ user, list, refresh, embedded = false }: { user: DemoUser; list: DemoShipment[]; refresh: () => void; embedded?: boolean }) {
  const queue = list.filter((s) => !s.allocation && s.status !== 'DELIVERED').sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  const recent = list.filter((s) => s.allocation).sort((a, b) => b.allocation!.allocatedAt.localeCompare(a.allocation!.allocatedAt)).slice(0, 6);
  const [tn, setTn] = useState<string | null>(null);
  const sel = list.find((s) => s.trackingNumber === (tn ?? queue[0]?.trackingNumber)) ?? null;
  const [form, setForm] = useState({ aggregatorRef: '', courier: '', other: '', awb: '', cost: '', reason: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rates = useMemo(() => {
    if (!sel) return [];
    try {
      return allocate(DEMO_RATE_CARDS, DEMO_PRICING, { originPin: sel.originPin, destPin: sel.destPin, actualWeightKg: sel.weightKg, dims: { lengthCm: 10, widthCm: 10, heightCm: 10 }, service: sel.service, declaredValue: 0, insurance: false }, 'CHEAPEST').candidates;
    } catch { return []; }
  }, [sel]);

  const pick = (s: DemoShipment) => { setTn(s.trackingNumber); setMsg(null); setForm({ aggregatorRef: s.allocation?.aggregatorRef ?? '', courier: s.allocation?.courierName ?? '', other: '', awb: s.allocation?.awb ?? '', cost: s.allocation ? String(s.allocation.partnerCost) : '', reason: '' }); };
  const src = useData();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!sel || busy) return;
    const courierName = form.courier === 'Other' ? form.other : form.courier;
    setBusy(true);
    const r = await src.allocate(user, sel.trackingNumber, { aggregatorRef: form.aggregatorRef, courierName, awb: form.awb.trim().toUpperCase(), partnerCost: Number(form.cost), ...(sel.allocation ? { reason: form.reason } : {}) });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `${sel.trackingNumber} allocated to ${courierName} (AWB ${form.awb.toUpperCase()}). Logged in audit trail.` });
    setForm({ aggregatorRef: '', courier: '', other: '', awb: '', cost: '', reason: '' }); setTn(null); refresh();
  };
  const allowed = can(user, 'allocate');

  return (
    <>
      {!embedded && <PageHead t="Allocation queue" s={`Book each shipment in the ${demo.aggregator}, then record the booking reference, courier and AWB here.`} />}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3 text-sm font-semibold">Awaiting allocation <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{queue.length}</span></div>
          <ul className="max-h-[420px] divide-y divide-navy-50 overflow-y-auto">
            {queue.map((s) => (
              <li key={s.trackingNumber}><button onClick={() => pick(s)} className={`w-full px-4 py-3 text-left text-sm hover:bg-brand-50/40 ${sel?.trackingNumber === s.trackingNumber ? 'bg-brand-50' : ''}`}>
                <div className="flex justify-between"><span className="font-mono font-semibold">{s.trackingNumber}</span><span className="text-xs text-navy-400">{ago(s.bookedAt)}</span></div>
                <div className="text-xs text-navy-400">{s.origin} → {s.destination} · {s.weightKg} kg · {s.service.toLowerCase()} · {branchName(s.branchId)}</div>
              </button></li>
            ))}
            {queue.length === 0 && <li className="px-4 py-8 text-center text-sm text-navy-400">All shipments are allocated. Book a new shipment to see it here.</li>}
          </ul>
          {recent.length > 0 && <>
            <div className="border-y border-navy-100 bg-navy-50/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-navy-400">Recently allocated (select to correct)</div>
            <ul className="divide-y divide-navy-50">{recent.map((s) => <li key={s.trackingNumber}><button onClick={() => pick(s)} className="flex w-full justify-between gap-2 px-4 py-2 text-left text-xs hover:bg-navy-50"><span className="font-mono">{s.trackingNumber}</span><AllocBadge s={s} /></button></li>)}</ul>
          </>}
        </div>

        <div className="card p-5 xl:col-span-3">
          {!sel ? <p className="py-10 text-center text-sm text-navy-400">Select a shipment.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><div className="font-mono text-lg font-bold">{sel.trackingNumber}</div><div className="text-sm text-navy-400">{sel.origin} ({sel.originPin}) → {sel.destination} ({sel.destPin}) · {sel.weightKg} kg chargeable · Veer {sel.service.toLowerCase()}</div></div>
              <div className="text-right text-sm"><div>Customer charge <b>{inr(sel.amount)}</b></div><PayBadge status={payStatus(sel)} /></div>
            </div>

            <div className="mt-4 rounded-xl border border-navy-100">
              <div className="flex items-center justify-between border-b border-navy-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-400">
                Step 1 · Compare in aggregator account <span className="demo-tag">sample rates</span>
              </div>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-navy-400"><tr><th className="px-3 py-2">Courier</th><th>Partner cost</th><th>Margin (ex-GST)</th><th>TAT</th><th /></tr></thead>
                <tbody>{rates.map((c, k) => (
                  <tr key={c.partnerCode} className="border-t border-navy-50">
                    <td className="px-3 py-2 font-semibold">{c.partnerName}{k === 0 && <span className="ml-2 rounded bg-emerald-50 px-1.5 text-[10px] text-emerald-700">cheapest</span>}</td>
                    <td>{inr(c.partnerCost)}</td><td className={sel.amount / 1.18 - c.partnerCost < 0 ? 'text-rose-600' : ''}>{inr(Math.round((sel.amount / 1.18 - c.partnerCost) * 100) / 100)}</td><td>{c.estimatedDays}d</td>
                    <td className="pr-3 text-right"><button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => setForm({ ...form, courier: COURIERS.includes(c.partnerName) ? c.partnerName : 'Other', other: c.partnerName, cost: String(c.partnerCost) })}>Use</button></td>
                  </tr>))}
                  {rates.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-navy-400">No sample rates for this route — enter the aggregator's rate manually.</td></tr>}
                </tbody>
              </table></div>
              <div className="flex items-center gap-2 border-t border-navy-100 px-3 py-2 text-xs text-navy-400"><ExternalLink className="h-3.5 w-3.5" />Production: "Open aggregator account" link configured per aggregator. Booking happens there, not in Veer.</div>
            </div>

            <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-navy-400">Step 2 · Record the aggregator booking</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Aggregator booking ref"><input className="input font-mono" value={form.aggregatorRef} onChange={(e) => setForm({ ...form, aggregatorRef: e.target.value })} placeholder="e.g. AGG-554321" /></Field>
              <Field label="Courier assigned"><select className="input" value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })}><option value="">Select courier</option>{COURIERS.map((c) => <option key={c}>{c}</option>)}</select></Field>
              {form.courier === 'Other' && <Field label="Courier name"><input className="input" value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} /></Field>}
              <Field label="Courier AWB"><input className="input font-mono uppercase" value={form.awb} onChange={(e) => setForm({ ...form, awb: e.target.value })} placeholder="As shown on the aggregator label" /></Field>
              <Field label="Partner cost charged (₹)"><input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
              {sel.allocation && <div className="sm:col-span-2"><Field label="Reason for re-allocation"><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Pickup missed, rebooked with another courier" /></Field></div>}
            </div>
            <button className="btn-primary mt-4 w-full" disabled={!allowed || busy} onClick={submit}><Truck className="h-4 w-4" />{sel.allocation ? 'Save correction (re-allocate)' : 'Save allocation'}</button>
            {!allowed && <p className="mt-2 text-xs text-navy-400">Your role can view but not allocate.</p>}
            {msg && <Msg ok={msg.ok}>{msg.text}</Msg>}
            <p className="mt-3 text-xs text-navy-400">Partner cost and courier details are internal. Customers continue to see only the Veer tracking number.</p>
          </>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tracking desk

export function TrackingDesk({ user, list, refresh, embedded = false }: { user: DemoUser; list: DemoShipment[]; refresh: () => void; embedded?: boolean }) {
  const active = list.filter((s) => s.allocation && s.status !== 'DELIVERED')
    .map((s) => ({ s, age: hoursSinceLastUpdate(s.events) })).sort((a, b) => b.age - a.age);
  const stale = active.filter((x) => x.age >= STALE_AFTER_HOURS).length;
  const [tn, setTn] = useState<string | null>(null);
  const sel = list.find((s) => s.trackingNumber === (tn ?? active[0]?.s.trackingNumber)) ?? null;
  const next = sel ? NEXT_STATUSES[sel.status] : [];
  const blank = () => ({ status: (next[0] ?? 'IN_TRANSIT') as UnifiedStatus, occurredAt: localNow(), location: '', remarks: '', verified: false });
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const choose = (s: DemoShipment) => { setTn(s.trackingNumber); setMsg(null); setForm({ ...blank(), status: NEXT_STATUSES[s.status][0] }); };
  const src = useData();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!sel || busy) return;
    const status = next.includes(form.status) ? form.status : next[0];
    setBusy(true);
    const r = await src.addTrackingUpdate(user, sel.trackingNumber, { ...form, status, occurredAt: new Date(form.occurredAt).toISOString() });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `Recorded "${STATUS_LABEL[status]}" for ${sel.trackingNumber}. Customer tracking now shows this update.` });
    setForm({ ...blank(), status: NEXT_STATUSES[status][0] ?? 'IN_TRANSIT' }); refresh();
  };
  const allowed = can(user, 'track');

  return (
    <>
      {!embedded && <PageHead t="Tracking desk" s="Check each shipment on the courier's tracking page and record what it shows. Updates are manual — not real-time." />}
      <div className="mb-4 grid grid-cols-3 gap-3"><Kpi label="Active shipments" value={String(active.length)} /><Kpi label={`Not updated ${STALE_AFTER_HOURS}h+`} value={String(stale)} hint="Check these first" /><Kpi label="Exceptions" value={String(active.filter((x) => x.s.status === 'EXCEPTION').length)} /></div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="border-b border-navy-100 px-4 py-3 text-sm font-semibold">Update queue · oldest first</div>
          <ul className="max-h-[520px] divide-y divide-navy-50 overflow-y-auto">
            {active.map(({ s, age }) => (
              <li key={s.trackingNumber}><button onClick={() => choose(s)} className={`w-full px-4 py-3 text-left text-sm hover:bg-brand-50/40 ${sel?.trackingNumber === s.trackingNumber ? 'bg-brand-50' : ''}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-mono font-semibold">{s.trackingNumber}</span><StatusBadge status={s.status} /></div>
                <div className="mt-1 flex items-center justify-between text-xs text-navy-400"><span>{s.allocation!.courierName} · {s.destination}</span>
                  <span className={`flex items-center gap-1 ${age >= STALE_AFTER_HOURS ? 'font-semibold text-rose-600' : ''}`}><Clock className="h-3 w-3" />{ago(s.events.at(-1)!.recordedAt)}</span></div>
              </button></li>
            ))}
            {active.length === 0 && <li className="px-4 py-8 text-center text-sm text-navy-400">No active allocated shipments.</li>}
          </ul>
        </div>

        <div className="card p-5 xl:col-span-3">
          {!sel ? <p className="py-10 text-center text-sm text-navy-400">Select a shipment.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><div className="font-mono text-lg font-bold">{sel.trackingNumber}</div><div className="text-sm text-navy-400">{sel.origin} → {sel.destination}</div></div>
              <StatusBadge status={sel.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-navy-50 p-3 text-sm">
              <span className="text-navy-400">Courier</span><b>{sel.allocation!.courierName}</b>
              <span className="ml-2 text-navy-400">AWB</span><span className="font-mono font-semibold">{sel.allocation!.awb}</span>
              <button className="btn-ghost py-1 text-xs" onClick={() => { navigator.clipboard?.writeText(sel.allocation!.awb).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}><Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy AWB'}</button>
              <span className="w-full text-xs text-navy-400">Look up this AWB on the courier's own tracking page, then record what it shows below. (Courier tracking links are configured per courier in production.)</span>
            </div>

            {sel.status === 'DELIVERED' ? <Msg ok>Delivered — no further updates.</Msg> : <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="New status"><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as UnifiedStatus })}>{next.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</select></Field>
                <Field label="Event time (as shown by courier)"><input className="input" type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></Field>
                <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={`e.g. ${sel.destination} hub`} /></Field>
                <Field label={form.status === 'EXCEPTION' ? 'Remarks (required)' : 'Remarks (shown to customer)'}><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder={form.status === 'EXCEPTION' ? 'e.g. Consignee not available' : 'Optional'} /></Field>
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />I verified this update on the courier's tracking page for AWB {sel.allocation!.awb}.</label>
              <button className="btn-primary mt-4 w-full" disabled={!allowed || busy} onClick={submit}>Record update</button>
              {!allowed && <p className="mt-2 text-xs text-navy-400">Your role can view but not record updates.</p>}
            </>}
            {msg && <Msg ok={msg.ok}>{msg.text}</Msg>}

            <h3 className="mt-6 text-sm font-semibold">Audit timeline</h3>
            <ol className="mt-2 space-y-2 text-sm">{[...sel.events].reverse().map((e, i) => (
              <li key={i} className="border-l-2 border-brand-500 pl-3">
                <b>{STATUS_LABEL[e.status]}</b> · {e.location}{e.note && e.note !== STATUS_LABEL[e.status] && <span className="text-navy-400"> — {e.note}</span>}
                <div className="text-xs text-navy-400">Occurred {fmtDate(e.at)} · recorded {fmtDate(e.recordedAt)} by {e.recordedBy} · {e.source.toLowerCase()}</div>
              </li>))}</ol>
          </>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- counter collection

export function CounterCollection({ user, list, refresh, embedded = false }: { user: DemoUser; list: DemoShipment[]; refresh: () => void; embedded?: boolean }) {
  const due = list.filter((s) => balanceDue(s.amount, s.payments) > 0).sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  const [tn, setTn] = useState<string | null>(null);
  const sel = list.find((s) => s.trackingNumber === (tn ?? due[0]?.trackingNumber)) ?? null;
  const bal = sel ? balanceDue(sel.amount, sel.payments) : 0;
  const [form, setForm] = useState<{ method: CollectionInput['method']; amount: string; reference: string }>({ method: 'CASH', amount: '', reference: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string; print?: () => void } | null>(null);

  const src = useData();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!sel || busy) return;
    setBusy(true);
    const r = await src.collect(user, sel.trackingNumber, { method: form.method, amount: Number(form.amount || bal), reference: form.reference });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    const { shipment, payment } = r.value;
    const branch = demo.branches.find((b) => b.id === shipment.branchId);
    setMsg({ ok: true, text: `Receipt ${payment.receiptNo} · ${inr(payment.amount)} recorded by ${payment.collectedBy}.`, print: () => openPaymentReceipt({ shipment, payment, branchName: branch?.name ?? shipment.branchId }) });
    setForm({ method: 'CASH', amount: '', reference: '' }); setTn(null); refresh();
  };

  return (
    <>
      {!embedded && <PageHead t="Counter collection" s="Record cash, UPI or card payments taken at the branch counter. Each collection gets a branch receipt number." />}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3 text-sm font-semibold">Payment due <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{due.length}</span></div>
          <ul className="max-h-[420px] divide-y divide-navy-50 overflow-y-auto">
            {due.map((s) => (
              <li key={s.trackingNumber}><button onClick={() => { setTn(s.trackingNumber); setMsg(null); }} className={`w-full px-4 py-3 text-left text-sm hover:bg-brand-50/40 ${sel?.trackingNumber === s.trackingNumber ? 'bg-brand-50' : ''}`}>
                <div className="flex justify-between"><span className="font-mono font-semibold">{s.trackingNumber}</span><b>{inr(balanceDue(s.amount, s.payments))}</b></div>
                <div className="mt-1 flex items-center justify-between text-xs text-navy-400"><span>{branchName(s.branchId)} · {s.paymentMode === 'CREDIT' ? 'credit account' : 'pay at counter'}</span><StatusBadge status={s.status} /></div>
              </button></li>
            ))}
            {due.length === 0 && <li className="px-4 py-8 text-center text-sm text-navy-400">No payments due.</li>}
          </ul>
        </div>
        <div className="card p-5 xl:col-span-3">
          {msg?.ok && msg.print && <div className="mb-4"><Msg ok>{msg.text}</Msg><button className="btn-ghost mt-2" onClick={msg.print}><Printer className="h-4 w-4" />Print payment receipt</button></div>}
          {!sel ? <p className="py-10 text-center text-sm text-navy-400">Select a shipment with a balance due.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><div className="font-mono text-lg font-bold">{sel.trackingNumber}</div><div className="text-sm text-navy-400">{sel.origin} → {sel.destination} · {branchName(sel.branchId)}</div></div>
              <div className="text-right"><PayBadge status={payStatus(sel)} /><div className="mt-1 text-xs text-navy-400">Shipment: {STATUS_LABEL[sel.status]}</div></div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-navy-50 p-3">Charge<br /><b>{inr(sel.amount)}</b></div>
              <div className="rounded-lg bg-navy-50 p-3">Received<br /><b>{inr(Math.round((sel.amount - bal) * 100) / 100)}</b></div>
              <div className="rounded-lg bg-rose-50 p-3">Balance due<br /><b>{inr(bal)}</b></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Method"><select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as CollectionInput['method'] })}><option value="CASH">Cash</option><option value="COUNTER_UPI">UPI at counter</option><option value="COUNTER_CARD">Card at counter</option></select></Field>
              <Field label="Amount (₹)"><input className="input" type="number" min="0" step="0.01" placeholder={bal.toFixed(2)} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label={form.method === 'CASH' ? 'Reference (optional)' : form.method === 'COUNTER_UPI' ? 'UPI transaction ID' : 'Card slip no.'}><input className="input font-mono" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            </div>
            <button className="btn-primary mt-4 w-full" disabled={!can(user, 'collect') || busy} onClick={submit}>Record collection{src.kind === 'demo' ? ' (simulated)' : ''}</button>
            {msg && !msg.ok && <Msg ok={false}>{msg.text}</Msg>}
            <p className="mt-3 text-xs text-navy-400">Collecting payment never changes the shipment's tracking status — the two are tracked independently.</p>
            {sel.payments.length > 0 && <>
              <h3 className="mt-5 text-sm font-semibold">Payments on this shipment</h3>
              <ul className="mt-2 space-y-1 text-sm">{sel.payments.map((p) => <li key={p.id} className="flex justify-between border-b border-navy-50 py-1"><span>{fmtDate(p.at)} · {p.method.replace(/_/g, ' ').toLowerCase()} · {p.receiptNo ?? p.reference}</span><b>{inr(p.amount)}</b></li>)}</ul>
            </>}
          </>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- finance & audit

export function PaymentsPage({ list }: { list: DemoShipment[] }) {
  const rows = list.flatMap((s) => s.payments.map((p) => ({ ...p, tn: s.trackingNumber, branch: branchName(s.branchId) }))).sort((a, b) => b.at.localeCompare(a.at));
  const total = rows.reduce((a, p) => a + p.amount, 0);
  const due = list.reduce((a, s) => a + balanceDue(s.amount, s.payments), 0);
  return (
    <>
      <PageHead t="Payments" s="Gateway and counter payment records. All are simulated in demo mode — no real money received." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Received (simulated)" value={inr(Math.round(total))} />
        <Kpi label="Outstanding" value={inr(Math.round(due))} hint="Counter / credit dues" />
        <Kpi label="Gateway payments" value={String(rows.filter((p) => p.method.endsWith('GATEWAY')).length)} />
        <Kpi label="Counter receipts" value={String(rows.filter((p) => p.receiptNo).length)} />
      </div>
      <DataTable title="Payments" rows={rows} filters={[{ label: 'methods', options: [...new Set(rows.map((r) => r.method))], get: (r) => r.method }, { label: 'branches', options: demo.branches.map((b) => b.city), get: (r) => r.branch }]}
        columns={[{ key: 'at', label: 'Time', render: (r) => fmtDate(r.at), value: (r) => r.at }, { key: 'tn', label: 'Shipment', render: (r) => <span className="font-mono">{r.tn}</span> }, { key: 'branch', label: 'Branch' },
          { key: 'method', label: 'Method', value: (r) => r.method.replace(/_/g, ' ') }, { key: 'receiptNo', label: 'Receipt / ref', value: (r) => r.receiptNo ?? r.reference ?? '' },
          { key: 'collectedBy', label: 'Collected by' }, { key: 'amount', label: 'Amount', render: (r) => inr(r.amount), value: (r) => r.amount }]} />
    </>
  );
}

export function LedgerPage({ list }: { list: DemoShipment[] }) {
  const src = useData();
  const { value: entries, error } = useLoad((d) => d.ledger(list), [list], [] as ReturnType<typeof demo.ledger>);
  const tb = trialBalance(entries);
  return (
    <>
      <PageHead t="Financial ledger" s="Double-entry journal generated from bookings, payments and courier allocations. Entries are never edited — corrections are reversals." />
      <div className={`mb-4 flex items-center gap-2 rounded-xl p-3 text-sm ${tb.balanced ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-800'}`}>
        {tb.balanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        Trial balance {tb.balanced ? 'balanced' : 'NOT balanced'}: debits {inr(tb.debit)} · credits {inr(tb.credit)} {src.kind === 'demo' && <span className="demo-tag ml-auto">sample figures</span>}
      </div>
      {error && <p className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{tb.rows.map((r) => <Kpi key={r.account} label={r.account} value={inr(Math.abs(r.balance))} hint={r.balance >= 0 ? 'Debit balance' : 'Credit balance'} />)}</div>
      <DataTable title="Ledger entries" rows={entries} pageSize={12} filters={[{ label: 'accounts', options: tb.rows.map((r) => r.account), get: (e) => e.account }]}
        columns={[{ key: 'at', label: 'Date', render: (e) => fmtDate(e.at), value: (e) => e.at }, { key: 'ref', label: 'Shipment', render: (e) => <span className="font-mono">{e.ref}</span> }, { key: 'account', label: 'Account' },
          { key: 'debit', label: 'Debit', render: (e) => e.debit ? inr(e.debit) : '', value: (e) => e.debit }, { key: 'credit', label: 'Credit', render: (e) => e.credit ? inr(e.credit) : '', value: (e) => e.credit }, { key: 'memo', label: 'Memo' }]} />
    </>
  );
}

export function AuditPage() {
  const { value: rows, error } = useLoad((d) => d.audit(), [], [] as Awaited<ReturnType<ReturnType<typeof useData>['audit']>>);
  return (
    <>
      <PageHead t="Audit logs" s="Allocations, tracking updates, collections and configuration changes — who, what and when." />
      {error && <p className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <DataTable title="Audit log" rows={rows} filters={[{ label: 'actions', options: [...new Set(rows.map((r) => r.action))], get: (r) => r.action }]}
        columns={[{ key: 'at', label: 'Time', render: (r) => fmtDate(r.at), value: (r) => r.at }, { key: 'who', label: 'User' }, { key: 'role', label: 'Role' }, { key: 'action', label: 'Action' }, { key: 'ref', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.ref}</span> }, { key: 'detail', label: 'Detail', render: (r) => <span className="whitespace-normal">{r.detail}</span> }]} />
    </>
  );
}

// ---------------------------------------------------------------- shipment detail

export function ShipmentDrawer({ s, internal, onClose, base }: { s: DemoShipment; internal: boolean; onClose: () => void; base: string }) {
  const rows: [string, ReactNode][] = [
    ['Route', `${s.origin} → ${s.destination}`], ['Service', s.service], ['Branch', branchName(s.branchId)], ['Booked', fmtDate(s.bookedAt)],
    ['Customer charge', inr(s.amount)], ['Payment', <PayBadge key="p" status={payStatus(s)} />], ['Balance due', inr(balanceDue(s.amount, s.payments))], ['Last update', ago(s.events.at(-1)!.recordedAt)],
  ];
  if (internal && s.allocation) rows.push(['Courier', s.allocation.courierName], ['Courier AWB', <span key="a" className="font-mono">{s.allocation.awb}</span>], ['Aggregator ref', s.allocation.aggregatorRef], ['Partner cost', inr(s.allocation.partnerCost)], ['Gross margin', inr(Math.round((s.amount / 1.18 - s.allocation.partnerCost) * 100) / 100)], ['Allocated by', `${s.allocation.allocatedBy}, ${fmtDate(s.allocation.allocatedAt)}`]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-900/40" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between"><h2 className="font-mono text-lg font-bold">{s.trackingNumber}</h2><button onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="mt-3 flex flex-wrap gap-2"><StatusBadge status={s.status} /><AllocBadge s={s} /></div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">{rows.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
        {internal && <div className="mt-4 flex flex-wrap gap-2">
          {!s.allocation && <Link className="btn-primary py-1.5" to={`${base}/allocation`}>Allocate courier</Link>}
          {s.allocation && s.status !== 'DELIVERED' && <Link className="btn-navy py-1.5" to={`${base}/tracking-desk`}>Record tracking update</Link>}
          {balanceDue(s.amount, s.payments) > 0 && <Link className="btn-ghost py-1.5" to={`${base}/collections`}>Collect payment</Link>}
        </div>}
        <h3 className="mt-6 text-sm font-semibold">Timeline</h3>
        <ol className="mt-2 space-y-2 text-sm">{[...s.events].reverse().map((e, i) => <li key={i} className="border-l-2 border-brand-500 pl-3"><b>{STATUS_LABEL[e.status]}</b> · {e.location}<div className="text-xs text-navy-400">{fmtDate(e.at)}{internal && ` · recorded by ${e.recordedBy}`}</div></li>)}</ol>
      </div>
    </div>
  );
}

export function shipmentColumns(internal: boolean): Column<DemoShipment>[] {
  const cols: Column<DemoShipment>[] = [
    { key: 'trackingNumber', label: 'Veer tracking #', render: (s) => <span className="font-mono font-semibold">{s.trackingNumber}</span> },
    { key: 'bookedAt', label: 'Booked', render: (s) => fmtDate(s.bookedAt), value: (s) => s.bookedAt },
    { key: 'route', label: 'Route', render: (s) => `${s.origin} → ${s.destination}`, value: (s) => `${s.origin} → ${s.destination}` },
    { key: 'branch', label: 'Branch', value: (s) => branchName(s.branchId) },
    { key: 'status', label: 'Shipment', render: (s) => <StatusBadge status={s.status} />, value: (s) => STATUS_LABEL[s.status] },
    { key: 'payment', label: 'Payment', render: (s) => <PayBadge status={payStatus(s)} />, value: (s) => payStatus(s) },
    { key: 'amount', label: 'Customer ₹', render: (s) => inr(s.amount), value: (s) => s.amount },
  ];
  if (internal) cols.push(
    { key: 'courier', label: 'Courier / AWB', render: (s) => <AllocBadge s={s} />, value: (s) => s.allocation ? `${s.allocation.courierName} ${s.allocation.awb}` : 'Awaiting allocation' },
    { key: 'partnerCost', label: 'Partner ₹', render: (s) => s.allocation ? inr(s.allocation.partnerCost) : '—', value: (s) => s.allocation?.partnerCost ?? '' },
  );
  return cols;
}
