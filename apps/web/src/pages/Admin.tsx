import { useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  BadgeIndianRupee, Banknote, BookOpen, Bell, Building2, ClipboardList, FileSpreadsheet, FileText, Gauge, IndianRupee, LogOut, Map, Menu,
  Package, PackagePlus, Percent, Radar, Settings, ShieldCheck, Shuffle, Store, Truck, Users, UserCog, Wallet, X,
} from 'lucide-react';
import {
  DEMO_PRICING, DEMO_RATE_CARDS, STATUS_LABEL, UNIFIED_STATUSES, allocate,
  type AllocationMode, type DemoShipment, type ServiceType,
} from '@veer/core';
import { DEMO_LOGINS, demo, notifications, payStatus, type DemoUser } from '../demo/store';
import { LIVE, consoleFor, currentUser, demoSignIn, liveSignIn, signOut, useLoad } from '../data/source';
import { AllocationQueue, AuditPage, CounterCollection, LedgerPage, PaymentsPage, ShipmentDrawer, TrackingDesk, shipmentColumns } from './Operations';
import { STALE_AFTER_HOURS, balanceDue, hoursSinceLastUpdate } from '@veer/core';
import { DataTable, DemoBanner, Kpi, Logo, fmtDate, inr, type Column } from '../components/ui';
import BookingWizard from '../components/BookingWizard';
import { StaffPage } from './People';
import { CompanySettingsPage, InvoicesPage } from './Billing';

const NAV: [string, string, typeof Gauge][] = [
  ['', 'Dashboard', Gauge], ['shipments', 'Shipments', Package], ['new-booking', 'New Booking', PackagePlus],
  ['allocation', 'Allocation Queue', Shuffle], ['tracking-desk', 'Tracking Desk', Radar], ['collections', 'Counter Collection', Banknote],
  ['customers', 'Customers', Users], ['partners', 'Courier Partners', Truck], ['rate-cards', 'Courier Rate Cards', FileSpreadsheet],
  ['serviceability', 'PIN Code Serviceability', Map],
  ['staff', 'Staff Management', UserCog], ['payments', 'Payments', IndianRupee],
  ['invoices', 'Invoices', FileText], ['ledger', 'Financial Ledger', BookOpen], ['reports', 'Reports', ClipboardList],
  ['notifications', 'Notifications', Bell], ['settings', 'Settings', Settings], ['audit', 'Audit Logs', ShieldCheck],
];
const CHART = ['#0f2149', '#f26a12', '#5470a8', '#ff8a3d', '#aebddc', '#16a34a', '#e11d48'];
const branchName = (id: string) => demo.branches.find((b) => b.id === id)?.city ?? id;
/** Pages backed by the API. In a live build the remaining pages (still sample data) are hidden. */
const LIVE_PAGES = new Set(['', 'shipments', 'new-booking', 'allocation', 'tracking-desk', 'collections', 'payments', 'ledger', 'audit', 'staff', 'invoices', 'settings']);
/** What each role works with. Admins see everything; the server enforces the same rules. */
const ROLE_PAGES: Partial<Record<DemoUser['role'], Set<string>>> = {
  BOOKING_STAFF: new Set(['', 'shipments', 'new-booking', 'collections', 'customers']),
  ACCOUNTANT: new Set(['', 'shipments', 'payments', 'invoices', 'ledger', 'reports', 'audit']),
};
const allowed = (user: DemoUser, to: string) => (ROLE_PAGES[user.role]?.has(to) ?? true) && (!LIVE || LIVE_PAGES.has(to));
const navFor = (user: DemoUser) => NAV.filter(([to]) => allowed(user, to));
/** Sample-data page: shown in demo builds only. */
const demoOnly = (el: ReactNode, base: string) => (LIVE ? <Navigate to={base} replace /> : el);
const SAMPLE = LIVE ? '' : ' · sample figures';

/** Loads the signed-in user's shipments (branch-scoped by the server in live mode). */
function useShipments(user: DemoUser | null) {
  return useLoad((d) => (user ? d.shipments(user) : Promise.resolve([] as DemoShipment[])), [user?.name, user?.role, user?.branchId], [] as DemoShipment[]);
}
function LoadState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (error) return <div className="mb-4 flex items-center justify-between rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}<button className="btn-ghost py-1" onClick={retry}>Retry</button></div>;
  return loading ? <div className="mb-4 text-sm text-navy-400">Loading…</div> : null;
}

