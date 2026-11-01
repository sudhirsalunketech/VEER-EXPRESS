import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, FileText, Search } from 'lucide-react';
import { STATUS_LABEL, type UnifiedStatus } from '@veer/core';

export const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Logo({ light = false, to = '/' }: { light?: boolean; to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
        <rect width="34" height="34" rx="9" fill={light ? '#fff' : '#0f2149'} />
        <path d="M8 10h5l4 10 4-10h5l-7 15h-4z" fill="#f26a12" />
      </svg>
      <span className={`font-display text-lg font-extrabold leading-none ${light ? 'text-white' : 'text-navy-900'}`}>
        VEER <span className="text-brand-500">EXPRESS</span>
        <span className={`block text-[9px] font-semibold tracking-[.35em] ${light ? 'text-navy-100' : 'text-navy-400'}`}>COURIER</span>
      </span>
    </Link>
  );
}

const STATUS_STYLE: Record<UnifiedStatus, string> = {
  BOOKED: 'bg-navy-50 text-navy-700',
  PICKED_UP: 'bg-sky-50 text-sky-700',
  IN_TRANSIT: 'bg-indigo-50 text-indigo-700',
  ARRIVED_AT_DESTINATION_HUB: 'bg-violet-50 text-violet-700',
  OUT_FOR_DELIVERY: 'bg-brand-50 text-brand-700',
  DELIVERED: 'bg-emerald-50 text-emerald-700',
  EXCEPTION: 'bg-rose-50 text-rose-700',
};
export function StatusBadge({ status }: { status: UnifiedStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function DemoBanner({ children, forceDemo = false }: { children?: ReactNode; forceDemo?: boolean }) {
  if (!forceDemo && import.meta.env.VITE_APP_MODE === 'live') return (
    <div className="no-print bg-navy-50 px-4 py-1.5 text-center text-xs font-medium text-navy-700">
      Connected to the Veer Express server. Courier, payment-gateway and messaging integrations are not connected yet.
    </div>
  );
  return (
    <div className="no-print bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
      DEMO MODE — sample data only. No real bookings, payments or notifications are made. {children}
    </div>
  );
}

export function Kpi({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-navy-400">{label}{icon}</div>
      <div className="mt-2 font-display text-2xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-xs text-navy-400">{hint}</div>}
    </div>
  );
}

export function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-navy-400">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- DataTable

export interface Column<T> { key: string; label: string; render?: (row: T) => ReactNode; value?: (row: T) => string | number }

function toCsv<T>(rows: T[], cols: Column<T>[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const val = (r: T, c: Column<T>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  return [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(val(r, c))).join(','))].join('\n');
}

/** Opens a print-ready view; user saves as PDF via the browser's print dialog. */
function printTable<T>(title: string, rows: T[], cols: Column<T>[]) {
  const w = window.open('', '_blank');
  if (!w) return;
  const val = (r: T, c: Column<T>) => String((c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) ?? '');
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  w.document.write(`<title>${esc(title)}</title><style>body{font:12px Inter,sans-serif;color:#0a1733;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6deee;padding:6px;text-align:left}th{background:#eef2f9}h1{font-size:18px}</style>
  <h1>Veer Express Courier — ${esc(title)}</h1><p>DEMO DATA — sample figures. Generated ${new Date().toLocaleString('en-IN')}</p>
  <table><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(val(r, c))}</td>`).join('')}</tr>`).join('')}</table>`);
  w.document.close();
  w.focus();
  w.print();
}

export function DataTable<T>({ title, rows, columns, filters, pageSize = 8, onRow }: {
  title: string; rows: T[]; columns: Column<T>[]; pageSize?: number; onRow?: (r: T) => void;
  filters?: { label: string; options: string[]; get: (r: T) => string }[];
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Record<string, string>>({});
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      (!needle || JSON.stringify(r).toLowerCase().includes(needle)) &&
      (filters ?? []).every((f) => !sel[f.label] || f.get(r) === sel[f.label]));
  }, [rows, q, sel, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const p = Math.min(page, pages - 1);
  const view = filtered.slice(p * pageSize, p * pageSize + pageSize);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered, columns)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}-demo.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-navy-200" />
          <input className="input pl-9" placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        {filters?.map((f) => (
          <select key={f.label} className="input w-auto" value={sel[f.label] ?? ''} onChange={(e) => { setSel({ ...sel, [f.label]: e.target.value }); setPage(0); }}>
            <option value="">All {f.label}</option>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        <button className="btn-ghost" onClick={exportCsv}><Download className="h-4 w-4" />CSV</button>
        <button className="btn-ghost" onClick={() => printTable(title, filtered, columns)}><FileText className="h-4 w-4" />PDF</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-navy-400">
            <tr>{columns.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-3 font-semibold">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {view.map((r, i) => (
              <tr key={i} onClick={() => onRow?.(r)} className={`border-t border-navy-50 ${onRow ? 'cursor-pointer hover:bg-brand-50/40' : ''}`}>
                {columns.map((c) => <td key={c.key} className="whitespace-nowrap px-4 py-3">{c.render ? c.render(r) : String((c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) ?? '')}</td>)}
              </tr>
            ))}
            {view.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-navy-400">No matching records</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-navy-100 px-4 py-2 text-xs text-navy-400">
        <span>{filtered.length} records · demo data</span>
        <div className="flex items-center gap-2">
          <button className="rounded p-1 hover:bg-navy-50 disabled:opacity-30" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
          <span>Page {p + 1} / {pages}</span>
          <button className="rounded p-1 hover:bg-navy-50 disabled:opacity-30" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
