/**
 * Seeds DEMO data into PostgreSQL. Every row is flagged is_demo = true.
 * Usage: DATABASE_URL=... npx tsx scripts/seed.ts   (refuses to run when APP_MODE=production)
 * Requires migrations 0001 and 0002. Run on an empty database.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import {
  DEMO_AGGREGATOR, DEMO_BRANCHES, DEMO_CUSTOMERS, DEMO_PRICING, DEMO_RATE_CARDS, DEMO_SHIPMENTS, DEMO_STAFF, ledgerFor, resolveZone,
} from '../../../packages/core/src/index';
import { DEFAULT_STATUS_MAP } from '../src/modules/couriers/courier-registry';

const ROLES: [string, string, boolean][] = [
  ['SUPER_ADMIN', 'Super Admin', true], ['ADMIN', 'Admin', true], ['ACCOUNTANT', 'Accountant', true],
  ['BOOKING_STAFF', 'Counter Staff', false], ['CUSTOMER', 'Customer', false],
];
const PERMS: [string, string, string[]][] = [
  ['shipments.read', 'View shipments (scoped)', ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BOOKING_STAFF']],
  ['shipments.create', 'Book shipments', ['SUPER_ADMIN', 'ADMIN', 'BOOKING_STAFF']],
  ['partners.cost.read', 'See partner name, AWB, cost, margin', ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']],
  ['partners.manage', 'Configure courier partners & credentials', ['SUPER_ADMIN']],
  ['rates.manage', 'Edit rate cards & pricing', ['SUPER_ADMIN', 'ADMIN']],
  ['finance.manage', 'Payments, invoices, ledger', ['SUPER_ADMIN', 'ACCOUNTANT']],
  ['users.manage', 'Manage staff', ['SUPER_ADMIN', 'ADMIN']],
];

async function main() {
  if (process.env.APP_MODE === 'production') throw new Error('Refusing to seed demo data in production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = new Client({ connectionString: url });
  await db.connect();
  const q = (sql: string, args: unknown[] = []) => db.query(sql, args);
  await q('begin');
  try {
    for (const [id, name, g] of ROLES) await q('insert into roles (id, name, is_global) values ($1,$2,$3) on conflict (id) do nothing', [id, name, g]);
    for (const [id, d, roles] of PERMS) {
      await q('insert into permissions (id, description) values ($1,$2) on conflict (id) do nothing', [id, d]);
      for (const r of roles) await q('insert into role_permissions values ($1,$2) on conflict do nothing', [r, id]);
    }
    await q(`insert into pricing_settings (id, markup_flat, markup_pct, insurance_pct, insurance_min, gst_pct, allocation_rules)
             values (1,$1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [DEMO_PRICING.markupFlat, DEMO_PRICING.markupPct, DEMO_PRICING.insurancePct, DEMO_PRICING.insuranceMin, DEMO_PRICING.gstPct, JSON.stringify([{ zone: 'SPECIAL', preferPartner: 'DTDC' }])]);

    const branch: Record<string, string> = {};
    for (const b of DEMO_BRANCHES) { // single company-owned branch (Kamothe)
      branch[b.id] = (await q('insert into branches (code, name, city, pin, address, is_demo) values ($1,$2,$3,$4,$5,true) returning id', [b.id, b.name, b.city, b.pin, b.address])).rows[0].id;
    }

    const hash = bcrypt.hashSync('Demo@123', 10);
    const users = [...DEMO_STAFF, { id: 'U7', name: 'Demo Operations Executive', role: 'ADMIN', branchId: null, email: 'ops@demo.veer' }];
    for (const u of users) await q('insert into users (email, name, password_hash, role_id, branch_id, is_demo) values ($1,$2,$3,$4,$5,true)', [u.email, u.name, hash, u.role, u.branchId ? branch[u.branchId] : null]);

    const partner: Record<string, string> = {};
    for (const c of DEMO_RATE_CARDS) {
      partner[c.partnerCode] = (await q(`insert into courier_partners (code, name, adapter, environment, is_enabled, priority, volumetric_divisor, fuel_surcharge_pct, remote_area_surcharge, status_map, is_demo)
        values ($1,$2,'MockCourierProvider','TEST',$3,$4,$5,$6,$7,$8,true) returning id`,
        [c.partnerCode, c.partnerName, c.enabled, c.priority, c.volumetricDivisor, c.fuelSurchargePct, c.remoteAreaSurcharge, JSON.stringify(DEFAULT_STATUS_MAP)])).rows[0].id;
      for (const s of c.slabs) {
        await q(`insert into courier_rate_cards (partner_id, zone, service, base_weight_kg, base_price, step_kg, additional_price, min_charge, tat_days, is_demo)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`, [partner[c.partnerCode], s.zone, s.service, s.baseWeightKg, s.basePrice, s.stepKg, s.additionalPrice, s.minCharge, s.tatDays]);
      }
      for (const p of c.nonServiceablePrefixes) await q('insert into courier_serviceability (partner_id, pin_prefix, is_serviceable) values ($1,$2,false)', [partner[c.partnerCode], p]);
    }

    const customer: Record<string, string> = {};
    for (const c of DEMO_CUSTOMERS) customer[c.id] = (await q('insert into customers (code, name, phone, branch_id, is_demo) values ($1,$2,$3,$4,true) returning id', [c.id, c.name, c.phone, branch[c.branchId]])).rows[0].id;
    // sample branch address book (migration 0005)
    const DEMO_PIN: Record<string, string> = { Kamothe: '410209', Kharghar: '410210', Panvel: '410206', Vashi: '400703', Nerul: '400706' };
    for (const [i, c] of DEMO_CUSTOMERS.entries()) {
      await q('insert into contacts (branch_id, name, phone, address, pin, use_count) values ($1,$2,$3,$4,$5,$6)',
        [branch[c.branchId], c.name, `98000000${c.id.slice(-2)}`, `Demo address ${i + 1}, ${c.city}`, DEMO_PIN[c.city] ?? '410209', 10 - i]);
    }

    // migration 0002 must be applied: aggregator model, allocation history, receipts, ledger
    const has0002 = (await q(`select to_regclass('public.shipment_allocations') is not null as ok`)).rows[0].ok;
    if (!has0002) throw new Error('Apply supabase/migrations/20261101000002_aggregator_manual_ops.sql before seeding');
    const has0003 = (await q(`select to_regclass('public.company_settings') is not null as ok`)).rows[0].ok;
    if (!has0003) throw new Error('Apply supabase/migrations/20261102000003_invoices_settlements.sql before seeding');
    const has0005 = (await q(`select to_regclass('public.contacts') is not null as ok`)).rows[0].ok;
    if (!has0005) throw new Error('Apply all migrations in supabase/migrations (through 20261104000005_contacts_email.sql) before seeding');
    const aggregatorId = (await q(`insert into aggregators (code, name, mode, is_demo) values ('DEMO_AGG', $1, 'MANUAL', true) returning id`, [DEMO_AGGREGATOR])).rows[0].id;
    const opsUser = (await q(`select id from users where email = 'ops@demo.veer'`)).rows[0].id;

    const PAY_MODE: Record<string, string> = { UPI_GATEWAY: 'UPI', ONLINE_GATEWAY: 'ONLINE', CASH: 'CASH', COUNTER_UPI: 'COUNTER_UPI', COUNTER_CARD: 'COUNTER_CARD', CREDIT_ACCOUNT: 'CREDIT' };
    const ACCOUNT: Record<string, string> = {
      'Customer receivable': 'CUSTOMER_RECEIVABLE', 'Freight revenue': 'FREIGHT_REVENUE', 'GST payable': 'GST_PAYABLE', 'Branch cash': 'BRANCH_CASH',
      'Payment gateway clearing': 'GATEWAY_CLEARING', 'Courier cost': 'COURIER_COST', 'Aggregator payable': 'AGGREGATOR_PAYABLE',
    };
    const receipts: Record<string, number> = {};

    let inv = 1;
    for (const s of DEMO_SHIPMENTS) {
      const gst = Math.round((s.amount - s.amount / 1.18) * 100) / 100;
      const a = s.allocation;
      const sid = (await q(`insert into shipments (tracking_number, branch_id, customer_id, service, zone, status, origin_pin, dest_pin, origin_city, dest_city,
          chargeable_weight_kg, volumetric_weight_kg, freight, gst, total_amount, partner_id, partner_cost, estimated_partner_cost, allocation_mode, estimated_delivery,
          delivered_at, payment_mode, is_demo, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16,$17,'MANUAL',$18,$19,$20,true,$21) returning id`,
        [s.trackingNumber, branch[s.branchId], customer[s.customerId], s.service, resolveZone(s.originPin, s.destPin), s.status, s.originPin, s.destPin, s.origin, s.destination,
         s.weightKg, s.amount - gst, gst, s.amount, a ? partner[s.partnerCode] : null, a?.partnerCost ?? null, s.estimatedPartnerCost, s.eta,
         s.status === 'DELIVERED' ? s.events.at(-1)!.at : null, s.paymentMode, s.bookedAt])).rows[0].id;
      await q(`insert into shipment_addresses (shipment_id, kind, name, phone, address, pin) values ($1,'SENDER','Demo Sender','9800000011','Demo address',$2),($1,'RECEIVER','Demo Receiver','9800000022','Demo address',$3)`, [sid, s.originPin, s.destPin]);
      await q(`insert into shipment_packages (shipment_id, kind, package_type, actual_weight_kg, length_cm, width_cm, height_cm) values ($1,'PARCEL','Box',$2,20,20,10)`, [sid, s.weightKg]);

      if (a) {
        await q(`insert into shipment_allocations (shipment_id, aggregator_id, aggregator_ref, courier_name, partner_id, awb, partner_cost, allocated_by, allocated_at)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [sid, aggregatorId, a.aggregatorRef, a.courierName, partner[s.partnerCode], a.awb, a.partnerCost, opsUser, a.allocatedAt]);
      }
      for (const e of s.events) {
        await q(`insert into shipment_tracking_events (shipment_id, status, location, note, occurred_at, source, recorded_at, recorded_by, verified)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [sid, e.status, e.location, e.note, e.at, e.source, e.recordedAt, e.source === 'MANUAL' ? opsUser : null, e.source === 'MANUAL']);
      }

      const paymentIds: Record<string, string> = {};
      for (const p of s.payments) {
        if (p.receiptNo) receipts[s.branchId] = Math.max(receipts[s.branchId] ?? 0, Number(p.receiptNo.slice(-6)));
        paymentIds[p.id] = (await q(`insert into payments (shipment_id, branch_id, mode, amount, status, gateway, gateway_payment_id, receipt_no, reference, collected_by, is_demo, created_at)
                 values ($1,$2,$3,$4,'SIMULATED',$5,$6,$7,$8,$9,true,$10) returning id`,
          [sid, branch[s.branchId], PAY_MODE[p.method], p.amount, p.method.endsWith('GATEWAY') ? 'SIMULATED' : null, p.method.endsWith('GATEWAY') ? p.reference : null,
           p.receiptNo, p.method.endsWith('GATEWAY') ? null : p.reference, p.method.endsWith('GATEWAY') ? null : opsUser, p.at])).rows[0].id;
      }
      if (s.payments.length === 0) {
        await q(`insert into payments (shipment_id, branch_id, mode, amount, status, is_demo, created_at) values ($1,$2,$3,$4,'PENDING',true,$5)`,
          [sid, branch[s.branchId], s.paymentMode, s.amount, s.bookedAt]);
      }

      // ledger: one balanced journal per business event (booking, each payment, allocation)
      const journals = new Map<string, ReturnType<typeof ledgerFor>>();
      for (const e of ledgerFor(s)) {
        const k = `${e.at}|${e.memo}`;
        journals.set(k, [...(journals.get(k) ?? []), e]);
      }
      for (const lines of journals.values()) {
        const jid = randomUUID();
        const payment = s.payments.find((p) => lines[0].memo.includes(p.receiptNo ?? p.reference ?? p.id));
        for (const e of lines) {
          await q(`insert into ledger_entries (journal_id, posted_at, account, debit, credit, branch_id, shipment_id, payment_id, memo, created_by, is_demo)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
            [jid, e.at, ACCOUNT[e.account], e.debit, e.credit, branch[s.branchId], sid, payment ? paymentIds[payment.id] : null, e.memo, opsUser]);
        }
      }

      const half = Math.round(gst / 2 * 100) / 100;
      await q(`insert into invoices (invoice_number, branch_id, customer_id, shipment_id, taxable_value, cgst, sgst, total, issued_at, is_demo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
        [`DEMO/26-27/${String(inv++).padStart(5, '0')}`, branch[s.branchId], customer[s.customerId], sid, s.amount - gst, half, gst - half, s.amount, s.bookedAt]);
    }
    for (const [code, seq] of Object.entries(receipts)) {
      await q('insert into branch_receipt_counters (branch_id, last_seq) values ($1,$2)', [branch[code], seq]);
    }
    await q(`insert into audit_logs (action, entity, entity_id, detail) values ('SEED','database','demo','{"note":"Demo data seeded"}')`);
    await q('commit');
    console.log(`Seeded demo data: ${DEMO_RATE_CARDS.length} partners, ${DEMO_BRANCHES.length} branches, ${DEMO_CUSTOMERS.length} customers, ${DEMO_SHIPMENTS.length} shipments, ${users.length} staff.`);
  } catch (e) {
    await q('rollback');
    throw e;
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
