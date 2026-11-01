/**
 * Client proposal / presentation website. Every "demo" block renders the real interactive
 * component used by the application (in demo mode), not a screenshot.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Boxes, Building2, Check, ChevronLeft, ChevronRight, Cloud, Cpu, Database, Eye, EyeOff,
  FileSpreadsheet, KeyRound, Layers, Lock, MapPinned, Menu, MessageCircle, Network, Package, Pause, Play, Plug,
  Receipt, RotateCcw, Rocket, Server, ShieldCheck, Smartphone, Store, Truck, Users, Wallet, X,
} from 'lucide-react';
import { DEMO_PRICING, DEMO_RATE_CARDS, SHOWCASE_TRACKING, allocate, toCustomerQuote } from '@veer/core';
import { DemoBanner, Kpi, Logo, inr } from '../components/ui';
import BookingWizard, { Breakdown } from '../components/BookingWizard';
import TrackingView from '../components/TrackingView';
import { AllocationSandbox, DashboardCharts, useDashboardData } from './Admin';
import { DEMO_LOGINS, PRESENTER, demo, scopeShipments, signIn } from '../demo/store';
import { LIVE } from '../data/source';
import { AllocationQueue, CounterCollection, TrackingDesk } from './Operations';
import { BUSINESS } from '../config/business';

const SECTIONS: [string, string][] = [
  ['hero', 'Overview'], ['vision', 'Vision'], ['challenges', 'Challenges'], ['solution', 'Solution'], ['how', 'How it works'],
  ['customer', 'Customer journey'], ['counter', 'Counter journey'], ['admin', 'Admin journey'], ['partners', 'Courier partners'],
  ['demo-booking', 'Booking demo'], ['demo-tracking', 'Tracking demo'], ['demo-ops', 'Operations demo'], ['demo-admin', 'Admin demo'],
  ['architecture', 'Architecture'], ['security', 'Security'], ['roadmap', 'Roadmap'], ['timeline', 'Timeline'], ['future', 'Future'], ['contact', 'Request a demo'],
];

const num = (id: string) => SECTIONS.findIndex(([x]) => x === id) + 1;

function useActiveSection() {
  const [active, setActive] = useState('hero');
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting && setActive(e.target.id));
    }, { rootMargin: '-45% 0px -50% 0px' });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  return active;
}

function Section({ id, n, eyebrow, title, sub, children, dark = false, tint = false }: {
  id: string; n: number; eyebrow: string; title: string; sub?: string; children: ReactNode; dark?: boolean; tint?: boolean;
}) {
  return (
    <section id={id} className={`scroll-mt-20 ${dark ? 'bg-navy-900 text-white' : tint ? 'bg-navy-50/60' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 py-20">
        <div className="mb-10 max-w-3xl">
          <div className={`flex items-center gap-3 text-xs font-bold uppercase tracking-[.2em] ${dark ? 'text-brand-400' : 'text-brand-500'}`}>
            <span className={`rounded-md px-2 py-0.5 font-mono ${dark ? 'bg-navy-800' : 'bg-brand-50'}`}>{String(n).padStart(2, '0')}</span>{eyebrow}
          </div>
          <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">{title}</h2>
          {sub && <p className={`mt-3 text-lg ${dark ? 'text-navy-200' : 'text-navy-400'}`}>{sub}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

const DemoFrame = ({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border border-navy-200 bg-white shadow-card">
    <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 bg-navy-50 px-4 py-2">
      <span className="flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-300" /><i className="h-2.5 w-2.5 rounded-full bg-amber-300" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-300" /></span>
      <span className="flex-1 truncate font-mono text-xs text-navy-400">{label}</span>
      <span className="demo-tag">Live demo · sample data</span>{action}
    </div>
    <div className="bg-navy-50/40 p-3 sm:p-5">{children}</div>
  </div>
);

const IconCard = ({ icon: I, title, text, dark }: { icon: typeof Truck; title: string; text: string; dark?: boolean }) => (
  <div className={`rounded-2xl border p-5 ${dark ? 'border-navy-700 bg-navy-800' : 'border-navy-100 bg-white shadow-card'}`}>
    <I className={`h-7 w-7 ${dark ? 'text-brand-400' : 'text-brand-500'}`} />
    <h3 className="mt-3 font-bold">{title}</h3>
    <p className={`mt-1 text-sm ${dark ? 'text-navy-200' : 'text-navy-400'}`}>{text}</p>
  </div>
);

// ---------------------------------------------------------------- journey player

interface JourneyStep { title: string; actor: string; detail: string; screen: ReactNode }

function JourneyPlayer({ steps, accent = 'brand' }: { steps: JourneyStep[]; accent?: 'brand' | 'navy' }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => (i < steps.length - 1 ? setI(i + 1) : setPlaying(false)), 2600);
    return () => clearTimeout(t);
  }, [playing, i, steps.length]);
  const s = steps[i];
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <ol className="space-y-1.5 lg:col-span-2">
        {steps.map((st, k) => (
          <li key={st.title}>
            <button onClick={() => { setI(k); setPlaying(false); }} className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition ${k === i ? 'bg-white shadow-card ring-1 ring-navy-100' : 'hover:bg-white/70'}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${k < i ? 'bg-emerald-500 text-white' : k === i ? (accent === 'brand' ? 'bg-brand-500 text-white' : 'bg-navy-800 text-white') : 'bg-navy-100 text-navy-400'}`}>{k < i ? <Check className="h-3.5 w-3.5" /> : k + 1}</span>
              <span><span className="block text-sm font-semibold">{st.title}</span><span className="text-xs text-navy-400">{st.actor}</span></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="lg:col-span-3">
        <div key={i} className="card animate-rise p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-500">Step {i + 1} of {steps.length} · {s.actor}</div>
          <h3 className="mt-1 text-xl font-bold">{s.title}</h3>
          <p className="mt-2 text-sm text-navy-400">{s.detail}</p>
          <div className="mt-5 rounded-xl border border-dashed border-navy-200 bg-navy-50/50 p-4">{s.screen}</div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-ghost py-1.5" disabled={i === 0} onClick={() => { setI(i - 1); setPlaying(false); }}><ChevronLeft className="h-4 w-4" />Prev</button>
          <button className="btn-navy py-1.5" onClick={() => { if (i === steps.length - 1) setI(0); setPlaying(!playing); }}>{playing ? <><Pause className="h-4 w-4" />Pause</> : <><Play className="h-4 w-4" />Play journey</>}</button>
          <button className="btn-ghost py-1.5" disabled={i === steps.length - 1} onClick={() => { setI(i + 1); setPlaying(false); }}>Next<ChevronRight className="h-4 w-4" /></button>
          <div className="ml-auto h-1.5 w-28 overflow-hidden rounded-full bg-navy-100"><div className="h-full bg-brand-500 transition-all" style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
        </div>
      </div>
    </div>
  );
}

const Mini = ({ rows }: { rows: [string, string][] }) => (
  <dl className="grid grid-cols-2 gap-2 text-sm">{rows.map(([k, v]) => <div key={k} className="rounded-lg bg-white p-2.5"><dt className="text-[11px] uppercase tracking-wide text-navy-400">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
);

// sample quote used by the narrated journeys (SAMPLE FIGURES)
function useSampleQuote() {
  return useMemo(() => allocate(DEMO_RATE_CARDS, DEMO_PRICING, { originPin: '410209', destPin: '110001', actualWeightKg: 1.5, dims: { lengthCm: 30, widthCm: 25, heightCm: 15 }, service: 'EXPRESS', declaredValue: 2500, insurance: true }, 'CHEAPEST'), []);
}

// ---------------------------------------------------------------- page

export default function Presentation() {
  const active = useActiveSection();
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const alloc = useSampleQuote();
  const q = alloc.chosen!;
  const pub = toCustomerQuote(q);
  const [internalView, setInternalView] = useState(false);
  const all = useMemo(() => demo.shipments(), []);
  const adminData = useDashboardData(all);
  const openAs = (email: string, to: string) => { if (LIVE) return nav('/login'); signIn(DEMO_LOGINS.find((u) => u.email === email)!); nav(to); };
  const [resetDone, setResetDone] = useState(false);

  const customerSteps: JourneyStep[] = [
    { title: 'Enter PIN codes', actor: 'Customer · website or counter', detail: 'Pickup 410209 (Kamothe, Navi Mumbai) and delivery 110001 (New Delhi). The route is priced from Veer rate cards (PIN zones, weight slabs).', screen: <Mini rows={[['From', '410209 · Kamothe'], ['To', '110001 · New Delhi'], ['Zone', pub.zone.replace(/_/g, ' ')], ['Courier options', `${alloc.candidates.length} (sample)`]]} /> },
    { title: 'Package details', actor: 'Customer', detail: 'Parcel, 1.5 kg actual, 30 × 25 × 15 cm box, declared value ₹2,500 with insurance.', screen: <Mini rows={[['Actual weight', '1.5 kg'], ['Dimensions', '30 × 25 × 15 cm'], ['Type', 'Parcel · Box'], ['Insurance', 'Yes']]} /> },
    { title: 'Chargeable weight', actor: 'Pricing engine', detail: 'Volumetric = L × W × H ÷ divisor. Chargeable = higher of actual and volumetric.', screen: <Mini rows={[['Volumetric', `${pub.volumetricWeightKg} kg`], ['Chargeable', `${pub.chargeableWeightKg} kg`]]} /> },
    { title: 'Price shown — one brand', actor: 'Customer sees', detail: 'The customer sees only the Veer Express price. Courier names, partner costs and margins stay internal.', screen: <Breakdown q={pub} /> },
    { title: 'Sender & receiver', actor: 'Customer', detail: 'Validated mobile numbers and addresses, optional e-mail for the bill. Returning customers pick their saved details.', screen: <Mini rows={[['Sender', 'Demo Sender · Kamothe'], ['Receiver', 'Demo Receiver · Delhi']]} /> },
    { title: 'Pay', actor: 'Customer', detail: 'Online (card/netbanking/UPI) through a verified payment gateway, or pay at the Kamothe counter. Payment status is tracked separately from shipment status. The demo gateway is simulated.', screen: <Mini rows={[['Method', 'UPI (simulated)'], ['Amount', inr(pub.total)]]} /> },
    { title: 'Tracking number issued', actor: 'Platform', detail: 'An independent Veer Express tracking number is issued immediately. Once operations books the courier, it is linked internally to the courier AWB.', screen: <div className="text-center"><div className="label">Veer Express tracking number</div><div className="font-display text-2xl font-extrabold tracking-wider">{SHOWCASE_TRACKING}</div><div className="mt-1 text-xs text-navy-400">Receipt + WhatsApp / SMS confirmation (simulated)</div></div> },
    { title: 'Track with clear updates', actor: 'Customer', detail: 'One standardised timeline with a "Last updated" time. Updates are verified and entered by Veer staff — never presented as real-time.', screen: <ol className="space-y-1 text-sm">{['Booked', 'Pickup completed', 'In transit', 'Arrived at destination hub', 'Out for delivery'].map((t, k) => <li key={t} className="flex items-center gap-2"><Check className={`h-4 w-4 ${k < 5 ? 'text-brand-500' : 'text-navy-200'}`} />{t}</li>)}<li className="flex items-center gap-2 text-navy-400"><Package className="h-4 w-4" />Delivered — pending</li></ol> },
  ];

  const counterSteps: JourneyStep[] = [
    { title: 'Customer walks in', actor: 'Counter staff · Kamothe', detail: 'Search the address book by name or mobile — regular customers are filled in with one tap. New customers are saved automatically.', screen: <Mini rows={[['Search', '“Aarav”'], ['Found', 'Aarav Sharma · 98xxxxx001']]} /> },
    { title: 'Counter booking', actor: 'Counter staff', detail: 'Same booking engine and price list as the website. PIN codes are checked against India Post records.', screen: <Mini rows={[['Route', 'Kamothe → New Delhi'], ['Price', inr(pub.total)]]} /> },
    { title: 'Collect & issue receipt', actor: 'Counter staff', detail: 'Cash, UPI or card at the counter gets a numbered receipt (KMT-R-000001…) with the collector’s name. Part payments are allowed.', screen: <Mini rows={[['Collected', `${inr(pub.total)} · Cash`], ['Receipt', 'KMT-R-000043']]} /> },
    { title: 'Consignment note', actor: 'Platform', detail: 'A two-copy consignment note with a scannable barcode downloads automatically; print it or share it on WhatsApp.', screen: <Mini rows={[['File', 'VeerExpress-VX….pdf'], ['Copies', 'Sender + branch']]} /> },
    { title: 'Books close themselves', actor: 'Accountant', detail: 'Every booking issues a GST invoice and posts balanced ledger entries — cash, revenue, GST and courier cost — with a full audit trail.', screen: <Mini rows={[['Invoice', 'VX/26-27/00001'], ['Trial balance', 'Balanced']]} /> },
  ];

  const adminSteps: JourneyStep[] = [
    { title: 'Allocation queue', actor: 'Operations', detail: 'New bookings wait here. Staff compare courier rates in the aggregator account and book the best option there.', screen: <Mini rows={alloc.candidates.slice(0, 4).map((c) => [c.partnerName, inr(c.partnerCost)] as [string, string])} /> },
    { title: 'Record the booking', actor: 'Operations', detail: 'Staff record the aggregator reference, courier name and AWB. The Veer number stays the same — only the internal link is added.', screen: <Mini rows={[['Aggregator ref', 'AGG-554321'], ['Courier', q.partnerName], ['AWB', 'D1234567890'], ['Partner cost', inr(q.partnerCost)]]} /> },
    { title: 'Tracking desk', actor: 'Operations', detail: 'Shipments not updated in 12 hours rise to the top. Staff check the courier site and record status, event time, location and remarks — each entry signed and audited.', screen: <Mini rows={[['Active', String(all.filter((s) => s.allocation && s.status !== 'DELIVERED').length)], ['Exceptions', String(all.filter((s) => s.status === 'EXCEPTION').length)]]} /> },
    { title: 'Pricing & margin', actor: 'Admin', detail: 'Zones, weight slabs, volumetric divisors, surcharges, GST and Veer markup. Customer price and partner cost are kept separate.', screen: <Mini rows={[['Partner cost', inr(q.partnerCost)], ['Veer markup', inr(DEMO_PRICING.markupFlat)], ['Customer freight', inr(q.freight)], ['Gross margin', inr(q.grossMargin)]]} /> },
    { title: 'Ledger & reports', actor: 'Accountant', detail: 'Every booking, payment and allocation becomes balanced ledger entries — receivables, cash, gateway, GST and aggregator payable.', screen: <Mini rows={[['Revenue', inr(Math.round(adminData.revenue))], ['Courier cost', inr(Math.round(adminData.payable))]]} /> },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-white">
      <DemoBanner forceDemo />
      <header className="sticky top-0 z-50 border-b border-navy-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <Logo to="/" />
          <span className="hidden rounded-full bg-navy-50 px-2.5 py-1 text-[11px] font-semibold text-navy-600 sm:inline">Client proposal</span>
          <nav className="ml-auto hidden items-center gap-1 text-sm xl:flex">
            {[['demo-booking', 'Book demo'], ['demo-tracking', 'Track demo'], ['demo-ops', 'Operations'], ['demo-admin', 'Admin demo'], ['roadmap', 'Roadmap']].map(([id, l]) => (
              <a key={id} href={`#${id}`} className={`rounded-lg px-3 py-1.5 ${active === id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-navy-600 hover:bg-navy-50'}`}>{l}</a>
            ))}
          </nav>
          <Link to="/home" className="btn-ghost ml-auto hidden py-1.5 sm:inline-flex xl:ml-0">Public website</Link>
          <Link to="/login" className="btn-navy py-1.5">Demo login</Link>
          <button className="xl:hidden" onClick={() => setMenu(!menu)} aria-label="Sections">{menu ? <X /> : <Menu />}</button>
        </div>
        {menu && (
          <nav className="grid max-h-[70vh] grid-cols-2 gap-1 overflow-y-auto border-t border-navy-100 p-3 text-sm xl:hidden">
            {SECTIONS.map(([id, l], k) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)} className="rounded px-2 py-1.5 hover:bg-navy-50"><span className="mr-2 font-mono text-xs text-navy-400">{String(k + 1).padStart(2, '0')}</span>{l}</a>)}
          </nav>
        )}
      </header>

      {/* section rail */}
      <nav className="fixed left-3 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-1.5 2xl:flex" aria-label="Section progress">
        {SECTIONS.map(([id, l]) => (
          <a key={id} href={`#${id}`} title={l} className="group flex items-center gap-2">
            <span className={`h-2 rounded-full transition-all ${active === id ? 'w-6 bg-brand-500' : 'w-2 bg-navy-200 group-hover:bg-navy-400'}`} />
            <span className={`text-xs ${active === id ? 'font-semibold text-navy-800' : 'hidden text-navy-400 group-hover:inline'}`}>{l}</span>
          </a>
        ))}
      </nav>

      {/* 1 hero */}
      <section id="hero" className="relative overflow-hidden bg-navy-900 text-white">
        <svg className="absolute inset-0 h-full w-full opacity-[.07]" aria-hidden><defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0v40" fill="none" stroke="#fff" /></pattern></defs><rect width="100%" height="100%" fill="url(#g)" /></svg>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 lg:grid-cols-2">
          <div className="animate-rise">
            <div className="text-xs font-bold uppercase tracking-[.25em] text-brand-400">Digital platform proposal · 2026</div>
            <h1 className="mt-4 text-5xl font-extrabold leading-[1.05] sm:text-6xl">VEER EXPRESS<br /><span className="text-brand-400">COURIER</span></h1>
            <p className="mt-5 text-xl font-semibold text-navy-100">One Brand. Every Delivery. One Tracking Experience.</p>
            <p className="mt-3 max-w-lg text-navy-200">One booking, pricing, tracking and billing system for Veer Express, Kamothe — the counter and the website work as one digital courier company, while multiple courier partners handle the last mile.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#demo-booking" className="btn-primary px-6 py-3">Start the live demo <ArrowRight className="h-4 w-4" /></a>
              <a href="#customer" className="btn border border-navy-600 px-6 py-3 text-white hover:bg-navy-800"><Play className="h-4 w-4" />Play customer journey</a>
            </div>
          </div>
          <div className="animate-rise [animation-delay:.15s]">
            <div className="rounded-2xl border border-navy-700 bg-navy-800/80 p-5">
              <div className="text-xs uppercase tracking-widest text-navy-200">How one shipment flows</div>
              <div className="mt-4 space-y-3">
                {[['Customer books & pays with Veer Express', Smartphone], ['Ops team books best courier via aggregator', Cpu], ['Courier moves the parcel', Truck], ['Customer tracks one Veer number', MapPinned]].map(([t, I], k) => { const Icon = I as typeof Truck; return (
                  <div key={t as string} className="flex items-center gap-3 rounded-xl bg-navy-900/70 p-3" style={{ animation: `rise .5s ${0.25 + k * 0.12}s ease-out both` }}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500"><Icon className="h-5 w-5" /></span><span className="text-sm font-medium">{t as string}</span>
                  </div>); })}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[[String(DEMO_RATE_CARDS.length - 1), 'couriers'], ['1', 'branch · Kamothe'], ['1', 'brand']].map(([a, b]) => <div key={b} className="rounded-lg bg-navy-900/70 py-2"><div className="font-display text-2xl font-bold text-brand-400">{a}</div><div className="text-xs text-navy-200">{b} (demo)</div></div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Section id="vision" n={num('vision')} eyebrow="Business vision" title="Run as one courier company — not a counter that resells many" sub="Customers should never need to know, or care, which network moved their parcel. They should trust Veer Express.">
        <div className="grid gap-4 md:grid-cols-3">
          <IconCard icon={Layers} title="One brand experience" text="Same booking, price list, receipt and tracking page at the counter, on the website and on WhatsApp." />
          <IconCard icon={Network} title="Best network per shipment" text="Route each parcel to the partner that serves that PIN code best on price, speed and reliability." />
          <IconCard icon={Building2} title="Counter + online, one system" text="Walk-in bookings at Kamothe and website bookings share one price list, one ledger and one tracking page." />
        </div>
      </Section>

      <Section id="challenges" n={num('challenges')} eyebrow="Current challenges" title="What slows the business down today" tint>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Multiple partner portals', 'Staff log in to a different system for each courier to book and track.'],
            ['Inconsistent tracking', 'Customers receive partner AWBs and partner-branded tracking links.'],
            ['Manual rate comparison', 'Choosing the cheapest serviceable partner is done from memory or spreadsheets.'],
            ['No margin visibility', 'Partner cost vs. customer price per shipment is hard to see.'],
            ['Manual accounts', 'Cash collections, receipts and courier bills are reconciled by hand.'],
            ['Limited customer self-service', 'Customers call the counter for price quotes and status updates.'],
          ].map(([t, d]) => <div key={t} className="card flex gap-3 p-5"><AlertTriangle className="h-5 w-5 shrink-0 text-brand-500" /><div><h3 className="font-semibold">{t}</h3><p className="text-sm text-navy-400">{d}</p></div></div>)}
        </div>
      </Section>

      <Section id="solution" n={num('solution')} eyebrow="Proposed solution" title="One platform, four connected experiences">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IconCard icon={Smartphone} title="Public website" text="Rates, booking, payment and tracking under the Veer Express brand." />
          <IconCard icon={Store} title="Counter console" text="Counter bookings, cash / UPI receipts, saved customers and consignment notes." />
          <IconCard icon={Server} title="Admin console" text="Partners, rate cards, allocation, finance, staff, reports and audit logs." />
          <IconCard icon={Plug} title="Courier engine" text="Pluggable partner adapters, pricing, allocation and status normalisation." />
        </div>
      </Section>

      <Section id="how" n={num('how')} eyebrow="How the platform works" title="Customer-facing simplicity, internal intelligence" tint>
        <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
          <div className="card p-5"><div className="label">Customer sees</div><ul className="mt-2 space-y-2 text-sm">{['Veer Express price', 'Veer Express tracking number', 'Unified status timeline', 'Veer receipt & GST invoice'].map((t) => <li key={t} className="flex gap-2"><Eye className="h-4 w-4 text-emerald-600" />{t}</li>)}</ul></div>
          <ArrowRight className="hidden self-center text-navy-200 lg:block" />
          <div className="rounded-2xl bg-navy-900 p-5 text-white"><div className="text-xs font-semibold uppercase tracking-wide text-brand-400">Veer platform</div><ul className="mt-2 space-y-2 text-sm">{['Veer pricing: zones, slabs, volumetric weight, GST', 'Independent Veer tracking number', 'Manual allocation via aggregator account', 'Veer number ↔ courier AWB link', 'Staff-verified tracking updates (audited)', 'Payments & ledger, separate from status'].map((t) => <li key={t} className="flex gap-2"><Cpu className="h-4 w-4 text-brand-400" />{t}</li>)}</ul></div>
          <ArrowRight className="hidden self-center text-navy-200 lg:block" />
          <div className="card p-5"><div className="label">Staff only</div><ul className="mt-2 space-y-2 text-sm">{['Courier name & courier AWB', 'Aggregator booking reference', 'Partner cost & gross margin', 'Who recorded each update'].map((t) => <li key={t} className="flex gap-2"><EyeOff className="h-4 w-4 text-rose-600" />{t}</li>)}</ul></div>
        </div>
      </Section>

      <Section id="customer" n={num('customer')} eyebrow="Customer journey" title="Play a booking, step by step" sub="Sample shipment: Kamothe → New Delhi, 1.5 kg parcel. All figures are sample values.">
        <JourneyPlayer steps={customerSteps} />
      </Section>

      <Section id="counter" n={num('counter')} eyebrow="Counter journey" title="A walk-in customer at Kamothe" tint>
        <JourneyPlayer steps={counterSteps} accent="navy" />
      </Section>

      <Section id="admin" n={num('admin')} eyebrow="Admin journey" title="Control pricing, partners and profit centrally">
        <JourneyPlayer steps={adminSteps} accent="navy" />
      </Section>

      <Section id="partners" n={num('partners')} eyebrow="Courier partner integration" title="Book through the aggregator — no courier APIs needed" sub="Veer books every shipment through one existing aggregator account. Staff record the booking in Veer today; if the aggregator offers an API later, an adapter fills the same fields automatically — existing shipments never change." dark>
        <div className="grid gap-4 lg:grid-cols-2">
          <pre className="overflow-x-auto rounded-2xl border border-navy-700 bg-navy-800 p-5 text-xs leading-relaxed text-navy-100">{`interface AggregatorProvider {
  readonly mode: 'MANUAL' | 'API';
  // MANUAL: staff book in the aggregator portal and
  // record the result; API: called automatically.
  recordBooking(shipment, input): Allocation;
  //   → { aggregatorRef, courierName, awb, partnerCost }
  latestTracking?(awb): TrackingEvent[];   // API mode only
}

ManualAggregatorProvider  → active (initial release)
AggregatorApiProvider     → future, same Allocation record
MockAggregatorProvider    → demo & automated tests

Shipment ──1:1──► Allocation (history kept on change)
   │                └─ courier AWB (internal only)
   └─ Veer tracking number (customer-facing, never changes)`}</pre>
          <div className="space-y-3">
            {[['1. Booking', 'Customer books & pays — Veer tracking number issued'], ['2. Allocation', 'Ops books best courier in aggregator account, records ref + courier + AWB'], ['3. Tracking', 'Ops checks courier site, records verified updates'], ['4. Customer', 'Sees one Veer timeline with "Last updated" time']].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-navy-700 bg-navy-800 px-4 py-3"><div className="font-semibold">{t}</div><div className="text-xs text-navy-200">{d}</div></div>
            ))}
            <p className="text-xs text-navy-200">Individual Blue Dart / Trackon / DTDC APIs are not required for the initial release. Courier names and rates shown are sample data.</p>
          </div>
        </div>
        <div className="mt-6 text-navy-900"><AllocationSandbox /></div>
      </Section>

      <Section id="demo-booking" n={num('demo-booking')} eyebrow="Interactive demo" title="Book a shipment" sub="The real booking wizard in demo mode. Payment is simulated. The new shipment appears in the operations demo’s allocation queue below, and its tracking number works in the tracking demo.">
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-navy-100 p-3 text-sm">
          <span className="font-semibold">Internal view of the same quote:</span>
          <button className="btn-ghost py-1" onClick={() => setInternalView(!internalView)}>{internalView ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{internalView ? 'Hide' : 'Show'} staff-only figures</button>
          {internalView && <span className="animate-rise text-navy-600">Kamothe → Delhi 1.5 kg Express: cheapest sample courier <b>{q.partnerName}</b> · partner cost <b>{inr(q.partnerCost)}</b> · Veer freight <b>{inr(q.freight)}</b> · margin <b>{inr(q.grossMargin)}</b> · GST <b>{inr(q.gst)}</b> · payable <b>{inr(q.total)}</b> <span className="demo-tag">sample</span></span>}
        </div>
        <DemoFrame label="veerexpress.example/book"><BookingWizard compact /></DemoFrame>
      </Section>

      <Section id="demo-tracking" n={num('demo-tracking')} eyebrow="Interactive demo" title="Track a shipment" sub="Pick a scenario, or paste the number you just booked. Presenter controls record the next update the way operations staff would." tint>
        <DemoFrame label="veerexpress.example/track"><TrackingView initial={SHOWCASE_TRACKING} showDemoControls /></DemoFrame>
        <p className="mt-3 text-xs text-navy-400">Customers see only Veer data: no courier name, AWB, aggregator reference or staff names. Tracking is manual and is never advertised as real-time.</p>
      </Section>

      <Section id="demo-ops" n={num('demo-ops')} eyebrow="Interactive demo" title="Manual operations dashboard" sub="What the operations team uses every day: allocate couriers, record verified tracking updates and collect counter payments. All actions are audited.">
        <OpsDemo />
      </Section>

      <Section id="demo-admin" n={num('demo-admin')} eyebrow="Interactive demo" title="Admin dashboard" sub="Internal figures visible. Open the full console to explore every module.">
        <DemoFrame label="veerexpress.example/admin" action={<button className="btn-primary py-1 text-xs" onClick={() => openAs('admin@demo.veer', '/admin')}>Open full admin console</button>}>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total shipments" value={String(adminData.total)} />
            <Kpi label="In transit" value={String(adminData.inTransit)} />
            <Kpi label="Delivered" value={String(adminData.delivered)} />
            <Kpi label="Pending pickup" value={String(adminData.pendingPickup)} />
            <Kpi label="Total revenue" value={inr(Math.round(adminData.revenue))} hint="incl. GST" />
            <Kpi label="Partner payable" value={inr(Math.round(adminData.payable))} />
            <Kpi label="Gross profit" value={inr(Math.round(adminData.profit))} />
            <Kpi label="Today's bookings" value={String(adminData.today)} />
          </div>
          <DashboardCharts d={adminData} />
        </DemoFrame>
      </Section>


      <Section id="architecture" n={num('architecture')} eyebrow="Technology architecture" title="Modern, managed and low-cost to start" sub="No VPS needed for the initial rollout." dark>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            [Smartphone, 'Frontend · Vercel', ['React + TypeScript', 'Tailwind design system', 'React Router, React Query', 'Shared @veer/core pricing logic']],
            [Server, 'Backend · Render', ['NestJS modular monolith', 'JWT auth + role guards + audit', 'Modules: pricing, shipments, allocation, tracking, payments, ledger', 'Aggregator, payment & notification adapters']],
            [Database, 'Database · Supabase', ['PostgreSQL, 23 normalised tables', 'Row-level security', 'Versioned SQL migrations', 'Automated backups']],
          ].map(([I, t, items]) => { const Icon = I as typeof Server; return (
            <div key={t as string} className="rounded-2xl border border-navy-700 bg-navy-800 p-5"><Icon className="h-7 w-7 text-brand-400" /><h3 className="mt-3 font-bold">{t as string}</h3><ul className="mt-2 space-y-1.5 text-sm text-navy-200">{(items as string[]).map((x) => <li key={x} className="flex gap-2"><Check className="h-4 w-4 text-brand-400" />{x}</li>)}</ul></div>); })}
        </div>
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
          {[[Plug, 'Aggregator account', 'Manual today · API adapter later'], [Wallet, 'Payment gateway', 'Verified online payments (simulated now)'], [MessageCircle, 'WhatsApp · SMS · Email', 'Adapter-based (simulated now)'], [Cloud, 'One cloud stack', 'Vercel + Render + Supabase, no VPS']].map(([I, t, d]) => { const Icon = I as typeof Plug; return <div key={t as string} className="flex items-center gap-3 rounded-xl border border-dashed border-navy-600 p-3"><Icon className="h-5 w-5 text-brand-400" /><div><div className="font-semibold">{t as string}</div><div className="text-xs text-navy-200">{d as string}</div></div></div>; })}
        </div>
      </Section>

      <Section id="security" n={num('security')} eyebrow="Security & access" title="Each person sees exactly what their role allows">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase text-navy-400"><tr><th className="px-4 py-3">Role</th><th>Shipments</th><th>Partner cost</th><th>Finance</th><th>Config</th></tr></thead>
              <tbody>
                {[['Super Admin', 'All', '✓', '✓', '✓'], ['Admin (operations)', 'All', '✓', 'View', '✓'], ['Accountant', 'All', '✓', '✓', '—'], ['Counter staff', 'All', '—', 'Collections', '—'], ['Customer', 'Own only', '—', 'Own invoices', '—']].map((r) => <tr key={r[0]} className="border-t border-navy-50">{r.map((c, k) => <td key={k} className={`py-2.5 ${k === 0 ? 'px-4 font-semibold' : ''}`}>{c}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <IconCard icon={Lock} title="Least-privilege roles" text="Counter staff never see courier costs; only admins manage staff. Enforced on the server and in the database." />
            <IconCard icon={KeyRound} title="Secrets stay server-side" text="Courier credentials encrypted at rest; never sent to the browser." />
            <IconCard icon={Receipt} title="No card storage" text="Payments via Razorpay checkout; we store only references and status." />
            <IconCard icon={ShieldCheck} title="Full audit trail" text="Rate, partner, finance and user changes are logged with who/when." />
          </div>
        </div>
      </Section>

      <Section id="roadmap" n={num('roadmap')} eyebrow="Development roadmap" title="Delivered in controlled phases" tint>
        <ol className="relative space-y-6 border-l-2 border-navy-100 pl-8">
          {[
            ['Milestone 1', 'Client demo & presentation', 'Public site, rate calculator, booking, sample payments, allocation queue, tracking desk, counter collection and admin dashboard — on sample data.', 'Done'],
            ['Milestone 2', 'Core backend', 'Modular NestJS monolith: staff & roles, login protection, audit log, database rules for allocations, tracking audit and ledger.', 'Done'],
            ['Milestone 3', 'Shipments & operations', 'Bookings, manual allocation via the aggregator, tracking desk, counter receipts, customer tracking with "Last updated", website connected to the server.', 'Done'],
            ['Milestone 4', 'Billing', 'GST invoices, company GST settings, ledger, consignment-note PDF, PIN code lookup, saved customers, e-mail of the bill.', 'Done'],
            ['Milestone 5', 'Launch', 'Real payment gateway (test mode first), e-mail / WhatsApp sending, staging and go-live — each on your approval.', 'Next'],
          ].map(([p, t, d, s], k) => (
            <li key={p} className="relative">
              <span className={`absolute -left-[41px] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white ${s === 'Done' ? 'bg-emerald-500' : s === 'Next' ? 'bg-brand-500' : 'bg-navy-200'}`}>{s === 'Done' && <Check className="h-3 w-3 text-white" />}</span>
              <div className="card p-5" style={{ animation: `rise .5s ${k * 0.08}s ease-out both` }}>
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-brand-500">{p}</span><h3 className="font-bold">{t}</h3>{s && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s === 'Done' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700'}`}>{s}</span>}</div>
                <p className="mt-1 text-sm text-navy-400">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="timeline" n={num('timeline')} eyebrow="Delivery timeline" title="Indicative schedule" sub="Estimates — final timeline depends on payment gateway onboarding, aggregator account access and content sign-off.">
        <div className="card overflow-x-auto p-5">
          <div className="min-w-[640px]">
            <div className="mb-2 grid grid-cols-[160px_repeat(12,1fr)] text-center text-[11px] text-navy-400"><span />{Array.from({ length: 12 }, (_, k) => <span key={k}>W{k + 1}</span>)}</div>
            {[['Demo & sign-off', 0, 1], ['Core backend', 1, 3], ['Shipments & operations', 3, 3], ['Payments & finance', 5, 3], ['Notifications', 8, 2], ['UAT & go-live', 10, 2]].map(([t, s, len]) => (
              <div key={t as string} className="grid grid-cols-[160px_repeat(12,1fr)] items-center py-1.5 text-sm">
                <span className="font-medium">{t as string}</span>
                <div className="h-6 rounded-md bg-brand-500/90" style={{ gridColumn: `${(s as number) + 2} / span ${len as number}` }} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="future" n={num('future')} eyebrow="Future enhancements" title="Where the platform can grow" tint>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IconCard icon={Smartphone} title="Customer mobile app" text="Bookings, saved addresses and push tracking." />
          <IconCard icon={Boxes} title="E-commerce integrations" text="Shopify / WooCommerce plugins and bulk CSV booking." />
          <IconCard icon={Users} title="Pickup agent app" text="Doorstep pickup assignment with proof of pickup." />
          <IconCard icon={FileSpreadsheet} title="Aggregator API" text="Automatic booking & tracking through the same adapter — no data migration." />
        </div>
      </Section>

      <section id="contact" className="scroll-mt-20 bg-navy-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-[.2em] text-brand-400"><span className="mr-3 rounded-md bg-navy-800 px-2 py-0.5 font-mono">{num('contact')}</span>Next step</div>
            <h2 className="mt-3 text-4xl font-extrabold">Let's make every delivery a Veer Express delivery.</h2>
            <p className="mt-3 text-navy-200">Explore the demo freely — every screen is interactive. Demo logins (password <code className="rounded bg-navy-800 px-1">Demo@123</code>):</p>
            <ul className="mt-4 space-y-1.5 text-sm">{DEMO_LOGINS.map((u) => <li key={u.email} className="flex gap-2"><Rocket className="h-4 w-4 text-brand-400" /><span className="font-mono">{u.email}</span><span className="text-navy-200">— {u.name}</span></li>)}</ul>
            <div className="mt-6 rounded-xl border border-navy-700 bg-navy-800 p-4 text-sm">
              <div className="font-semibold text-white">Visit or call us</div>
              <address className="mt-1 not-italic text-navy-200">{BUSINESS.addressLines.map((l) => <span key={l} className="block">{l}</span>)}</address>
              <div className="mt-2 flex flex-wrap gap-3">
                <a className="font-semibold text-brand-400 hover:underline" href={`tel:${BUSINESS.phoneE164}`}>{BUSINESS.phoneDisplay}</a>
                <a className="font-semibold text-emerald-400 hover:underline" href={BUSINESS.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </div>
            </div>
            <button className="mt-6 btn border border-navy-600 text-white hover:bg-navy-800" onClick={() => { demo.reset(); setResetDone(true); }}><RotateCcw className="h-4 w-4" />{resetDone ? 'Demo data reset — reload to see it' : 'Reset demo data'}</button>
          </div>
          <RequestDemoForm />
        </div>
      </section>
      <footer className="border-t border-navy-800 bg-navy-900 py-5 text-center text-xs text-navy-200">Veer Express Courier · Proposal demo · All names, figures and records shown are sample data.</footer>
    </div>
  );
}

function OpsDemo() {
  const [tab, setTab] = useState<'allocation' | 'tracking' | 'collections'>('allocation');
  const [ver, setVer] = useState(0);
  const list = useMemo(() => demo.shipments(), [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => setVer((v) => v + 1);
  const counts = {
    allocation: list.filter((s) => !s.allocation && s.status !== 'DELIVERED').length,
    tracking: list.filter((s) => s.allocation && s.status !== 'DELIVERED').length,
    collections: list.filter((s) => s.payments.reduce((a, p) => a + p.amount, 0) < s.amount - 0.005).length,
  };
  const tabs: [typeof tab, string][] = [['allocation', 'Allocation queue'], ['tracking', 'Tracking desk'], ['collections', 'Counter collection']];
  return (
    <DemoFrame label={`veerexpress.example/admin/${tab === 'tracking' ? 'tracking-desk' : tab}`} action={<button className="btn-ghost py-1 text-xs" onClick={refresh}><RotateCcw className="h-3.5 w-3.5" />Refresh</button>}>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); refresh(); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-navy-800 text-white' : 'bg-white text-navy-700 ring-1 ring-navy-100 hover:bg-navy-50'}`}>
            {l} <span className={`ml-1 rounded-full px-1.5 text-xs ${tab === k ? 'bg-brand-500' : 'bg-navy-50'}`}>{counts[k]}</span>
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-navy-400">Signed in as {PRESENTER.name} (demo)</span>
      </div>
      {tab === 'allocation' && <AllocationQueue user={PRESENTER} list={list} refresh={refresh} embedded />}
      {tab === 'tracking' && <TrackingDesk user={PRESENTER} list={list} refresh={refresh} embedded />}
      {tab === 'collections' && <CounterCollection user={PRESENTER} list={list} refresh={refresh} embedded />}
    </DemoFrame>
  );
}

function RequestDemoForm() {
  const [sent, setSent] = useState(false);
  return (
    <form className="rounded-2xl bg-white p-6 text-navy-900" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
      {sent ? (
        <div className="py-12 text-center"><Check className="mx-auto h-10 w-10 text-emerald-600" /><p className="mt-3 font-semibold">Request noted (demo)</p><p className="text-sm text-navy-400">This demo form doesn't send data anywhere.</p></div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-lg font-bold">Request a demo</h3>
          <input className="input" placeholder="Name" required />
          <input className="input" placeholder="Business name" />
          <input className="input" placeholder="Mobile" required pattern="[6-9][0-9]{9}" title="10-digit Indian mobile number" />
          <select className="input"><option>Walkthrough of the platform</option><option>Business account</option></select>
          <button className="btn-primary w-full">Request demo</button>
        </div>
      )}
    </form>
  );
}
