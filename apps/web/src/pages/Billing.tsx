/** Live billing pages: invoices and company GST settings. */
import { useState } from 'react';
import { CheckCircle2, FileText } from 'lucide-react';
import { DataTable, Kpi, fmtDate, inr } from '../components/ui';
import { openInvoice, type InvoiceDoc } from '../components/invoice';
import { call } from '../lib/api';
import { useLoad } from '../data/source';
import type { DemoUser } from '../demo/store';
import { PageHead } from './Operations';

type Invoice = Omit<InvoiceDoc, 'company'>;
interface Company { legalName: string; gstin: string | null; address: string | null; stateCode: string | null }

const Err = ({ text }: { text: string }) => <p className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{text}</p>;
const Note = ({ ok, text }: { ok: boolean; text: string }) => <p className={`mt-3 rounded-lg p-2 text-sm ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{text}</p>;
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const istDay = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- invoices

export function InvoicesPage() {
  const { value, error } = useLoad(() => call<{ rows: Invoice[] }>('/invoices?pageSize=200').then((r) => r.rows), [], [] as Invoice[]);
  const company = useLoad(() => call<Company>('/settings/company'), [], null as Company | null);
  const [blocked, setBlocked] = useState(false);
  const open = async (inv: Invoice) => {
    const full = await call<InvoiceDoc>(`/invoices/${encodeURIComponent(inv.number)}`);
    setBlocked(!openInvoice(full));
  };
  return (
    <>
      <PageHead t="Invoices" s="One invoice per booking, numbered company-wide per financial year without gaps. Issued invoices are never edited." />
      {error && <Err text={error} />}
      {company.value && !company.value.gstin && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No company GSTIN is configured, so invoices are marked <b>“Not a valid tax invoice”</b>. A Super Admin can add it in Settings → Company &amp; GST.</p>}
      {blocked && <Err text="Your browser blocked the pop-up. Allow pop-ups for this site and try again." />}
      <DataTable title="Invoices" rows={value} pageSize={12}
        filters={[{ label: 'branches', options: [...new Set(value.map((i) => i.branchId))], get: (i) => i.branchId }]}
        columns={[
          { key: 'number', label: 'Invoice #', render: (i) => <span className="font-mono">{i.number}</span> },
          { key: 'issuedAt', label: 'Date', render: (i) => fmtDate(i.issuedAt), value: (i) => i.issuedAt },
          { key: 'trackingNumber', label: 'Shipment', render: (i) => <span className="font-mono">{i.trackingNumber}</span> },
          { key: 'branchId', label: 'Branch' },
          { key: 'taxable', label: 'Taxable', render: (i) => inr(i.taxable), value: (i) => i.taxable },
          { key: 'gst', label: 'GST', render: (i) => inr(i.cgst + i.sgst + i.igst), value: (i) => i.cgst + i.sgst + i.igst },
          { key: 'total', label: 'Total', render: (i) => inr(i.total), value: (i) => i.total },
          { key: 'isTaxInvoice', label: 'Type', value: (i) => (i.isTaxInvoice ? 'Tax invoice' : 'Not a tax invoice') },
          { key: 'open', label: '', render: (i) => <button className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline" onClick={() => open(i)}><FileText className="h-3.5 w-3.5" />View / print</button> },
        ]} />
    </>
  );
}

// ---------------------------------------------------------------- company & GST

export function CompanySettingsPage({ user }: { user: DemoUser }) {
  const canEdit = user.role === 'SUPER_ADMIN';
  const { value, error } = useLoad(() => call<Company>('/settings/company'), [], null as Company | null);
  const [form, setForm] = useState<Company | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const f = form ?? value;
  if (error) return <><PageHead t="Company & GST" /><Err text={error} /></>;
  if (!f) return <PageHead t="Company & GST" s="Loading…" />;
  const set = (k: keyof Company, v: string) => setForm({ ...f, [k]: v === '' && k !== 'legalName' ? null : v });
  const save = async () => {
    setMsg(null);
    try { setForm(await call<Company>('/settings/company', { method: 'PUT', body: JSON.stringify(f) })); setMsg({ ok: true, text: 'Saved. New invoices use these details; issued invoices are not changed.' }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <>
      <PageHead t="Company & GST" s="Seller details printed on invoices. Invoices are tax invoices only once a GSTIN is set." />
      <div className="card max-w-xl p-5">
        <div className="space-y-3">
          <label className="block"><span className="label">Legal name</span><input className="input" disabled={!canEdit} value={f.legalName} onChange={(e) => set('legalName', e.target.value)} /></label>
          <label className="block"><span className="label">GSTIN</span><input className="input font-mono uppercase" disabled={!canEdit} placeholder="Not registered" value={f.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></label>
          <label className="block"><span className="label">GST state code</span><input className="input" disabled={!canEdit} placeholder="e.g. 27 (Maharashtra)" value={f.stateCode ?? ''} onChange={(e) => set('stateCode', e.target.value)} /></label>
          <label className="block"><span className="label">Registered address</span><textarea className="input" rows={3} disabled={!canEdit} value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
          {canEdit ? <button className="btn-primary w-full" onClick={save}>Save company details</button> : <p className="text-xs text-navy-400">Only a Super Admin can change these details.</p>}
          {msg && <Note ok={msg.ok} text={msg.text} />}
        </div>
      </div>
    </>
  );
}
