/**
 * Double-entry journals for each business event. Mirrors `ledgerFor` in @veer/core (used by the demo
 * and the seed), so demo data and live postings follow the same rules. Every journal balances.
 */
import type { ApiPaymentMethod, JournalLine, LedgerAccountCode } from '../../database/repository';

const r2 = (n: number) => Math.round(n * 100) / 100;
const L = (account: LedgerAccountCode, debit: number, credit: number, memo: string): JournalLine => ({ account, debit: r2(debit), credit: r2(credit), memo });

/** Booking: the customer owes the GST-inclusive amount; revenue and GST are recognised. */
export function bookingJournal(amount: number, gstPct = 18): JournalLine[] {
  const taxable = r2(amount / (1 + gstPct / 100));
  return [L('CUSTOMER_RECEIVABLE', amount, 0, 'Shipment booked'), L('FREIGHT_REVENUE', 0, taxable, 'Shipment booked'), L('GST_PAYABLE', 0, r2(amount - taxable), 'Shipment booked')];
}

/** Money received settles the receivable: counter collections into branch cash, gateway payments into clearing. */
export function paymentJournal(method: ApiPaymentMethod, amount: number, ref: string): JournalLine[] {
  const acct: LedgerAccountCode = method === 'ONLINE_GATEWAY' || method === 'UPI_GATEWAY' ? 'GATEWAY_CLEARING' : 'BRANCH_CASH';
  return [L(acct, amount, 0, `Payment ${ref}`), L('CUSTOMER_RECEIVABLE', 0, amount, `Payment ${ref}`)];
}

/** Allocation books the courier cost owed to the aggregator. Re-allocation reverses the previous cost in the same journal. */
export function allocationJournal(next: { courierName: string; awb: string; partnerCost: number }, prev: { courierName: string; awb: string; partnerCost: number } | null): JournalLine[] {
  const out: JournalLine[] = [];
  if (prev) {
    const memo = `Reversal: re-allocated from ${prev.courierName} ${prev.awb}`;
    out.push(L('AGGREGATOR_PAYABLE', prev.partnerCost, 0, memo), L('COURIER_COST', 0, prev.partnerCost, memo));
  }
  const memo = `Allocated ${next.courierName} ${next.awb}`;
  out.push(L('COURIER_COST', next.partnerCost, 0, memo), L('AGGREGATOR_PAYABLE', 0, next.partnerCost, memo));
  return out;
}

/** B2C courier service: GST-inclusive amount split into taxable value and CGST/SGST halves. */
export function invoiceAmounts(total: number, gstPct = 18) {
  const taxable = r2(total / (1 + gstPct / 100));
  const gst = r2(total - taxable);
  const cgst = r2(gst / 2);
  return { taxable, cgst, sgst: r2(gst - cgst), igst: 0, total };
}
