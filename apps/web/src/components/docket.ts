/**
 * Download, print and share for the consignment note. The PDF is made in the browser from the same
 * HTML as the printed docket; the PDF libraries load only when a PDF is actually needed.
 */
import { consignmentNoteHtml, type ReceiptData } from './receipt';

const fileName = (d: ReceiptData) => `VeerExpress-${d.trackingNumber}.pdf`;

/** Renders the docket in a hidden frame (same-origin, no scripts) and resolves with the frame's document. */
function renderHidden(html: string): Promise<{ doc: Document; done: () => void }> {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:1400px;border:0;visibility:hidden';
    document.body.appendChild(f);
    const done = () => f.remove();
    f.onload = async () => {
      const doc = f.contentDocument;
      if (!doc) { done(); return reject(new Error('Could not prepare the document')); }
      await doc.fonts?.ready;
      resolve({ doc, done });
    };
    f.srcdoc = html;
  });
}

/** Builds the consignment note PDF (A4, both copies on one page). */
export async function docketPdf(d: ReceiptData): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  // pin the docket to the frame's top-left: the capture assumes the element starts at (0, 0)
  const html = consignmentNoteHtml(d, false).replace('</head>', '<style>html,body{margin:0!important;padding:0!important;background:#fff}.wrap{margin:0!important;display:inline-block;padding:6px!important}</style></head>');
  const { doc, done } = await renderHidden(html);
  try {
    const el = doc.querySelector('.wrap') as HTMLElement;
    // foreignObject rendering uses the browser's own layout, so text spacing and the barcode match the printed docket
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false, foreignObjectRendering: true });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageW = 210, pageH = 297, margin = 8;
    let w = pageW - margin * 2, h = (canvas.height * w) / canvas.width;
    if (h > pageH - margin * 2) { h = pageH - margin * 2; w = (canvas.width * h) / canvas.height; }
    // JPEG keeps the file small enough to share on WhatsApp; 2x scale keeps the barcode scannable
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', (pageW - w) / 2, margin, w, h, undefined, 'FAST');
    pdf.setProperties({ title: `Consignment note ${d.trackingNumber}`, author: 'Veer Express Courier' });
    return pdf.output('blob');
  } finally { done(); }
}

/** Saves the PDF to the device. */
export async function downloadDocket(d: ReceiptData, pdf?: Blob) {
  const blob = pdf ?? (await docketPdf(d));
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName(d) });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return blob;
}

/** Prints the docket without opening a new tab (works where pop-ups are blocked). */
export async function printDocket(d: ReceiptData) {
  const { doc, done } = await renderHidden(consignmentNoteHtml(d, false));
  const win = doc.defaultView!;
  win.addEventListener('afterprint', () => setTimeout(done, 100));
  win.focus(); win.print();
  setTimeout(done, 60_000); // safety net if afterprint never fires
}

export type ShareResult = 'shared-file' | 'shared-link' | 'cancelled' | 'unsupported';

/** Shares the PDF where the device supports it (most phones), otherwise the tracking link. */
export async function shareDocket(d: ReceiptData, trackUrl: string, pdf?: Blob): Promise<ShareResult> {
  const text = `Veer Express shipment ${d.trackingNumber} — ${d.originCity} to ${d.destCity}. Track: ${trackUrl}`;
  try {
    if (navigator.canShare) {
      const file = new File([pdf ?? (await docketPdf(d))], fileName(d), { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Consignment note ${d.trackingNumber}`, text }); return 'shared-file'; }
    }
    if (navigator.share) { await navigator.share({ title: `Veer Express ${d.trackingNumber}`, text, url: trackUrl }); return 'shared-link'; }
    return 'unsupported';
  } catch (e) {
    return (e as Error).name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/** WhatsApp share link (text + tracking link; WhatsApp links cannot attach files). */
export const whatsappShareUrl = (d: ReceiptData, trackUrl: string) =>
  `https://wa.me/?text=${encodeURIComponent(`Veer Express shipment ${d.trackingNumber} (${d.originCity} → ${d.destCity}). Track here: ${trackUrl}`)}`;
