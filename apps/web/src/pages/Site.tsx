import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Boxes, Calculator, Clock, FileText, Headphones, MapPinned, Menu, MessageCircle,
  Package, Phone, Plane, Shield, Truck, X, Zap,
} from 'lucide-react';
import { DEMO_PRICING, DEMO_RATE_CARDS, allocate, isValidPin, toCustomerQuote, type ServiceType } from '@veer/core';
import { DemoBanner, Logo, SectionHead, inr } from '../components/ui';
import BookingWizard, { Breakdown, PinHint, cityFor } from '../components/BookingWizard';
import { usePincode } from '../lib/pincode';
import TrackingView from '../components/TrackingView';

import { BUSINESS } from '../config/business';

export function SiteLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const links: [string, string][] = [['/services', 'Services'], ['/calculate', 'Rates'], ['/book', 'Book'], ['/track', 'Track'], ['/about', 'About'], ['/contact', 'Contact']];
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="sticky top-0 z-40 border-b border-navy-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo to="/home" />
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            {links.map(([to, l]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'text-brand-600' : 'text-navy-600 hover:text-navy-900')}>{l}</NavLink>)}
            <Link to="/login" className="btn-ghost py-1.5">Staff login</Link>
          </nav>
          <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X /> : <Menu />}</button>
        </div>
        {open && <nav className="grid gap-1 border-t border-navy-100 p-3 md:hidden">{[...links, ['/login', 'Staff login'] as [string, string]].map(([to, l]) => <Link key={to} to={to} onClick={() => setOpen(false)} className="rounded px-3 py-2 hover:bg-navy-50">{l}</Link>)}</nav>}
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
      <a href={BUSINESS.whatsappUrl} target="_blank" rel="noopener noreferrer" className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700" title={`WhatsApp ${BUSINESS.phoneDisplay}`}>
        <MessageCircle className="h-5 w-5" /><span className="hidden sm:inline">WhatsApp us</span>
      </a>
    </div>
  );
}

