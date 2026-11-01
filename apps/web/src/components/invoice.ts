/** Printable invoice. Shows "NOT A VALID TAX INVOICE" until the company GSTIN is configured. */
import { BUSINESS } from '../config/business';

export interface InvoiceDoc {
  number: string; issuedAt: string; trackingNumber: string | null; branchId: string;
  taxable: number; cgst: number; sgst: number; igst: number; total: number;
  isTaxInvoice: boolean; sellerLegalName: string | null; sellerGstin: string | null; isDemo: boolean;
  customer: { name: string; phone: string; address: string } | null; origin: string | null; destination: string | null;
  company: { legalName: string; address: string | null; stateCode: string | null };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rs = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SAC_COURIER = '996812'; // SAC: courier services

export function invoiceHtml(d: InvoiceDoc): string {
  const title = d.isTaxInvoice ? 'TAX INVOICE' : 'INVOICE';
  const half = d.taxable ? (d.cgst / d.taxable) * 100 : 9;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${esc(d.number)}</title><style>
  *{box-sizing:border-box}body{font:13px/1.45 system-ui,sans-serif;color:#0f2149;margin:0;padding:24px;background:#fff}
  .doc{max-width:760px;margin:auto;border:1px solid #c9d3e6;padding:24px}
  h1{margin:0;font-size:20px;letter-spacing:.06em}.row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .muted{color:#5470a8}.warn{margin:14px 0;padding:8px 10px;border:2px solid #e11d48;color:#9f1239;font-weight:700;text-align:center}
  .demo{margin:14px 0;padding:6px 10px;background:#fff7ed;color:#9a3412;text-align:center;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #c9d3e6;padding:7px 9px;text-align:left}th{background:#f3f6fb;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  td.n,th.n{text-align:right}.tot td{font-weight:700;background:#f3f6fb}.box{border:1px solid #c9d3e6;padding:10px;flex:1;min-width:220px}
  .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5470a8}footer{margin-top:18px;font-size:11px;color:#5470a8}
  @media print{body{padding:0}.noprint{display:none}}
  </style></head><body><div class="doc">
  <div class="row"><div><h1>${title}</h1><div class="muted">${esc(d.sellerLegalName ?? d.company.legalName)}</div>
    <div>${esc(d.company.address ?? BUSINESS.addressShort)}</div>
    <div>${d.sellerGstin ? `GSTIN <b>${esc(d.sellerGstin)}</b>` : 'GSTIN: not registered in system'}</div></div>
    <div style="text-align:right"><div class="lbl">Invoice no.</div><b style="font-size:16px">${esc(d.number)}</b>
    <div class="lbl" style="margin-top:6px">Date</div>${new Date(d.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
    <div class="lbl" style="margin-top:6px">Branch</div>${esc(d.branchId)}</div></div>
  ${d.isTaxInvoice ? '' : '<div class="warn">NOT A VALID TAX INVOICE — company GSTIN not yet configured</div>'}
  ${d.isDemo ? '<div class="demo">Demo record — no real service or payment</div>' : ''}
  <div class="row" style="margin-top:14px">
    <div class="box"><div class="lbl">Billed to</div>${d.customer ? `<b>${esc(d.customer.name)}</b><br>${esc(d.customer.address)}` : 'Walk-in customer'}</div>
    <div class="box"><div class="lbl">Shipment</div>${d.trackingNumber ? `<b>${esc(d.trackingNumber)}</b><br>` : ''}${esc(d.origin ?? '')} → ${esc(d.destination ?? '')}</div>
  </div>
  <table><thead><tr><th>Description</th><th>SAC</th><th class="n">Taxable value</th><th class="n">CGST</th><th class="n">SGST</th>${d.igst ? '<th class="n">IGST</th>' : ''}<th class="n">Total</th></tr></thead>
  <tbody><tr><td>Courier service${d.trackingNumber ? ` — ${esc(d.trackingNumber)}` : ''}</td><td>${SAC_COURIER}</td><td class="n">${rs(d.taxable)}</td>
    <td class="n">${rs(d.cgst)}<br><small>${half.toFixed(0)}%</small></td><td class="n">${rs(d.sgst)}<br><small>${half.toFixed(0)}%</small></td>${d.igst ? `<td class="n">${rs(d.igst)}</td>` : ''}<td class="n">${rs(d.total)}</td></tr>
  <tr class="tot"><td colspan="${d.igst ? 6 : 5}">Total (incl. GST)</td><td class="n">${rs(d.total)}</td></tr></tbody></table>
  <footer>Computer-generated invoice. Place of supply and tax split assume an intra-state B2C supply (CGST + SGST). Subject to Veer Express terms &amp; conditions.</footer>
  <p class="noprint" style="text-align:center;margin-top:16px"><button onclick="print()">Print</button></p>
  </div></body></html>`;
}

/** Opens the invoice in a new tab. Returns false if the browser blocked the pop-up. */
export function openInvoice(d: InvoiceDoc): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(invoiceHtml(d));
  w.document.close();
  return true;
}
