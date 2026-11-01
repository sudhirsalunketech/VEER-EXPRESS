/**
 * Printable consignment note (docket-style receipt) with a Code 128 barcode of the Veer tracking number.
 * Customer-facing: shows only Veer branding and Veer figures — never partner name, AWB, cost or margin.
 */
import type { CustomerQuote } from '@veer/core';
import { BUSINESS } from '../config/business';
import type { DemoShipment, PaymentRecord } from '@veer/core';

// ---------------------------------------------------------------- Code 128 (subset B)

/** Bar/space module widths for Code 128 values 0–106 (106 = stop). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Returns the Code 128-B symbol values (start, data, checksum, stop). */
export function code128Values(text: string): number[] {
  const data = [...text].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 127) throw new Error(`Character not encodable in Code 128-B: ${ch}`);
    return c - 32;
  });
  const checksum = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, checksum, STOP];
}

/** Inline SVG barcode (with 10-module quiet zones). */
export function code128Svg(text: string, height = 54, moduleWidth = 1.6): string {
  const modules = code128Values(text).map((v) => CODE128_PATTERNS[v]).join('');
  let x = 10;
  let bars = '';
  [...modules].forEach((w, i) => {
    const width = Number(w);
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="${height}"/>`;
    x += width;
  });
  const total = x + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total * moduleWidth}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges" aria-label="Barcode ${text}"><g fill="#000">${bars}</g></svg>`;
}

// ---------------------------------------------------------------- consignment note

export interface ReceiptParty { name: string; phone: string; address: string }
export interface ReceiptData {
  trackingNumber: string;
  bookedAt: Date;
  originPin: string; destPin: string; originCity: string; destCity: string;
  sender: ReceiptParty; receiver: ReceiptParty;
  kind: 'DOCUMENT' | 'PARCEL'; packageType: string; pieces: number;
  actualWeightKg: number; dims: { l: number; w: number; h: number };
  declaredValue: number; insured: boolean;
  quote: CustomerQuote;
  paymentMode: string;
  /** Derived from payment records; independent of shipment status. */
  paid?: boolean;
  branchName?: string;
}

const PAYMENT_LABEL: Record<string, string> = {
  UPI: 'UPI', ONLINE: 'Card / Netbanking', CASH: 'Cash', COUNTER: 'Pay at counter (due)', CREDIT: 'Credit account',
};
const SERVICE_LABEL: Record<string, string> = { EXPRESS: 'Veer Express', STANDARD: 'Veer Standard', SURFACE: 'Veer Surface Cargo' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rs = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const maskPhone = (p: string) => p.replace(/^(\d{2})\d{5}(\d{3})$/, '$1xxxxx$2');

function copyHtml(d: ReceiptData, copy: string, barcode: string): string {
  const q = d.quote;
  const paid = d.paid ?? ['UPI', 'ONLINE', 'CASH'].includes(d.paymentMode);
  const cgst = Math.round((q.gst / 2) * 100) / 100;
  const date = d.bookedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.bookedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const box = (label: string, value: string, cls = '') => `<div class="f ${cls}"><span>${label}</span><b>${value}</b></div>`;
  return `
  <section class="note">
    <div class="demo">DEMO</div>
    <header>
      <div class="brand">
        <svg width="44" height="44" viewBox="0 0 34 34"><rect width="34" height="34" rx="8" fill="#0f2149"/><path d="M8 10h5l4 10 4-10h5l-7 15h-4z" fill="#f26a12"/></svg>
        <div><div class="name">VEER <em>EXPRESS</em> COURIER</div><div class="tag">One Brand. Every Delivery. One Tracking Experience.</div>
        <div class="tag">${esc(d.branchName ?? `Veer Express — ${BUSINESS.addressShort}`)} · Helpline / WhatsApp ${BUSINESS.phoneDisplay}</div></div>
      </div>
      <div class="title"><div>CONSIGNMENT NOTE</div><small>${copy}</small></div>
      <div class="bc">${barcode}<div class="tn">${esc(d.trackingNumber)}</div></div>
    </header>

    <div class="row r4">
      ${box('Origin', `${esc(d.originCity)}<br><small>PIN ${d.originPin}</small>`)}
      ${box('Destination', `${esc(d.destCity)}<br><small>PIN ${d.destPin}</small>`)}
      ${box('Booking date', `${date}<br><small>${time}</small>`)}
      ${box('Service', `${SERVICE_LABEL[q.service] ?? q.service}<br><small>Est. ${q.estimatedDays} day${q.estimatedDays > 1 ? 's' : ''}</small>`)}
    </div>

    <div class="row r2">
      <div class="f party"><span>Consignor (Sender)</span><b>${esc(d.sender.name)}</b><p>${esc(d.sender.address)}<br>PIN ${d.originPin} · Mob ${maskPhone(d.sender.phone)}</p></div>
      <div class="f party"><span>Consignee (Receiver)</span><b>${esc(d.receiver.name)}</b><p>${esc(d.receiver.address)}<br>PIN ${d.destPin} · Mob ${maskPhone(d.receiver.phone)}</p></div>
    </div>

    <div class="row main">
      <div class="grid6">
        ${box('Contents', d.kind === 'DOCUMENT' ? 'Document' : 'Non-document')}
        ${box('Packing', esc(d.packageType))}
        ${box('Pieces', String(d.pieces))}
        ${box('Actual wt', `${d.actualWeightKg} kg`)}
        ${box('Dimensions (cm)', `${d.dims.l} × ${d.dims.w} × ${d.dims.h}`)}
        ${box('Volumetric wt', `${q.volumetricWeightKg} kg`)}
        ${box('Chargeable wt', `${q.chargeableWeightKg} kg`, 'hl')}
        ${box('Declared value', rs(d.declaredValue))}
        ${box('Risk', d.insured ? 'Insured (carrier risk)' : "Owner's risk")}
      </div>
      <table class="charges">
        <tr><th colspan="2">Charges</th></tr>
        <tr><td>Freight</td><td>${rs(q.freight)}</td></tr>
        <tr><td>Insurance</td><td>${rs(q.insurance)}</td></tr>
        <tr><td>CGST 9%</td><td>${rs(cgst)}</td></tr>
        <tr><td>SGST 9%</td><td>${rs(q.gst - cgst)}</td></tr>
        <tr class="tot"><td>Total</td><td>${rs(q.total)}</td></tr>
        <tr><td>Payment</td><td>${PAYMENT_LABEL[d.paymentMode] ?? esc(d.paymentMode)}</td></tr>
        <tr><td colspan="2" class="st ${paid ? 'paid' : 'due'}">${paid ? 'PAID (SIMULATED)' : 'AMOUNT DUE'}</td></tr>
      </table>
    </div>

    <div class="row r3 sig">
      <div class="f"><span>Sender's signature</span><p class="small">I declare the contents are correctly described and contain no prohibited items.</p></div>
      <div class="f"><span>Booked by / branch stamp</span></div>
      <div class="f"><span>Received in good condition — name, signature, date &amp; time</span></div>
    </div>
    <footer>Track at veerexpress.example/track with ${esc(d.trackingNumber)} · Subject to Veer Express terms &amp; conditions · Not a tax invoice.
      <b>DEMO RECEIPT — sample figures; no real payment was received and no shipment was created.</b></footer>
  </section>`;
}

const CSS = `
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11px/1.35 Inter, Arial, sans-serif; color: #0a1733; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #eef2f9; }
.bar button { font: 600 13px Inter, Arial; padding: 8px 16px; border-radius: 8px; border: 0; background: #f26a12; color: #fff; cursor: pointer; }
.bar button.g { background: #fff; color: #0f2149; border: 1px solid #aebddc; }
.wrap { max-width: 194mm; margin: 0 auto; padding: 8px 0; }
.note { position: relative; border: 1.5px solid #0f2149; overflow: hidden; }
.demo { position: absolute; top: 46%; left: 50%; transform: translate(-50%,-50%) rotate(-18deg); font: 800 110px Inter, Arial; color: rgba(242,106,18,.07); pointer-events: none; letter-spacing: 8px; }
header { display: grid; grid-template-columns: 1.5fr .8fr 1.2fr; align-items: center; border-bottom: 1.5px solid #0f2149; }
header > div { padding: 8px 10px; }
.brand { display: flex; gap: 8px; align-items: center; }
.name { font: 800 17px 'Plus Jakarta Sans', Inter, Arial; letter-spacing: .3px; color: #0f2149; }
.name em { font-style: normal; color: #f26a12; }
.tag { font-size: 8.5px; color: #5470a8; }
.title { text-align: center; border-left: 1px solid #0f2149; border-right: 1px solid #0f2149; align-self: stretch; display: flex; flex-direction: column; justify-content: center; background: #0f2149; color: #fff; font-weight: 800; font-size: 12px; letter-spacing: 1px; }
.title small { margin-top: 3px; font-size: 9px; color: #ffb27d; letter-spacing: 2px; }
.bc { text-align: center; }
.bc svg { max-width: 100%; }
.tn { font: 700 15px 'Courier New', monospace; letter-spacing: 3px; margin-top: 2px; }
.row { display: grid; border-bottom: 1px solid #0f2149; }
.r4 { grid-template-columns: repeat(4, 1fr); }
.r2 { grid-template-columns: 1fr 1fr; }
.r3 { grid-template-columns: 1.2fr 1fr 1.2fr; }
.row > .f + .f { border-left: 1px solid #0f2149; }
.f { padding: 5px 8px; min-height: 38px; }
.f span { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: #5470a8; }
.f b { font-size: 11.5px; }
.f small { font-weight: 400; color: #5470a8; }
.f p { margin: 2px 0 0; }
.party { min-height: 64px; }
.main { grid-template-columns: 1.7fr 1fr; }
.grid6 { display: grid; grid-template-columns: repeat(3, 1fr); }
.grid6 .f { border-right: 1px solid #d6deee; border-bottom: 1px solid #d6deee; }
.grid6 .f:nth-child(3n) { border-right: 0; }
.grid6 .f:nth-last-child(-n+3) { border-bottom: 0; }
.hl { background: #fff4ec; }
.hl b { color: #b34806; }
.charges { width: 100%; border-collapse: collapse; border-left: 1px solid #0f2149; }
.charges th { background: #eef2f9; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .6px; color: #5470a8; padding: 4px 8px; }
.charges td { padding: 2.5px 8px; }
.charges td:last-child { text-align: right; font-weight: 600; }
.charges .tot td { border-top: 1px solid #0f2149; font-size: 13px; font-weight: 800; }
.st { text-align: center !important; font-weight: 800 !important; letter-spacing: 1px; }
.paid { color: #047857; } .due { color: #b91c1c; }
.sig .f { min-height: 54px; }
.small { font-size: 8px; color: #5470a8; }
footer { padding: 5px 8px; font-size: 8.5px; color: #5470a8; }
footer b { display: block; color: #92400e; }
.cut { margin: 10px 0; border-top: 1.5px dashed #5470a8; text-align: center; height: 0; }
.cut span { position: relative; top: -8px; background: #fff; padding: 0 8px; font-size: 9px; color: #5470a8; }
@media print { .bar { display: none; } .wrap { padding: 0; } }
`;

/** Opens the consignment note in a new tab with Print / Save-as-PDF controls. */
/** The consignment note as a complete HTML document (sender copy + branch copy). */
export function consignmentNoteHtml(d: ReceiptData, withBar = true) {
  const barcode = code128Svg(d.trackingNumber);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Consignment note ${esc(d.trackingNumber)}</title><style>${CSS}</style></head><body>
    ${withBar ? '<div class="bar"><button onclick="print()">Print / Save as PDF</button><button class="g" onclick="close()">Close</button></div>' : ''}
    <div class="wrap">${copyHtml(d, 'SENDER COPY', barcode)}<div class="cut"><span>✂ cut here</span></div>${copyHtml(d, 'BRANCH COPY', barcode)}</div>
  </body></html>`;
}

/** Opens the consignment note in a new tab with Print / Save-as-PDF controls. */
export function openConsignmentNote(d: ReceiptData) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(consignmentNoteHtml(d));
  w.document.close();
  return true;
}

// ---------------------------------------------------------------- counter payment receipt

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash', COUNTER_UPI: 'UPI at counter', COUNTER_CARD: 'Card at counter', UPI_GATEWAY: 'UPI (online)', ONLINE_GATEWAY: 'Card / Netbanking (online)',
};

/** Payment receipt for a counter collection. Opens in a new tab with Print / Save-as-PDF. */
export function openPaymentReceipt({ shipment: s, payment: p, branchName }: { shipment: DemoShipment; payment: PaymentRecord; branchName: string }) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const paidSoFar = s.payments.filter((x) => x.at <= p.at).reduce((a, x) => a + x.amount, 0);
  const balance = Math.max(0, Math.round((s.amount - paidSoFar) * 100) / 100);
  const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${v}</td></tr>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payment receipt ${esc(p.receiptNo ?? p.id)}</title><style>${CSS}
    .pr { max-width: 120mm; margin: 0 auto; } .pr table { width: 100%; border-collapse: collapse; } .pr td { padding: 5px 10px; border-top: 1px solid #d6deee; } .pr td:last-child { text-align: right; font-weight: 600; }
    .pr .big td { font-size: 15px; font-weight: 800; border-top: 1.5px solid #0f2149; }</style></head><body>
    <div class="bar"><button onclick="print()">Print / Save as PDF</button><button class="g" onclick="close()">Close</button></div>
    <div class="wrap"><section class="note pr"><div class="demo">DEMO</div>
      <header style="grid-template-columns:1.4fr 1fr"><div class="brand"><svg width="40" height="40" viewBox="0 0 34 34"><rect width="34" height="34" rx="8" fill="#0f2149"/><path d="M8 10h5l4 10 4-10h5l-7 15h-4z" fill="#f26a12"/></svg>
        <div><div class="name">VEER <em>EXPRESS</em></div><div class="tag">${esc(branchName)}</div><div class="tag">${BUSINESS.phoneDisplay}</div></div></div>
        <div class="title"><div>PAYMENT RECEIPT</div><small>${esc(p.receiptNo ?? p.id)}</small></div></header>
      <table>
        ${row('Date', new Date(p.at).toLocaleString('en-IN'))}
        ${row('Veer tracking number', `<span style="font-family:Courier New,monospace">${esc(s.trackingNumber)}</span>`)}
        ${row('Route', `${esc(s.origin)} → ${esc(s.destination)}`)}
        ${row('Payment method', METHOD_LABEL[p.method] ?? esc(p.method))}
        ${p.reference ? row('Reference', esc(p.reference)) : ''}
        ${row('Shipment charge', rs(s.amount))}
        ${row('Amount received', rs(p.amount), 'big')}
        ${row('Balance due', rs(balance))}
        ${row('Received by', esc(p.collectedBy))}
      </table>
      <footer>Payment status is independent of delivery status. Keep this receipt for your records.
        <b>DEMO RECEIPT — simulated collection; no real money was received.</b></footer>
    </section></div></body></html>`);
  w.document.close();
  return true;
}