function Footer() {
  const col = (t: string, items: [string, string][]) => (
    <div><div className="mb-3 text-sm font-semibold text-white">{t}</div><ul className="space-y-2 text-sm">{items.map(([to, l]) => <li key={to}><Link to={to} className="hover:text-white">{l}</Link></li>)}</ul></div>
  );
  return (
    <footer className="bg-navy-900 text-navy-200" id="contact-whatsapp">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2"><Logo light to="/home" /><p className="mt-4 max-w-xs text-sm">One Brand. Every Delivery. One Tracking Experience.</p><p className="mt-4 text-sm">Phone / WhatsApp: <a className="hover:text-white" href={`tel:${BUSINESS.phoneE164}`}>{BUSINESS.phoneDisplay}</a><br />Email: <a className="hover:text-white" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></p><address className="mt-3 text-sm not-italic">{BUSINESS.addressLines.map((l) => <span key={l} className="block">{l}</span>)}</address><p className="mt-3 text-xs text-navy-400">{BUSINESS.association}</p></div>
        {col('Services', [['/services/domestic', 'Domestic Courier'], ['/services/express', 'Express Delivery'], ['/services/surface', 'Surface Cargo'], ['/services/bulk', 'Bulk Shipping']])}
        {col('Customers', [['/calculate', 'Calculate Charges'], ['/book', 'Book a Shipment'], ['/track', 'Track Shipment'], ['/faq', 'FAQ']])}
        {col('Company', [['/about', 'About Us'], ['/contact', 'Contact Us'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms & Conditions']])}
      </div>
      <div className="border-t border-navy-800 py-4 text-center text-xs">© {new Date().getFullYear()} Veer Express Courier {import.meta.env.VITE_APP_MODE === 'live' ? '' : '· Demo website — content and figures are illustrative.'}</div>
    </footer>
  );
}

const Wrap = ({ children, className = '' }: { children: ReactNode; className?: string }) => <section className={`mx-auto max-w-6xl px-4 py-16 ${className}`}>{children}</section>;
const PageHero = ({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) => (
  <div className="border-b border-navy-100 bg-navy-50/60"><div className="mx-auto max-w-6xl px-4 py-14"><div className="eyebrow">{eyebrow}</div><h1 className="mt-2 text-4xl font-extrabold">{title}</h1><p className="mt-3 max-w-2xl text-navy-400">{sub}</p></div></div>
);

// ---------------------------------------------------------------- home

export function QuickQuote() {
  const [from, setFrom] = useState('410209');
  const [to, setTo] = useState('400053');
  const [w, setW] = useState('1');
  const nav = useNavigate();
  const ok = isValidPin(from) && isValidPin(to) && Number(w) > 0;
  const q = ok ? allocate(DEMO_RATE_CARDS, DEMO_PRICING, { originPin: from, destPin: to, actualWeightKg: Number(w), dims: { lengthCm: 10, widthCm: 10, heightCm: 10 }, service: 'STANDARD', declaredValue: 0, insurance: false }, 'CHEAPEST').chosen : null;
  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="label">From PIN</span><input className="input" value={from} inputMode="numeric" onChange={(e) => setFrom(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label><span className="label">To PIN</span><input className="input" value={to} inputMode="numeric" onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label><span className="label">Weight (kg)</span><input className="input" type="number" min="0.1" step="0.1" value={w} onChange={(e) => setW(e.target.value)} /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">{q ? <>Standard from <b className="font-display text-xl">{inr(toCustomerQuote(q).total)}</b> <span className="text-navy-400">· {cityFor(from)} → {cityFor(to)} · ~{q.estimatedDays}d · sample rate</span></> : <span className="text-navy-400">Enter valid PIN codes</span>}</div>
        <button className="btn-primary" disabled={!ok} onClick={() => nav(`/book?from=${from}&to=${to}&w=${w}`)}>Book shipment <ArrowRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

const SERVICES = [
  { slug: 'domestic', icon: Package, title: 'Domestic Courier', text: 'Documents and parcels to 19,000+ PIN codes through our partner network.', pts: ['Doorstep pickup', 'Documents & parcels', 'One tracking number'] },
  { slug: 'express', icon: Zap, title: 'Express Delivery', text: 'Priority air and express-road movement for time-critical shipments.', pts: ['Next-day metro delivery*', 'Priority handling', 'Proof of delivery'] },
  { slug: 'surface', icon: Truck, title: 'Surface Cargo', text: 'Economical road transport for heavier consignments, from 3 kg upwards.', pts: ['Cost-effective for heavy loads', 'Pan-India road network', 'Volumetric-optimised pricing'] },
  { slug: 'bulk', icon: Boxes, title: 'Bulk Shipping', text: 'Contract pricing, credit accounts and dashboards for businesses and e-commerce sellers.', pts: ['Credit accounts', 'Bulk upload', 'Monthly GST invoices'] },
];

export function Home() {
  return (
    <SiteLayout>
      <section className="relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-navy-50 lg:block" style={{ clipPath: 'polygon(18% 0,100% 0,100% 100%,0 100%)' }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2 lg:py-24">
          <div className="animate-rise">
            <div className="eyebrow">Nationwide courier & cargo</div>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">One Brand. Every Delivery. <span className="text-brand-500">One Tracking Experience.</span></h1>
            <p className="mt-4 max-w-lg text-lg text-navy-400">Book, pay and track every shipment with Veer Express — we route it through the best delivery network for your PIN code, weight and deadline.</p>
            <div className="mt-6 flex flex-wrap gap-3"><Link to="/book" className="btn-primary px-6 py-3">Book a shipment</Link><Link to="/track" className="btn-ghost px-6 py-3">Track shipment</Link></div>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-navy-400">{[['19,000+', 'PIN codes*'], ['3', 'service levels'], ['1', 'tracking number']].map(([a, b]) => <div key={b}><b className="block font-display text-2xl text-navy-900">{a}</b>{b}</div>)}</div>
          </div>
          <div className="animate-rise [animation-delay:.15s]"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Calculator className="h-4 w-4 text-brand-500" />Instant price check</div><QuickQuote /><p className="mt-2 text-xs text-navy-400">*Coverage figures are illustrative for this demo.</p></div>
        </div>
      </section>

      <Wrap><SectionHead eyebrow="Services" title="Every kind of delivery, one counter" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{SERVICES.map((s) => <Link to={`/services/${s.slug}`} key={s.slug} className="card group p-5 transition hover:-translate-y-0.5 hover:border-brand-400"><s.icon className="h-8 w-8 text-brand-500" /><h3 className="mt-4 font-bold">{s.title}</h3><p className="mt-1 text-sm text-navy-400">{s.text}</p><span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-navy-700 group-hover:text-brand-600">Learn more <ArrowRight className="h-3.5 w-3.5" /></span></Link>)}</div>
      </Wrap>

      <div className="bg-navy-900 text-white"><Wrap>
        <div className="mx-auto mb-10 max-w-2xl text-center"><div className="eyebrow">Why Veer Express</div><h2 className="mt-2 text-3xl font-extrabold">The reach of many networks. The accountability of one.</h2></div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">{[[BadgeCheck, 'Best-fit routing', 'Each shipment is matched to the network that serves your route best.'], [MapPinned, 'One tracking number', 'Track every shipment the same way, whoever moves it.'], [Shield, 'Transparent pricing', 'Clear charges, GST invoices and optional insurance.'], [Headphones, 'One point of contact', 'Your local Veer Express branch handles everything.']].map(([I, t, d]) => { const Icon = I as typeof Shield; return <div key={t as string}><Icon className="h-7 w-7 text-brand-400" /><h3 className="mt-3 font-bold">{t as string}</h3><p className="mt-1 text-sm text-navy-200">{d as string}</p></div>; })}</div>
      </Wrap></div>

      <Wrap><SectionHead eyebrow="How it works" title="Four steps, door to door" />
        <div className="grid gap-4 md:grid-cols-4">{[['Get a price', 'Enter PIN codes and weight.'], ['Book & pay', 'Online, UPI or at the counter.'], ['We pick up', 'Packed, labelled and dispatched.'], ['Track & receive', 'Clear status updates until delivery.']].map(([t, d], i) => <div key={t} className="card p-5"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 font-bold text-white">{i + 1}</div><h3 className="mt-3 font-bold">{t}</h3><p className="text-sm text-navy-400">{d}</p></div>)}</div>
      </Wrap>

      <Wrap className="pt-0"><div className="card grid items-center gap-8 p-8 lg:grid-cols-2">
        <div><div className="eyebrow">Coverage</div><h2 className="mt-2 text-3xl font-extrabold">Nationwide delivery coverage</h2><p className="mt-3 text-navy-400">Metro, tier-2, tier-3 and remote locations including the North-East and island territories — subject to serviceability for your PIN code.</p><Link to="/calculate" className="btn-navy mt-5">Check your PIN code</Link></div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">{['Delhi NCR', 'Mumbai', 'Pune', 'Bengaluru', 'Chennai', 'Hyderabad', 'Kolkata', 'Ahmedabad', 'Guwahati'].map((c) => <div key={c} className="rounded-lg bg-navy-50 py-3 font-medium">{c}</div>)}</div>
      </div></Wrap>

      <div className="bg-navy-50/60"><Wrap><SectionHead eyebrow="Testimonials" title="What customers say" sub="Sample testimonials for demonstration — not real customer reviews." />
        <div className="grid gap-4 md:grid-cols-3">{[['Fast pickup and I could track my parcel to Delhi without calling anyone.', 'Demo customer, Pune'], ['Our boutique ships 40 parcels a week. One invoice, one dashboard.', 'Demo business customer, Mumbai'], ['The counter staff explained the volumetric weight clearly. No surprises.', 'Demo customer, Nashik']].map(([q, a]) => <figure key={a} className="card p-6"><span className="demo-tag">Demo content</span><blockquote className="mt-3 text-navy-700">“{q}”</blockquote><figcaption className="mt-3 text-sm font-semibold">{a}</figcaption></figure>)}</div>
      </Wrap></div>

      <Wrap><div className="flex flex-col items-center justify-between gap-6 rounded-2xl bg-brand-500 p-8 text-white md:flex-row"><div><h2 className="text-2xl font-extrabold">Need a pickup today?</h2><p className="text-brand-50">Call or WhatsApp your nearest Veer Express branch.</p></div><div className="flex flex-wrap gap-3"><Link to="/contact" className="btn bg-white text-brand-700 hover:bg-brand-50"><Phone className="h-4 w-4" />Contact us</Link><a href={BUSINESS.whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn bg-emerald-600 text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" />WhatsApp</a></div></div></Wrap>
    </SiteLayout>
  );
}

// ---------------------------------------------------------------- inner pages

export function Services() {
  return <SiteLayout><PageHero eyebrow="Our services" title="Courier & cargo for every need" sub="From a single document to a truckload of cartons." /><Wrap><div className="grid gap-4 md:grid-cols-2">{SERVICES.map((s) => <Link key={s.slug} to={`/services/${s.slug}`} className="card flex gap-4 p-6 hover:border-brand-400"><s.icon className="h-10 w-10 shrink-0 text-brand-500" /><div><h3 className="text-lg font-bold">{s.title}</h3><p className="text-sm text-navy-400">{s.text}</p></div></Link>)}</div></Wrap></SiteLayout>;
}

export function ServiceDetail({ slug }: { slug: string }) {
  const s = SERVICES.find((x) => x.slug === slug)!;
  const icons = [Clock, Plane, FileText];
  return (
    <SiteLayout><PageHero eyebrow="Service" title={s.title} sub={s.text} />
      <Wrap><div className="grid gap-8 lg:grid-cols-3"><div className="space-y-3 lg:col-span-2">{s.pts.map((p, i) => { const I = icons[i % 3]; return <div key={p} className="card flex items-center gap-4 p-5"><I className="h-6 w-6 text-brand-500" /><span className="font-semibold">{p}</span></div>; })}<p className="text-xs text-navy-400">*Transit times depend on route and serviceability. Figures shown in this demo are illustrative.</p></div>
        <div className="card p-6"><h3 className="font-bold">Ready to ship?</h3><p className="mt-1 text-sm text-navy-400">Get an instant price and book online.</p><Link to="/book" className="btn-primary mt-4 w-full">Book now</Link><Link to="/calculate" className="btn-ghost mt-2 w-full">Calculate charges</Link></div></div></Wrap>
    </SiteLayout>
  );
}

export function About() {
  return <SiteLayout><PageHero eyebrow="About us" title="One courier brand you can rely on" sub="Veer Express Courier brings multiple trusted delivery networks under one counter, one price list and one tracking number." />
    <Wrap><div className="grid gap-6 md:grid-cols-3">{[['Our mission', 'Make every delivery simple to book and easy to follow — for walk-in customers and growing businesses alike.'], ['Our network', 'We work with multiple established logistics partners and route each shipment to the best-fit network.'], ['Our counter', 'Walk in at Shop No. 11, Sector 20, Kamothe, Navi Mumbai — or book online and drop off at the counter.']].map(([t, d]) => <div key={t} className="card p-6"><h3 className="font-bold">{t}</h3><p className="mt-2 text-sm text-navy-400">{d}</p></div>)}</div></Wrap></SiteLayout>;
}

type CalcForm = { from: string; to: string; w: string; l: string; b: string; h: string; service: ServiceType };

/** Field-by-field checks for the rate calculator. Dimensions are optional, but all three or none. */
export function calcErrors(f: CalcForm): Partial<Record<keyof CalcForm, string>> {
  const e: Partial<Record<keyof CalcForm, string>> = {};
  const pin = (v: string) => (!v ? 'Enter the PIN code' : !/^\d{6}$/.test(v) ? 'PIN code must be 6 digits' : !isValidPin(v) ? 'PIN code cannot start with 0' : undefined);
  e.from = pin(f.from); e.to = pin(f.to);
  const w = Number(f.w);
  e.w = !f.w.trim() ? 'Enter the weight' : !Number.isFinite(w) || w <= 0 ? 'Weight must be more than 0 kg' : w > 70 ? 'Maximum 70 kg per parcel' : undefined;
  const dims = (['l', 'b', 'h'] as const);
  if (dims.some((k) => f[k].trim())) {
    for (const k of dims) {
      const v = Number(f[k]);
      e[k] = !f[k].trim() ? 'Enter all three dimensions, or leave all empty' : !Number.isFinite(v) || v <= 0 ? 'Must be more than 0 cm' : v > 200 ? 'Maximum 200 cm' : undefined;
    }
  }
  for (const k of Object.keys(e) as (keyof CalcForm)[]) if (!e[k]) delete e[k];
  return e;
}

export function CalculatePage() {
  const [form, setForm] = useState<CalcForm>({ from: '410209', to: '110001', w: '2', l: '30', b: '20', h: '15', service: 'EXPRESS' });
  const [touched, setTouched] = useState<Partial<Record<keyof CalcForm, boolean>>>({});
  const errors = calcErrors(form);
  const ok = Object.keys(errors).length === 0;
  const hasDims = form.l.trim() !== '';
  const dims = hasDims ? { lengthCm: +form.l, widthCm: +form.b, heightCm: +form.h } : { lengthCm: 1, widthCm: 1, heightCm: 1 };
  const r = ok ? allocate(DEMO_RATE_CARDS, DEMO_PRICING, { originPin: form.from, destPin: form.to, actualWeightKg: Number(form.w), dims, service: form.service, declaredValue: 0, insurance: false }, 'CHEAPEST').chosen : null;
  const q = r ? toCustomerQuote(r) : null;
  const fromPin = usePincode(errors.from ? '' : form.from);
  const toPin = usePincode(errors.to ? '' : form.to);
  const LABEL: Record<string, string> = { from: 'From PIN', to: 'To PIN', w: 'Weight', l: 'Length', b: 'Width', h: 'Height' };
  const clean = (k: keyof CalcForm, v: string) => (k === 'from' || k === 'to' ? v.replace(/\D/g, '').slice(0, 6) : v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 6));
  const f = (k: keyof CalcForm, l: string, extra?: ReactNode) => {
    const show = !!errors[k] && !!touched[k]; // shown once the field has been changed or left
    return (
      <label className="block"><span className="label">{l}</span>
        <input className={`input ${show ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : ''}`} inputMode={k === 'from' || k === 'to' ? 'numeric' : 'decimal'}
          aria-invalid={show} value={form[k]} onBlur={() => setTouched({ ...touched, [k]: true })} onChange={(e) => { setForm({ ...form, [k]: clean(k, e.target.value) }); setTouched({ ...touched, [k]: true }); }} />
        {show ? <span className="mt-1 block text-xs font-medium text-rose-600">{errors[k]}</span> : extra}
      </label>);
  };
  const missing = Object.keys(errors).map((k) => LABEL[k]).filter((v, i, a) => a.indexOf(v) === i);
  return <SiteLayout><PageHero eyebrow="Rates" title="Calculate shipping charges" sub="Instant estimate based on PIN codes, weight and dimensions. Sample rates for this demo." />
    <Wrap><div className="grid gap-6 lg:grid-cols-2"><div className="card grid h-fit gap-3 p-6 sm:grid-cols-2">
      {f('from', 'From PIN', <PinHint state={fromPin} />)}{f('to', 'To PIN', <PinHint state={toPin} />)}{f('w', 'Weight (kg)')}
      <label className="block"><span className="label">Service</span><select className="input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ServiceType })}><option value="EXPRESS">Express</option><option value="STANDARD">Standard</option><option value="SURFACE">Surface cargo</option></select></label>
      {f('l', 'Length (cm)')}{f('b', 'Width (cm)')}{f('h', 'Height (cm)')}
      <p className="text-xs text-navy-400 sm:col-span-2 sm:self-end">Dimensions are optional. Bulky parcels are charged on volumetric weight (L × W × H ÷ 5000).</p>
    </div>
      <div>{q ? <div className="card p-6"><div className="text-sm text-navy-400">{cityFor(form.from)} → {cityFor(form.to)} · {q.zone.replace(/_/g, ' ').toLowerCase()} · ~{q.estimatedDays} days</div><div className="my-3 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-navy-50 p-3">Volumetric<br /><b>{hasDims ? `${q.volumetricWeightKg} kg` : 'Not given'}</b></div><div className="rounded-lg bg-brand-50 p-3">Chargeable<br /><b>{q.chargeableWeightKg} kg</b></div></div><Breakdown q={q} /><Link to={`/book?from=${form.from}&to=${form.to}&w=${form.w}`} className="btn-primary mt-4 w-full">Book this shipment</Link></div>
        : <div className="card p-6 text-sm">{ok
          ? <p className="text-navy-600">This service is not available on this route. Try another service.</p>
          : <><p className="font-semibold text-navy-800">To see the price, please fix:</p><ul className="mt-2 space-y-1 text-rose-700">{missing.map((m) => <li key={m}>• {m}: {Object.entries(errors).find(([k]) => LABEL[k] === m)?.[1]}</li>)}</ul></>}</div>}</div></div></Wrap></SiteLayout>;
}

export function BookPage() {
  const [sp] = useSearchParams();
  return <SiteLayout><PageHero eyebrow="Book a shipment" title="Book in under two minutes" sub={import.meta.env.VITE_APP_MODE === 'live' ? 'Get a price, enter the addresses and book. Our team dispatches it with the best-fit courier.' : 'Demo booking flow — payment is simulated and no real shipment is created.'} /><Wrap><BookingWizard preset={{ from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, weight: sp.get('w') ?? undefined }} /></Wrap></SiteLayout>;
}

export function TrackPage() {
  const [sp] = useSearchParams();
  return <SiteLayout><PageHero eyebrow="Track shipment" title="Where is my shipment?" sub="Enter your Veer Express tracking number." /><Wrap className="max-w-3xl"><TrackingView initial={sp.get('tn') ?? undefined} /></Wrap></SiteLayout>;
}

export function ContactPage() {
  const [sent, setSent] = useState(false);
  return <SiteLayout><PageHero eyebrow="Contact" title="Talk to Veer Express" sub="Pickups, business accounts and general enquiries." />
    <Wrap><div className="grid gap-6 lg:grid-cols-2"><div className="space-y-3">{([
        [Phone, 'Phone / WhatsApp', <><a className="hover:text-brand-600" href={`tel:${BUSINESS.phoneE164}`}>{BUSINESS.phoneDisplay}</a> · <a className="font-semibold text-emerald-700 hover:underline" href={BUSINESS.whatsappUrl} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a></>],
        [MessageCircle, 'Email', <a className="hover:text-brand-600" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>],
        [MapPinned, 'Branch address', BUSINESS.addressLines.map((l) => <span key={l} className="block">{l}</span>)],
        [Truck, 'Courier services', BUSINESS.association],
      ] as [typeof Phone, string, ReactNode][]).map(([Icon, t, d]) => <div key={t} className="card flex items-start gap-4 p-5"><Icon className="mt-0.5 h-6 w-6 shrink-0 text-brand-500" /><div><div className="text-sm font-semibold">{t}</div><div className="text-sm text-navy-400">{d}</div></div></div>)}</div>
      <form className="card space-y-3 p-6" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>{sent ? <p className="py-10 text-center text-sm">Thanks — this is a demo form, so the message was <b>not</b> sent anywhere.</p> : <><input className="input" placeholder="Your name" required /><input className="input" placeholder="Mobile number" required pattern="[6-9][0-9]{9}" /><select className="input"><option>Pickup request</option><option>Business account</option><option>Complaint</option></select><textarea className="input min-h-28" placeholder="Message" /><button className="btn-primary w-full">Send enquiry</button></>}</form></div></Wrap></SiteLayout>;
}

const FAQS = [
  ['What is chargeable weight?', 'The higher of the actual weight and the volumetric weight (L × W × H ÷ divisor). Light but bulky parcels are charged on volume.'],
  ['Which courier will deliver my parcel?', 'Veer Express routes each shipment through the best-fit network in its partner base. You track everything with your Veer Express tracking number.'],
  ['How often is tracking updated?', 'Our operations team checks each shipment with the courier and records updates several times a day. Every update shows when it happened, and the page shows when we last updated it. This is not real-time GPS tracking.'],
  ['Can I pay at the counter?', 'Yes. Pay online (card, netbanking or UPI) through a secure payment gateway, or pay at the branch counter by cash, UPI or card — you get a receipt with a receipt number. Approved business customers can use a credit account.'],
  ['Is insurance available?', 'Yes, optional insurance is charged as a percentage of declared value with a minimum fee.'],
  ['What items are prohibited?', 'Hazardous goods, liquids in bulk, currency, jewellery above declared limits and items restricted by law. Ask your branch for the full list.'],
  ['What if delivery fails?', 'Our team re-attempts delivery and contacts the receiver. You can see delivery exceptions on the tracking page.'],
];
export function FaqPage() {
  return <SiteLayout><PageHero eyebrow="Help" title="Frequently asked questions" sub="Quick answers about booking, pricing and tracking." /><Wrap className="max-w-3xl space-y-3">{FAQS.map(([q, a]) => <details key={q} className="card group p-5"><summary className="cursor-pointer list-none font-semibold">{q}</summary><p className="mt-2 text-sm text-navy-400">{a}</p></details>)}</Wrap></SiteLayout>;
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = ['We collect sender and receiver names, phone numbers and addresses only to book, deliver and support shipments.', 'Shipment data is shared with the logistics partner that handles your delivery, strictly for that purpose.', 'Payments are processed by a PCI-DSS compliant payment gateway. We never store card details.', 'You can request access to or correction of your data by contacting support.'];
  const terms = ['Charges are based on chargeable weight, route, service and applicable surcharges and taxes.', 'Senders must declare contents and value accurately. Prohibited items will not be accepted.', 'Transit times are estimates and are not guaranteed.', 'Liability is limited to the declared value where insurance has been purchased, subject to claim conditions.'];
  return <SiteLayout><PageHero eyebrow="Legal" title={kind === 'privacy' ? 'Privacy Policy' : 'Terms and Conditions'} sub="Draft template for the demo — to be reviewed by a legal professional before going live." /><Wrap className="max-w-3xl"><ol className="list-decimal space-y-3 pl-5 text-navy-700">{(kind === 'privacy' ? privacy : terms).map((t) => <li key={t}>{t}</li>)}</ol></Wrap></SiteLayout>;
}
