import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, Check, CheckCircle2, CreditCard, Download, Landmark, Link2, Loader2, MessageCircle, Printer, QrCode, Share2, Store, Wallet } from 'lucide-react';
import {
  DEMO_PRICING, DEMO_RATE_CARDS, allocate, isValidPin, toCustomerQuote,
  type InternalQuote, type ServiceType, type ShipmentKind,
} from '@veer/core';
import { type DemoUser } from '../demo/store';
import { useData, type BookingResult } from '../data/source';
import { inr } from './ui';
import type { ReceiptData } from './receipt';
import { downloadDocket, printDocket, shareDocket, whatsappShareUrl } from './docket';
import { knownPlace, usePincode, type PinState } from '../lib/pincode';
import ContactPicker from './ContactPicker';
import { rememberContact } from '../lib/myContacts';

const STEPS = ['Route', 'Package', 'Weight', 'Price', 'Sender', 'Receiver', 'Review', 'Payment', 'Confirmed'];
const PIN_CITY: Record<string, string> = { '410': 'Navi Mumbai', '411': 'Pune', '400': 'Mumbai', '422': 'Nashik', '110': 'New Delhi', '560': 'Bengaluru', '600': 'Chennai', '700': 'Kolkata', '500': 'Hyderabad', '302': 'Jaipur', '781': 'Guwahati', '380': 'Ahmedabad', '226': 'Lucknow' };
/** City for a PIN: the India Post lookup when it has run, else the built-in sample list. */
export const cityFor = (pin: string) => knownPlace(pin, PIN_CITY[pin.slice(0, 3)] ?? `PIN ${pin}`);