// ---------------------------------------------------------------- login

export function DemoLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState(LIVE ? '' : DEMO_LOGINS[0].email);
  const [pw, setPw] = useState(LIVE ? '' : 'Demo@123');
  const [err, setErr] = useState(LIVE && new URLSearchParams(location.search).has('expired') ? 'Your session ended. Please sign in again.' : '');
  const [busy, setBusy] = useState(false);
  const go = (u: DemoUser) => { demoSignIn(u); nav(consoleFor(u)); };
  return (
    <div className="flex min-h-screen flex-col bg-navy-50">
      <DemoBanner />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="card w-full max-w-md p-7">
          <Logo />
          <h1 className="mt-6 text-2xl font-extrabold">Staff sign-in</h1>
          <p className="text-sm text-navy-400">{LIVE ? 'Sign in with your Veer Express staff account.' : 'Demo access only — these sample accounts work only in demo mode.'}</p>
          <form className="mt-5 space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (!LIVE) {
              const u = DEMO_LOGINS.find((d) => d.email === email.trim().toLowerCase() && d.password === pw);
              return u ? go(u) : setErr('Invalid demo credentials');
            }
            setBusy(true);
            const r = await liveSignIn(email.trim(), pw);
            setBusy(false);
            r.ok ? nav(consoleFor(r.value)) : setErr(r.error);
          }}>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" placeholder="Email" />
            <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" placeholder="Password" />
            {err && <p className="text-sm text-rose-600">{err}</p>}
            <button className="btn-navy w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          {!LIVE && <div className="mt-5 space-y-1.5">
            <div className="label">One-click demo roles (password Demo@123)</div>
            {DEMO_LOGINS.map((u) => (
              <button key={u.email} onClick={() => go(u)} className="flex w-full justify-between rounded-lg border border-navy-100 px-3 py-2 text-left text-sm hover:border-brand-500">
                <span>{u.name}</span><span className="font-mono text-xs text-navy-400">{u.email}</span>
              </button>
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shell

function Shell({ title, nav, base, user, children }: { title: string; nav: typeof NAV; base: string; user: DemoUser; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-navy-50/60">
      <DemoBanner />
      <div className="flex">
        <aside className={`${open ? 'fixed inset-0 z-40 flex' : 'hidden'} w-64 shrink-0 flex-col bg-navy-900 text-navy-100 lg:sticky lg:top-0 lg:flex lg:h-screen`}>
          <div className="flex items-center justify-between p-4"><Logo light to={base} /><button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></div>
          <div className="px-4 pb-2 text-[11px] uppercase tracking-widest text-navy-400">{title}</div>
          <nav className="flex-1 overflow-y-auto px-2 pb-4">
            {nav.map(([to, label, Icon]) => (
              <NavLink key={to} end to={`${base}/${to}`.replace(/\/$/, '')} onClick={() => setOpen(false)}
                className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-500 font-semibold text-white' : 'hover:bg-navy-800'}`}>
                <Icon className="h-4 w-4" />{label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-navy-100 bg-white/90 px-4 py-3 backdrop-blur">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
            <div className="flex-1 text-sm"><b>{user.name}</b> <span className="ml-1 rounded bg-navy-50 px-1.5 py-0.5 text-xs text-navy-600">{user.role.replace('_', ' ')}</span></div>
            <Link to="/presentation" className="hidden text-sm text-navy-400 hover:text-navy-800 sm:block">Presentation</Link>
            <button className="btn-ghost py-1.5" onClick={() => { signOut(); navigate('/login'); }}><LogOut className="h-4 w-4" />Sign out</button>
          </header>
          <main className="p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

const H = ({ t, s, children }: { t: string; s?: string; children?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-extrabold">{t}</h1>{s && <p className="text-sm text-navy-400">{s}</p>}</div>{children}</div>
);

// ---------------------------------------------------------------- dashboards

export function useDashboardData(list: DemoShipment[]) {
  return useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const revenue = list.reduce((s, x) => s + x.amount, 0);
    const payable = list.reduce((s, x) => s + (x.allocation?.partnerCost ?? 0), 0);
    const byDay: Record<string, number> = {};
    list.forEach((s) => { const d = s.bookedAt.slice(5, 10); byDay[d] = (byDay[d] ?? 0) + 1; });
    const status = UNIFIED_STATUSES.map((st) => ({ name: STATUS_LABEL[st], value: list.filter((s) => s.status === st).length })).filter((x) => x.value);
    const partners = [...new Set(list.filter((s) => s.allocation).map((s) => s.allocation!.courierName))].map((p) => {
      const ps = list.filter((s) => s.allocation?.courierName === p);
      return { name: p, shipments: ps.length, delivered: Math.round((ps.filter((s) => s.status === 'DELIVERED').length / ps.length) * 100), exceptions: ps.filter((s) => s.status === 'EXCEPTION').length };
    });
    const branches = demo.branches.map((b) => {
      const bs = list.filter((s) => s.branchId === b.id);
      return { name: b.city, revenue: bs.reduce((s, x) => s + x.amount, 0), shipments: bs.length };
    }).filter((b) => b.shipments);
    // SAMPLE monthly series for the demo chart (anchored to current month's actual seed revenue)
    const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((m, i) => ({ month: m, revenue: Math.round(revenue * (0.45 + i * 0.11)) }));
    return {
      total: list.length, today: list.filter((s) => s.bookedAt.startsWith(today)).length,
      inTransit: list.filter((s) => ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY'].includes(s.status)).length,
      delivered: list.filter((s) => s.status === 'DELIVERED').length,
      pendingPickup: list.filter((s) => s.status === 'BOOKED').length,
      revenue, payable, profit: list.filter((x) => x.allocation).reduce((a, x) => a + x.amount / 1.18 - x.allocation!.partnerCost, 0),
      awaitingAllocation: list.filter((s) => !s.allocation && s.status !== 'DELIVERED').length,
      staleTracking: list.filter((s) => s.allocation && s.status !== 'DELIVERED' && hoursSinceLastUpdate(s.events) >= STALE_AFTER_HOURS).length,
      paymentDue: list.filter((s) => payStatus(s) !== 'PAID' && payStatus(s) !== 'REFUNDED').length,
      outstanding: list.reduce((a, s) => a + balanceDue(s.amount, s.payments), 0),
      byDay: Object.entries(byDay).sort().map(([day, count]) => ({ day, count })), status, partners, branches, months,
    };
  }, [list]);
}

function ChartCard({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}><div className="mb-3 text-sm font-semibold">{title}</div><div className="h-60">{children}</div></div>;
}

export function DashboardCharts({ d, showPartners = true }: { d: ReturnType<typeof useDashboardData>; showPartners?: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard title="Daily bookings" className="lg:col-span-2">
        <ResponsiveContainer><BarChart data={d.byDay}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f9" /><XAxis dataKey="day" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="count" name="Bookings" fill="#0f2149" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Shipment status">
        <ResponsiveContainer><PieChart><Pie data={d.status} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>{d.status.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
      </ChartCard>
      {!LIVE && <ChartCard title="Monthly revenue (sample trend)" className="lg:col-span-2">
        <ResponsiveContainer><LineChart data={d.months}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f9" /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip formatter={(v: number) => inr(v)} /><Line dataKey="revenue" stroke="#f26a12" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
      </ChartCard>}
      {showPartners && (
        <ChartCard title="Courier performance — allocated shipments (internal)" className="lg:col-span-3">
          <ResponsiveContainer><BarChart data={d.partners}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f9" /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="shipments" name="Shipments" fill="#0f2149" radius={[4, 4, 0, 0]} /><Bar dataKey="delivered" name="Delivered %" fill="#16a34a" radius={[4, 4, 0, 0]} /><Bar dataKey="exceptions" name="Exceptions" fill="#e11d48" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

function Dashboard({ list }: { list: DemoShipment[] }) {
  const d = useDashboardData(list);
  return (
    <>
      <H t="Dashboard" s={`Veer Express · Kamothe${SAMPLE}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total shipments" value={String(d.total)} icon={<Package className="h-4 w-4" />} />
        <Kpi label="Today's bookings" value={String(d.today)} hint="Book one to see this change" />
        <Kpi label="In transit" value={String(d.inTransit)} />
        <Kpi label="Delivered" value={String(d.delivered)} />
        <Kpi label="Pending pickup" value={String(d.pendingPickup)} />
        <Kpi label="Total revenue" value={inr(Math.round(d.revenue))} hint="incl. GST" icon={<BadgeIndianRupee className="h-4 w-4" />} />
        <Kpi label="Partner payable" value={inr(Math.round(d.payable))} hint="Internal" />
        <Kpi label="Gross profit" value={inr(Math.round(d.profit))} hint="Allocated shipments, ex-GST − partner cost" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OpsKpi to="/admin/allocation" label="Awaiting allocation" value={d.awaitingAllocation} />
        <OpsKpi to="/admin/tracking-desk" label={`Tracking not updated ${STALE_AFTER_HOURS}h+`} value={d.staleTracking} />
        <OpsKpi to="/admin/collections" label="Payment due" value={d.paymentDue} hint={inr(Math.round(d.outstanding))} />
        <OpsKpi to="/admin/ledger" label="Ledger" value={null} hint="Trial balance & journal" />
      </div>
      <DashboardCharts d={d} />
    </>
  );
}

// ---------------------------------------------------------------- shipments

function OpsKpi({ to, label, value, hint }: { to: string; label: string; value: number | null; hint?: string }) {
  return (
    <Link to={to} className={`card block p-4 transition hover:border-brand-400 ${value ? 'ring-1 ring-amber-200' : ''}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-navy-400">{label}</div>
      <div className="mt-2 flex items-baseline gap-2"><span className="font-display text-2xl font-bold">{value ?? '→'}</span>{hint && <span className="text-xs text-navy-400">{hint}</span>}</div>
    </Link>
  );
}

function Shipments({ list, base, internal = true }: { list: DemoShipment[]; base: string; internal?: boolean }) {
  const [sel, setSel] = useState<DemoShipment | null>(null);
  return (
    <>
      <H t="Shipments" s={internal ? 'Shipment status and payment status are tracked separately. Courier, AWB and partner cost are visible to authorised staff only.' : 'Only this branch\'s shipments are visible.'} />
      <DataTable title="Shipments" rows={list} columns={shipmentColumns(internal)} onRow={setSel}
        filters={[
          { label: 'statuses', options: UNIFIED_STATUSES.map((s) => STATUS_LABEL[s]), get: (s) => STATUS_LABEL[s.status] },
          { label: 'payment', options: ['PAID', 'PARTIALLY_PAID', 'PENDING', 'REFUNDED'], get: (s) => payStatus(s) },
          ...(internal ? [{ label: 'allocation', options: ['Allocated', 'Awaiting allocation'], get: (s: DemoShipment) => (s.allocation ? 'Allocated' : 'Awaiting allocation') },
            { label: 'branches', options: demo.branches.map((b) => b.city), get: (s: DemoShipment) => branchName(s.branchId) }] : []),
        ]} />
      {sel && <ShipmentDrawer s={sel} internal={internal} base={base} onClose={() => setSel(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- engine pages

function Partners() {
  const couriers = DEMO_RATE_CARDS.filter((p) => p.partnerCode !== 'MOCK');
  return (
    <>
      <H t="Courier partners & aggregator" s="Shipments are booked through one external aggregator account. Direct courier APIs are not required for the initial release." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between"><h3 className="font-semibold">{demo.aggregator}</h3><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Active · manual</span></div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {[['Adapter', 'ManualAggregatorProvider'], ['Booking', 'Staff book in aggregator portal'], ['Recorded in Veer', 'Aggregator ref · courier · AWB · cost'], ['Tracking', 'Manual — staff check courier tracking pages'],
              ['Future', 'AggregatorApiProvider (same records, filled automatically)'], ['Credentials', 'None stored — not needed for manual mode']].map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-navy-50 py-1"><dt className="text-navy-400">{k}</dt><dd className="text-right">{v}</dd></div>)}
          </dl>
        </div>
        <div className="card p-5"><h3 className="font-semibold">Why an adapter?</h3><p className="mt-2 text-sm text-navy-400">If the aggregator later offers an API, a new adapter fills the same allocation fields automatically. Existing shipments, tracking numbers and reports do not change.</p></div>
      </div>
      <h2 className="mb-3 mt-6 font-semibold">Couriers available through the aggregator (sample)</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {couriers.map((p) => (
          <div key={p.partnerCode} className="card p-5">
            <h3 className="font-semibold">{p.partnerName}</h3>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-navy-400">Volumetric divisor</dt><dd>{p.volumetricDivisor}</dd></div>
              <div className="flex justify-between"><dt className="text-navy-400">Fuel surcharge</dt><dd>{p.fuelSurchargePct}%</dd></div>
              <div className="flex justify-between"><dt className="text-navy-400">Allocated (demo)</dt><dd>{demo.shipments().filter((s) => s.allocation?.courierName === p.partnerName).length}</dd></div>
              <div className="flex justify-between"><dt className="text-navy-400">Direct API</dt><dd>Not required</dd></div>
            </dl>
          </div>
        ))}
      </div>
      <AllocationSandbox />
    </>
  );
}

export function AllocationSandbox() {
  const [mode, setMode] = useState<AllocationMode>('CHEAPEST');
  const [manual, setManual] = useState('BLUEDART');
  const [dest, setDest] = useState('110001');
  const [w, setW] = useState('2');
  const [service, setService] = useState<ServiceType>('EXPRESS');
  const r = useMemo(() => {
    try {
      return allocate(DEMO_RATE_CARDS, DEMO_PRICING, { originPin: '410209', destPin: dest, actualWeightKg: Number(w), dims: { lengthCm: 20, widthCm: 20, heightCm: 10 }, service, declaredValue: 0, insurance: false }, mode,
        { manualPartner: manual, rules: [{ zone: 'SPECIAL', preferPartner: 'DTDC' }, { service: 'EXPRESS', maxWeightKg: 5, preferPartner: 'BLUEDART' }] });
    } catch { return null; }
  }, [mode, manual, dest, w, service]);
  return (
    <div className="card mt-6 p-5">
      <h2 className="text-lg font-bold">Rate comparison sandbox</h2>
      <p className="text-sm text-navy-400">Helps staff pick a courier before booking in the aggregator account. Origin 410209 (Kamothe). Sample rules: remote zone → DTDC; Express ≤ 5 kg → Blue Dart. Sample rates.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as AllocationMode)}><option value="CHEAPEST">Auto — cheapest</option><option value="RULE_BASED">Rule-based</option><option value="MANUAL">Manual</option></select>
        {mode === 'MANUAL' && <select className="input" value={manual} onChange={(e) => setManual(e.target.value)}>{DEMO_RATE_CARDS.map((p) => <option key={p.partnerCode} value={p.partnerCode}>{p.partnerName}</option>)}</select>}
        <input className="input" value={dest} onChange={(e) => setDest(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Destination PIN" />
        <input className="input" type="number" value={w} onChange={(e) => setW(e.target.value)} aria-label="Weight kg" />
        <select className="input" value={service} onChange={(e) => setService(e.target.value as ServiceType)}><option>EXPRESS</option><option>STANDARD</option><option>SURFACE</option></select>
      </div>
      {r ? (
        <>
          <div className={`mt-4 rounded-lg p-3 text-sm ${r.chosen ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>{r.reason}</div>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-navy-400"><tr><th className="py-2">Partner</th><th>Zone</th><th>Chg. wt</th><th>Partner cost</th><th>Customer price (pre-tax)</th><th>Margin</th><th>TAT</th></tr></thead>
            <tbody>{r.candidates.map((c) => <tr key={c.partnerCode} className={`border-t border-navy-50 ${r.chosen?.partnerCode === c.partnerCode ? 'font-semibold text-brand-700' : ''}`}><td className="py-2">{c.partnerName}</td><td>{c.zone}</td><td>{c.chargeableWeightKg}</td><td>{inr(c.partnerCost)}</td><td>{inr(c.freight)}</td><td>{inr(c.grossMargin)}</td><td>{c.estimatedDays}d</td></tr>)}</tbody></table></div>
        </>
      ) : <p className="mt-4 text-sm text-rose-600">Enter a valid 6-digit PIN.</p>}
    </div>
  );
}

function RateCards() {
  const rows = DEMO_RATE_CARDS.flatMap((p) => p.slabs.map((s) => ({ partner: p.partnerName, ...s })));
  return (
    <>
      <H t="Courier rate cards" s="Zone × service × weight slabs. SAMPLE FIGURES — not actual partner tariffs." />
      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <Kpi label="Markup (flat)" value={inr(DEMO_PRICING.markupFlat)} /><Kpi label="Markup %" value={`${DEMO_PRICING.markupPct}%`} />
        <Kpi label="Insurance" value={`${DEMO_PRICING.insurancePct}% (min ${inr(DEMO_PRICING.insuranceMin)})`} /><Kpi label="GST" value={`${DEMO_PRICING.gstPct}%`} />
        <Kpi label="Example" value="₹80 + ₹30 = ₹110" hint="Partner cost + markup (sample)" />
      </div>
      <DataTable title="Rate cards" rows={rows} pageSize={10}
        filters={[{ label: 'partners', options: DEMO_RATE_CARDS.map((p) => p.partnerName), get: (r) => r.partner }, { label: 'services', options: ['EXPRESS', 'STANDARD', 'SURFACE'], get: (r) => r.service }]}
        columns={[{ key: 'partner', label: 'Partner' }, { key: 'service', label: 'Service' }, { key: 'zone', label: 'Zone' }, { key: 'basePrice', label: 'Base ₹', render: (r) => inr(r.basePrice) }, { key: 'baseWeightKg', label: 'Base kg' }, { key: 'additionalPrice', label: 'Addl ₹', render: (r) => inr(r.additionalPrice) }, { key: 'stepKg', label: 'Per kg step' }, { key: 'minCharge', label: 'Min ₹' }, { key: 'tatDays', label: 'TAT days' }]} />
    </>
  );
}

function Serviceability() {
  const pins = ['410209', '411001', '400053', '110001', '560001', '781001', '190001', '744101', '302001', '700001'];
  const rows = pins.map((pin) => ({ pin, ...Object.fromEntries(DEMO_RATE_CARDS.map((p) => [p.partnerCode, p.enabled && !p.nonServiceablePrefixes.some((x) => pin.startsWith(x)) ? 'Yes' : 'No'])) }));
  return (
    <>
      <H t="PIN code serviceability" s="Sample matrix. In production, synced from partner serviceability APIs or uploaded CSV files." />
      <DataTable title="Serviceability" rows={rows} columns={[{ key: 'pin', label: 'PIN code' }, ...DEMO_RATE_CARDS.map((p) => ({ key: p.partnerCode, label: p.partnerName, render: (r: Record<string, string>) => <span className={r[p.partnerCode] === 'Yes' ? 'text-emerald-700' : 'text-rose-600'}>{r[p.partnerCode]}</span> }))]} />
    </>
  );
}

function Simple<T>({ t, s, rows, columns }: { t: string; s?: string; rows: T[]; columns: Column<T>[] }) {
  return <><H t={t} s={s} /><DataTable title={t} rows={rows} columns={columns} /></>;
}

function Finance({ list, kind }: { list: DemoShipment[]; kind: 'payments' | 'invoices' }) {
  if (kind === 'payments') return <PaymentsPage list={list} />;
  return <Simple t="Invoices" s="GST invoice records (demo — not valid tax invoices)" rows={list.map((s, i) => ({ no: `VX/26-27/${String(i + 1).padStart(4, '0')}`, tn: s.trackingNumber, taxable: +(s.amount / 1.18).toFixed(2), gst: +(s.amount - s.amount / 1.18).toFixed(2), total: s.amount }))}
    columns={[{ key: 'no', label: 'Invoice #' }, { key: 'tn', label: 'Shipment' }, { key: 'taxable', label: 'Taxable', render: (r) => inr(r.taxable) }, { key: 'gst', label: 'GST', render: (r) => inr(r.gst) }, { key: 'total', label: 'Total', render: (r) => inr(r.total) }]} />;
}

function Notifications() {
  const n = notifications();
  const templates = ['booking_confirmation', 'payment_confirmation', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_exception'];
  return (
    <>
      <H t="Notifications" s="WhatsApp / SMS / Email adapters run in SIMULATED mode — nothing is actually sent." />
      <div className="mb-4 flex flex-wrap gap-2">{templates.map((t) => <span key={t} className="rounded-full bg-white px-3 py-1 text-xs shadow-card">{t}</span>)}</div>
      <Simple t="Notification log" rows={n} columns={[{ key: 'at', label: 'Time', render: (r) => fmtDate(r.at) }, { key: 'channel', label: 'Channel' }, { key: 'template', label: 'Template' }, { key: 'to', label: 'To' }, { key: 'body', label: 'Message', render: (r) => <span className="whitespace-normal">{r.body}</span> }]} />
      {n.length === 0 && <p className="mt-3 text-sm text-navy-400">Book a demo shipment or advance a status to generate simulated notifications.</p>}
    </>
  );
}

function SettingsPage() {
  return (
    <>
      <H t="Settings" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5"><h3 className="font-semibold">Environment</h3><p className="mt-2 text-sm">App mode: <b>demo</b>. Production mode switches the data layer to the authenticated REST API.</p></div>
        <div className="card p-5"><h3 className="font-semibold">Allocation default</h3><p className="mt-2 text-sm">Manual allocation by operations staff via the aggregator account. Rate comparison suggests the cheapest courier.</p></div>
        <div className="card p-5"><h3 className="font-semibold">Secrets</h3><p className="mt-2 text-sm">Courier credentials and payment keys are stored encrypted on the server only. They are never sent to the browser.</p></div>
        <div className="card p-5"><h3 className="font-semibold">Reset demo</h3><p className="mt-2 text-sm">Restore the original 20 sample shipments.</p><button className="btn-ghost mt-3" onClick={() => { demo.reset(); location.reload(); }}>Reset demo data</button></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- routes

export default function Admin() {
  const user = currentUser();
  const { value: list, loading, error, refresh } = useShipments(user);
  if (!user) return <Navigate to="/login" replace />;
  const all = list;
  const d = (el: ReactNode) => demoOnly(el, '/admin');
  /** Pages outside the user's role go back to the dashboard. */
  const page = (to: string, el: ReactNode) => (allowed(user, to) ? el : <Navigate to="/admin" replace />);

  return (
    <Shell title="Veer Express · Kamothe" nav={navFor(user)} base="/admin" user={user}>
      <LoadState loading={loading} error={error} retry={refresh} />
      <Routes>
        <Route index element={<Dashboard list={list} />} />
        <Route path="shipments" element={page('shipments', <Shipments list={list} base="/admin" />)} />
        <Route path="allocation" element={page('allocation', <AllocationQueue user={user} list={list} refresh={refresh} />)} />
        <Route path="tracking-desk" element={page('tracking-desk', <TrackingDesk user={user} list={list} refresh={refresh} />)} />
        <Route path="collections" element={page('collections', <CounterCollection user={user} list={list} refresh={refresh} />)} />
        <Route path="ledger" element={page('ledger', <LedgerPage list={list} />)} />
        <Route path="new-booking" element={page('new-booking', <><H t="New booking" s="Counter booking — same engine as the customer website" /><BookingWizard staff={user} onBooked={refresh} /></>)} />
        <Route path="customers" element={page('customers', d(<Simple t="Customers" rows={demo.customers.map((c) => ({ ...c, shipments: all.filter((s) => s.customerId === c.id).length, branch: branchName(c.branchId) }))} columns={[{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Mobile (masked)' }, { key: 'city', label: 'City' }, { key: 'branch', label: 'Branch' }, { key: 'shipments', label: 'Shipments' }]} />))} />
        <Route path="partners" element={page('partners', d(<Partners />))} />
        <Route path="rate-cards" element={page('rate-cards', d(<RateCards />))} />
        <Route path="serviceability" element={page('serviceability', d(<Serviceability />))} />
        <Route path="staff" element={page('staff', LIVE ? <StaffPage user={user} /> : <Simple t="Staff management" s="Role-based access: Super Admin, Admin (operations), Counter Staff, Accountant" rows={DEMO_LOGINS.map((u) => ({ ...u, branch: u.branchId ? branchName(u.branchId) : 'All' }))} columns={[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'branch', label: 'Branch scope' }]} />)} />
        <Route path="payments" element={page('payments', <Finance list={list} kind="payments" />)} />
        <Route path="invoices" element={page('invoices', LIVE ? <InvoicesPage /> : d(<Finance list={list} kind="invoices" />))} />
        <Route path="reports" element={page('reports', d(<Reports list={list} />))} />
        <Route path="notifications" element={page('notifications', d(<Notifications />))} />
        <Route path="settings" element={page('settings', LIVE ? <CompanySettingsPage user={user} /> : d(<SettingsPage />))} />
        <Route path="audit" element={page('audit', <AuditPage />)} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}

function Reports({ list }: { list: DemoShipment[] }) {
  const d = useDashboardData(list);
  return (
    <>
      <H t="Reports" s="Revenue, partner payable and margin (sample figures)" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue (incl. GST)" value={inr(Math.round(d.revenue))} /><Kpi label="GST collected" value={inr(Math.round(d.revenue - d.revenue / 1.18))} />
        <Kpi label="Partner payable" value={inr(Math.round(d.payable))} /><Kpi label="Gross profit" value={inr(Math.round(d.profit))} />
      </div>
      <DashboardCharts d={d} />
    </>
  );
}