interface Party { name: string; phone: string; address: string; email: string }
const emptyParty: Party = { name: '', phone: '', address: '', email: '' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function BookingWizard({ preset, compact = false, staff, onBooked }: { preset?: Partial<{ from: string; to: string; weight: string }>; compact?: boolean; staff?: DemoUser; onBooked?: () => void }) {
  const [step, setStep] = useState(0);
  const [from, setFrom] = useState(preset?.from ?? '410209');
  const [to, setTo] = useState(preset?.to ?? '110001');
  const [pkg, setPkg] = useState({ weight: preset?.weight ?? '1.5', l: '30', w: '25', h: '15', kind: 'PARCEL' as ShipmentKind, type: 'Box', value: '2500', insurance: true });
  const [service, setService] = useState<ServiceType>('EXPRESS');
  const [sender, setSender] = useState<Party>(staff ? emptyParty : { name: 'Demo Sender', phone: '9800000011', address: 'Flat 4, Sector 18, Kamothe', email: '' });
  const [remember, setRemember] = useState(true);
  const [pinNote, setPinNote] = useState<{ role: 'SENDER' | 'RECEIVER'; pin: string } | null>(null);
  const [receiver, setReceiver] = useState<Party>(emptyParty);
  const [pay, setPay] = useState<'ONLINE' | 'UPI' | 'CASH' | 'COUNTER' | 'CREDIT'>('UPI');
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<{ tn: string; quote: InternalQuote; booked: BookingResult } | null>(null);
  const src = useData();
  const fromPin = usePincode(from);
  const toPin = usePincode(to);
  const stepper = useRef<HTMLDivElement>(null);
  useEffect(() => { // keep the current step in view without scrolling the page
    const box = stepper.current; const el = box?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (box && el) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2 });
  }, [step]);
  const [err, setErr] = useState('');

  const quoteInput = useMemo(() => ({
    originPin: from, destPin: to, actualWeightKg: Number(pkg.weight),
    dims: { lengthCm: Number(pkg.l), widthCm: Number(pkg.w), heightCm: Number(pkg.h) },
    service, declaredValue: Number(pkg.value) || 0, insurance: pkg.insurance,
  }), [from, to, pkg, service]);

  const options = useMemo(() => {
    if (!isValidPin(from) || !isValidPin(to) || !(Number(pkg.weight) > 0)) return null;
    return (['EXPRESS', 'STANDARD', 'SURFACE'] as ServiceType[]).map((sv) => ({
      service: sv, alloc: allocate(DEMO_RATE_CARDS, DEMO_PRICING, { ...quoteInput, service: sv }, 'CHEAPEST'),
    }));
  }, [quoteInput, from, to, pkg.weight]);
  const chosen = options?.find((o) => o.service === service)?.alloc.chosen ?? null;
  const pub = chosen ? toCustomerQuote(chosen) : null; // customers only ever see this

  const validate = (): string => {
    if (step === 0 && (!isValidPin(from) || !isValidPin(to))) return 'Enter valid 6-digit PIN codes';
    if (step === 1) {
      if (!(Number(pkg.weight) > 0) || Number(pkg.weight) > 70) return 'Weight must be between 0.01 and 70 kg';
      if ([pkg.l, pkg.w, pkg.h].some((d) => !(Number(d) > 0) || Number(d) > 200)) return 'Dimensions must be 1–200 cm';
    }
    if (step === 3 && !pub) return 'This service is not available on this route — choose another';
    const checkParty = (p: Party) => (!p.name.trim() ? 'Name is required' : !/^[6-9]\d{9}$/.test(p.phone) ? 'Enter a valid 10-digit mobile number' : p.address.trim().length < 8 ? 'Enter a complete address' : p.email.trim() && !EMAIL_RE.test(p.email.trim()) ? 'Enter a valid e-mail address, or leave it empty' : '');
    if (step === 4) return checkParty(sender);
    if (step === 5) return checkParty(receiver);
    return '';
  };
  const next = () => { const e = validate(); setErr(e); if (!e) setStep((s) => s + 1); };

  const doPay = async () => {
    if (!chosen || paying) return;
    setPaying(true); setErr('');
    const r = await src.book({
      quote: chosen, staff,
      body: {
        originPin: from, destPin: to, actualWeightKg: Number(pkg.weight), dims: { lengthCm: Number(pkg.l), widthCm: Number(pkg.w), heightCm: Number(pkg.h) },
        service, declaredValue: Number(pkg.value) || 0, insurance: pkg.insurance, kind: pkg.kind, packageType: pkg.type,
        sender: { ...sender, email: sender.email.trim() || null }, receiver: { ...receiver, email: receiver.email.trim() || null },
        originCity: cityFor(from), destCity: cityFor(to), paymentMode: pay,
      },
    });
    setPaying(false);
    if (!r.ok) return setErr(r.error);
    if (!staff && remember) { // customer's own device only; staff use the branch address book
      rememberContact({ role: 'SENDER', ...sender, pin: from });
      rememberContact({ role: 'RECEIVER', ...receiver, pin: to });
    }
    onBooked?.();
    setResult({ tn: r.value.trackingNumber, quote: chosen, booked: r.value });
    setStep(8);
  };

  const field = (label: string, value: string, set: (v: string) => void, props: Record<string, unknown> = {}) => (
    <label className="block"><span className="label">{label}</span><input className="input" value={value} onChange={(e) => set(e.target.value)} {...props} /></label>
  );
  const partyForm = (p: Party, set: (p: Party) => void, role: 'SENDER' | 'RECEIVER') => (
    <>
      <ContactPicker role={role} staff={staff} onPick={(c) => {
        set({ name: c.name, phone: c.phone, address: c.address, email: c.email });
        const routePin = role === 'SENDER' ? from : to;
        setPinNote(c.pin && c.pin !== routePin ? { role, pin: c.pin } : null);
        setErr('');
      }} />
      {pinNote?.role === role && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This saved address is in PIN <b>{pinNote.pin}</b>, but your {role === 'SENDER' ? 'pickup' : 'delivery'} PIN is <b>{role === 'SENDER' ? from : to}</b>.
          <button className="font-semibold text-brand-700 underline" onClick={() => { (role === 'SENDER' ? setFrom : setTo)(pinNote.pin); setPinNote(null); }}>Use {pinNote.pin} (price updates)</button>
          <button className="text-navy-400 underline" onClick={() => setPinNote(null)}>Keep {role === 'SENDER' ? from : to}</button>
        </div>)}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('Full name', p.name, (v) => set({ ...p, name: v }), { autoComplete: 'name' })}
        {field('Mobile', p.phone, (v) => set({ ...p, phone: v.replace(/\D/g, '').slice(0, 10) }), { inputMode: 'numeric', placeholder: '10-digit mobile', autoComplete: 'tel-national' })}
        <div className="sm:col-span-2">{field('Address', p.address, (v) => set({ ...p, address: v }), { placeholder: 'House / street / landmark', autoComplete: 'street-address' })}</div>
        <div className="sm:col-span-2">
          {field(role === 'SENDER' ? 'E-mail (optional)' : 'Receiver e-mail (optional)', p.email, (v) => set({ ...p, email: v.trim() }), { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'name@example.com' })}
          <p className="mt-1 text-xs text-navy-400">{role === 'SENDER' ? 'We send the bill and the tracking link here.' : 'Saved with the receiver for next time.'}</p>
        </div>
      </div>
    </>
  );

  return (
    <div className={`card ${compact ? '' : 'mx-auto max-w-3xl'} overflow-hidden`}>
      {/* stepper */}
      <div ref={stepper} className="no-scrollbar flex gap-1 overflow-x-auto scroll-smooth border-b border-navy-100 bg-navy-50/60 px-4 py-3">
        {STEPS.map((s, i) => (
          <div key={s} data-step={i} className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${i === step ? 'bg-navy-800 text-white' : i < step ? 'text-emerald-700' : 'text-navy-200'}`}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}{s}
          </div>
        ))}
      </div>

      <div className="animate-rise p-5 sm:p-7" key={step}>
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>{field('Pickup PIN code', from, (v) => setFrom(v.replace(/\D/g, '').slice(0, 6)), { inputMode: 'numeric', maxLength: 6 })}<PinHint state={fromPin} /></div>
            <div>{field('Delivery PIN code', to, (v) => setTo(v.replace(/\D/g, '').slice(0, 6)), { inputMode: 'numeric', maxLength: 6 })}<PinHint state={toPin} /></div>
            <p className="text-sm text-navy-400 sm:col-span-2">{isValidPin(from) && isValidPin(to) ? <>Route: <b className="text-navy-800">{placeOf(fromPin, from)} → {placeOf(toPin, to)}</b></> : 'Enter the 6-digit PIN codes, e.g. 411001 (Pune) → 110001 (Delhi).'}</p>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="sm:col-span-4 flex gap-2">
              {(['PARCEL', 'DOCUMENT'] as ShipmentKind[]).map((k) => (
                <button key={k} onClick={() => setPkg({ ...pkg, kind: k })} className={`btn ${pkg.kind === k ? 'bg-navy-800 text-white' : 'btn-ghost'}`}>{k === 'PARCEL' ? 'Parcel' : 'Document'}</button>
              ))}
            </div>
            {field('Actual weight (kg)', pkg.weight, (v) => setPkg({ ...pkg, weight: v }), { type: 'number', step: '0.1', min: '0' })}
            {field('Length (cm)', pkg.l, (v) => setPkg({ ...pkg, l: v }), { type: 'number' })}
            {field('Width (cm)', pkg.w, (v) => setPkg({ ...pkg, w: v }), { type: 'number' })}
            {field('Height (cm)', pkg.h, (v) => setPkg({ ...pkg, h: v }), { type: 'number' })}
            <label className="sm:col-span-2"><span className="label">Package type</span>
              <select className="input" value={pkg.type} onChange={(e) => setPkg({ ...pkg, type: e.target.value })}>{['Box', 'Envelope', 'Flyer bag', 'Carton', 'Other'].map((o) => <option key={o}>{o}</option>)}</select>
            </label>
            {field('Declared value (₹)', pkg.value, (v) => setPkg({ ...pkg, value: v }), { type: 'number' })}
            <label className="flex items-end gap-2 pb-2.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={pkg.insurance} onChange={(e) => setPkg({ ...pkg, insurance: e.target.checked })} />Add insurance</label>
          </div>
        )}

        {step === 2 && pub && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Actual weight" value={`${pkg.weight} kg`} />
              <Stat label="Volumetric weight" value={`${pub.volumetricWeightKg} kg`} sub={`${pkg.l}×${pkg.w}×${pkg.h} ÷ divisor`} />
              <Stat label="Chargeable weight" value={`${pub.chargeableWeightKg} kg`} highlight />
            </div>
            <p className="text-sm text-navy-400">Chargeable weight = the higher of actual and volumetric weight. Volumetric weight = L × W × H ÷ the courier's configured divisor (typically 4000–5000).</p>
          </div>
        )}
        {step === 2 && !pub && <p className="text-sm text-rose-600">No serviceable option for the selected inputs. Go back and adjust the route or service.</p>}

        {step === 3 && (
          <div className="space-y-3">
            {options?.map(({ service: sv, alloc }) => {
              const q = alloc.chosen ? toCustomerQuote(alloc.chosen) : null;
              return (
                <button key={sv} disabled={!q} onClick={() => setService(sv)} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${service === sv ? 'border-brand-500 ring-2 ring-brand-100' : 'border-navy-100 hover:border-navy-200'} disabled:opacity-40`}>
                  <div>
                    <div className="font-semibold">Veer {sv === 'EXPRESS' ? 'Express' : sv === 'STANDARD' ? 'Standard' : 'Surface Cargo'}</div>
                    <div className="text-xs text-navy-400">{q ? `Estimated ${q.estimatedDays} day${q.estimatedDays > 1 ? 's' : ''}` : 'Not available on this route'}</div>
                  </div>
                  {q && <div className="text-right"><div className="font-display text-xl font-bold">{inr(q.total)}</div><div className="text-xs text-navy-400">incl. GST</div></div>}
                </button>
              );
            })}
            {pub && <Breakdown q={pub} />}
          </div>
        )}

        {step === 4 && <><h3 className="mb-4 font-semibold">Sender details</h3>{partyForm(sender, setSender, 'SENDER')}
          {!staff && <label className="mt-4 flex items-start gap-2 text-sm text-navy-600"><input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember sender and receiver on this device for next time <span className="block text-xs text-navy-400">Saved only in this browser. Untick on a shared computer.</span></span></label>}</>}
        {step === 5 && <><h3 className="mb-4 font-semibold">Receiver details</h3>{partyForm(receiver, setReceiver, 'RECEIVER')}<button className="mt-3 text-xs font-semibold text-brand-600" onClick={() => setReceiver({ name: 'Demo Receiver', phone: '9800000022', address: '12 Connaught Place, New Delhi', email: '' })}>Fill sample receiver</button></>}

        {step === 6 && pub && (
          <div className="grid gap-4 sm:grid-cols-2">
            <ReviewBlock title="Route" lines={[`${cityFor(from)} (${from}) → ${cityFor(to)} (${to})`, `Veer ${service.toLowerCase()} · ~${pub.estimatedDays} days`]} />
            <ReviewBlock title="Package" lines={[`${pkg.kind.toLowerCase()} · ${pkg.type}`, `Chargeable ${pub.chargeableWeightKg} kg · declared ${inr(Number(pkg.value) || 0)}`]} />
            <ReviewBlock title="Sender" lines={[sender.name, sender.phone, sender.address]} />
            <ReviewBlock title="Receiver" lines={[receiver.name, receiver.phone, receiver.address]} />
            <div className="sm:col-span-2"><Breakdown q={pub} /></div>
          </div>
        )}

        {step === 7 && pub && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {([['UPI', 'UPI', QrCode, false], ['ONLINE', 'Card / Netbanking', CreditCard, false], ['CASH', 'Cash', Banknote, true], ['COUNTER', 'Pay at counter', Store, false], ['CREDIT', 'Approved credit account', Landmark, true]] as const).map(([k, l, Icon, staffOnly]) => {
                const locked = staffOnly && !staff;
                return (
                  <button key={k} disabled={locked} onClick={() => setPay(k)} className={`flex items-center gap-3 rounded-xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${pay === k ? 'border-brand-500 ring-2 ring-brand-100' : 'border-navy-100'}`}>
                    <Icon className="h-5 w-5 shrink-0 text-navy-600" /><span><span className="block font-semibold">{l}</span>{locked && <span className="text-xs text-navy-400">Available at the branch counter</span>}{k === 'COUNTER' && <span className="text-xs text-navy-400">Pay when you drop off the parcel</span>}</span>
                  </button>
                );
              })}
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Online payments go through a verified payment gateway; this demo uses a simulated gateway, so no money is charged and no card details are collected. Counter payments are recorded by branch staff with a receipt number.</div>
            <button className="btn-primary w-full py-3 text-base" onClick={doPay} disabled={paying}>
              {paying ? <><Loader2 className="h-4 w-4 animate-spin" />Processing simulated payment…</> : <><Wallet className="h-4 w-4" />{pay === 'COUNTER' ? 'Confirm booking' : pay === 'CASH' ? `Confirm ${inr(pub.total)} cash received (simulated)` : `Pay ${inr(pub.total)} (simulated)`}</>}
            </button>
          </div>
        )}

        {step === 8 && result && <Confirmation autoDownload={!compact} tn={result.tn} q={result.quote} booked={result.booked} pay={pay} from={from} to={to} sender={sender} receiver={receiver} pkg={pkg} staff={!!staff} />}

        {err && <p className="mt-4 text-sm font-medium text-rose-600">{err}</p>}
        {step < 7 && (
          <div className="mt-6 flex justify-between">
            <button className="btn-ghost" disabled={step === 0} onClick={() => { setErr(''); setStep(step - 1); }}>Back</button>
            <button className="btn-navy" onClick={next}>Continue</button>
          </div>
        )}
        {step === 7 && <button className="btn-ghost mt-3" onClick={() => setStep(6)}>Back</button>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'border-brand-500 bg-brand-50' : 'border-navy-100'}`}>
      <div className="label">{label}</div><div className="font-display text-2xl font-bold">{value}</div>{sub && <div className="text-xs text-navy-400">{sub}</div>}
    </div>
  );
}
function ReviewBlock({ title, lines }: { title: string; lines: string[] }) {
  return <div className="rounded-xl border border-navy-100 p-4"><div className="label">{title}</div>{lines.map((l, i) => <div key={i} className="text-sm">{l}</div>)}</div>;
}
export function Breakdown({ q }: { q: { freight: number; insurance: number; gst: number; total: number; chargeableWeightKg: number } }) {
  const rows: [string, number][] = [['Shipping charge', q.freight], ['Insurance', q.insurance], ['GST (18%)', q.gst]];
  return (
    <div className="rounded-xl bg-navy-50 p-4 text-sm">
      {rows.map(([l, v]) => <div key={l} className="flex justify-between py-0.5"><span className="text-navy-400">{l}</span><span>{inr(v)}</span></div>)}
      <div className="mt-2 flex justify-between border-t border-navy-100 pt-2 font-bold"><span>Total payable</span><span>{inr(q.total)}</span></div>
      <div className="mt-1 text-[11px] text-navy-400">Sample rates for demonstration.</div>
    </div>
  );
}

const placeOf = (st: PinState, pin: string) => (st.status === 'done' && st.info.found ? st.info.label ?? cityFor(pin) : cityFor(pin));

/** Area / district / state under a PIN field. A PIN that cannot be verified is a warning, never a block. */
export function PinHint({ state }: { state: PinState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'checking') return <p className="mt-1 flex items-center gap-1 text-xs text-navy-400"><Loader2 className="h-3 w-3 animate-spin" />Checking PIN…</p>;
  if (state.status === 'unavailable') return <p className="mt-1 text-xs text-navy-400">PIN check unavailable right now — you can continue.</p>;
  const i = state.info;
  if (i.found) return (
    <p className="mt-1 flex items-start gap-1 text-xs text-emerald-700" title={i.areas.join(', ')}>
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span><b>{i.label}</b> · {i.state}{i.areas.length > 1 && <span className="text-navy-400"> · {i.areas.length} post offices</span>}{i.deliverable === false && <span className="text-amber-700"> · non-delivery office</span>}</span>
    </p>);
  if (i.unverified) return <p className="mt-1 text-xs text-navy-400">Couldn't verify this PIN right now — you can continue.</p>;
  return <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Not found in India Post records — please double-check the PIN.</p>;
}

type DocState = { kind: 'idle' | 'working' | 'done' | 'error'; text: string };

function Confirmation({ tn, q, booked, pay, from, to, sender, receiver, pkg, staff, autoDownload }: { staff: boolean; autoDownload: boolean; booked: BookingResult; tn: string; q: InternalQuote; pay: string; from: string; to: string; sender: Party; receiver: Party; pkg: { weight: string; l: string; w: string; h: string; kind: ShipmentKind; type: string; value: string; insured?: boolean; insurance: boolean } }) {
  // the server is authoritative for the amount charged and whether payment was received
  const pub = { ...toCustomerQuote(q), total: booked.total };
  const paid = booked.paid;
  const [bookedAt] = useState(() => new Date());
  const docket: ReceiptData = {
    trackingNumber: tn, bookedAt, originPin: from, destPin: to, originCity: cityFor(from), destCity: cityFor(to),
    sender, receiver, kind: pkg.kind, packageType: pkg.type, pieces: 1,
    actualWeightKg: Number(pkg.weight), dims: { l: Number(pkg.l), w: Number(pkg.w), h: Number(pkg.h) },
    declaredValue: Number(pkg.value) || 0, insured: pkg.insurance, quote: pub, paymentMode: pay, paid,
  };
  const trackUrl = `${location.origin}/track?tn=${tn}`;
  const pdf = useRef<Blob | null>(null);
  const [state, setState] = useState<DocState>({ kind: 'idle', text: '' });
  const [busy, setBusy] = useState<'' | 'download' | 'print' | 'share'>('');

  const download = async (auto = false) => {
    setBusy('download'); setState({ kind: 'working', text: 'Preparing your consignment note…' });
    try {
      pdf.current = await downloadDocket(docket, pdf.current ?? undefined);
      setState({ kind: 'done', text: `${auto ? 'Downloaded automatically' : 'Downloaded'}: VeerExpress-${tn}.pdf` });
    } catch { setState({ kind: 'error', text: 'Could not create the PDF. Use Print and choose “Save as PDF” instead.' }); }
    finally { setBusy(''); }
  };
  const print = async () => {
    setBusy('print');
    try { await printDocket(docket); } catch { setState({ kind: 'error', text: 'Printing is not available in this browser.' }); }
    finally { setBusy(''); }
  };
  const share = async () => {
    setBusy('share');
    const r = await shareDocket(docket, trackUrl, pdf.current ?? undefined);
    if (r === 'unsupported') {
      try { await navigator.clipboard.writeText(trackUrl); setState({ kind: 'done', text: 'Sharing is not supported here — tracking link copied instead.' }); }
      catch { setState({ kind: 'error', text: `Share this tracking link: ${trackUrl}` }); }
    } else if (r !== 'cancelled') setState({ kind: 'done', text: r === 'shared-file' ? 'Consignment note shared.' : 'Tracking link shared.' });
    setBusy('');
  };

  const started = useRef(false);
  useEffect(() => { // auto-download once, right after booking (StrictMode-safe)
    if (!autoDownload || started.current) return;
    started.current = true;
    void download(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const payLabel = pay === 'COUNTER' ? 'Pay at counter' : pay === 'CREDIT' ? 'Credit account' : pay === 'CASH' ? 'Cash' : pay === 'UPI' ? 'UPI' : 'Card / netbanking';
  const Action = ({ icon, label, onClick, kind }: { icon: React.ReactNode; label: string; onClick: () => void; kind?: typeof busy }) => (
    <button onClick={onClick} disabled={!!busy}
      className="group flex flex-col items-center gap-1.5 rounded-xl border border-navy-100 bg-white px-3 py-3 text-sm font-semibold text-navy-800 transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-card disabled:opacity-60">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600 group-hover:bg-brand-500 group-hover:text-white">
        {busy && busy === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </span>{label}
    </button>
  );

  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 ring-8 ring-emerald-50"><Check className="h-8 w-8 text-emerald-700" /></div>
      <h3 className="mt-4 text-2xl font-extrabold">Shipment booked</h3>
      <p className="text-sm text-navy-400">{booked.simulated ? 'Demo booking — simulated payment, no money received.' : 'Keep your consignment note with the parcel.'}</p>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-navy-100 text-left shadow-card">
        <div className="bg-navy-800 px-5 py-4 text-white">
          <div className="text-[11px] uppercase tracking-widest text-navy-200">Veer Express tracking number</div>
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-2xl font-extrabold tracking-wider">{tn}</div>
            <button className="rounded-lg p-1.5 text-navy-100 hover:bg-navy-700" aria-label="Copy tracking number" title="Copy"
              onClick={() => navigator.clipboard?.writeText(tn).then(() => setState({ kind: 'done', text: 'Tracking number copied.' }), () => {})}><Link2 className="h-4 w-4" /></button>
          </div>
          <div className="mt-1 text-sm text-navy-100">{cityFor(from)} → {cityFor(to)}</div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-navy-100 bg-white">
          <div className="p-4"><div className="label">Shipment</div><b>Booked</b><div className="text-xs text-navy-400">{staff ? 'Awaiting courier allocation' : 'We dispatch it with the best-fit courier'}</div></div>
          <div className={`p-4 ${paid ? 'bg-emerald-50/60' : 'bg-rose-50/60'}`}><div className="label">Payment</div>
            <b className={paid ? 'text-emerald-700' : 'text-rose-700'}>{paid ? (booked.simulated ? 'Paid (simulated)' : 'Paid') : 'Due'}</b>
            <div className="text-xs text-navy-400">{inr(pub.total)} · {payLabel}</div>
            {booked.receiptNo && <div className="text-xs text-navy-400">Receipt <span className="font-mono">{booked.receiptNo}</span></div>}
          </div>
        </div>
      </div>

      {booked.emailStatus !== 'NONE' && booked.emailTo && (
        <p className={`mt-4 rounded-xl px-3 py-2 text-sm ${booked.emailStatus === 'SENT' ? 'bg-emerald-50 text-emerald-800' : booked.emailStatus === 'FAILED' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
          {booked.emailStatus === 'SENT' ? <>Bill and tracking link e-mailed to <b>{booked.emailTo}</b>.</>
            : booked.emailStatus === 'FAILED' ? <>We could not e-mail <b>{booked.emailTo}</b>. Please download the PDF below.</>
            : <>Bill and tracking e-mail for <b>{booked.emailTo}</b> is prepared, but e-mail sending is not connected yet, so nothing was sent. Download the PDF below.</>}
        </p>)}
      {state.kind !== 'idle' && (
        <div role="status" className={`mt-4 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm ${state.kind === 'error' ? 'bg-rose-50 text-rose-800' : state.kind === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-navy-50 text-navy-700'}`}>
          {state.kind === 'working' ? <Loader2 className="h-4 w-4 animate-spin" /> : state.kind === 'done' ? <CheckCircle2 className="h-4 w-4" /> : null}{state.text}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Action kind="download" icon={<Download className="h-4 w-4" />} label="Download PDF" onClick={() => download()} />
        <Action kind="print" icon={<Printer className="h-4 w-4" />} label="Print" onClick={print} />
        <Action kind="share" icon={<Share2 className="h-4 w-4" />} label="Share" onClick={share} />
        <a href={whatsappShareUrl(docket, trackUrl)} target="_blank" rel="noopener noreferrer"
          className="group flex flex-col items-center gap-1.5 rounded-xl border border-navy-100 bg-white px-3 py-3 text-sm font-semibold text-navy-800 transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-card">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white"><MessageCircle className="h-4 w-4" /></span>WhatsApp
        </a>
      </div>

      <Link className="btn-primary mt-4 w-full justify-center" to={`/track?tn=${tn}`}>Track this shipment</Link>
      {booked.simulated && <p className="mt-4 text-xs text-navy-400">A simulated WhatsApp + SMS confirmation was logged in Admin → Notifications.</p>}
    </div>
  );
}
