import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { resolveZone, volumetricWeightKg } from '@veer/core';
import {
  AllocationConflictError, DuplicateEmailError,
  type CompanySettings, type InvoiceRecord,
  type ApiPaymentMethod, type AuditQuery, type BranchRecord, type JournalLine, type NewAllocation, type NewCollection, type NewEvent,
  type NewShipment, type NewStaff, type PaymentRec, type Repository, type ShipmentRecord, type StaffRecord, type UserRecord,
} from './repository';

const SHIPMENT_SELECT = `
  select s.id, s.tracking_number, s.created_at, b.code as branch_code, s.customer_id, s.origin_city, s.dest_city,
         s.origin_pin, s.dest_pin, s.status, s.service, s.chargeable_weight_kg, s.total_amount, s.estimated_partner_cost,
         s.estimated_delivery, s.payment_mode, s.is_demo,
         (select i.invoice_number from invoices i where i.shipment_id = s.id) as invoice_number,
         (select json_build_object('aggregatorCode', g.code, 'aggregator', g.name, 'aggregatorRef', a.aggregator_ref, 'courierName', a.courier_name,
                   'partnerCode', cp.code, 'awb', a.awb, 'partnerCost', a.partner_cost, 'allocatedBy', au.name, 'allocatedAt', a.allocated_at)
            from shipment_allocations a join aggregators g on g.id = a.aggregator_id
            left join courier_partners cp on cp.id = a.partner_id left join users au on au.id = a.allocated_by
           where a.shipment_id = s.id and a.superseded_at is null) as allocation,
         coalesce((select json_agg(json_build_object('id', p.id, 'mode', p.mode, 'direction', p.direction, 'amount', p.amount, 'at', p.created_at,
                   'receiptNo', p.receipt_no, 'reference', coalesce(p.reference, p.gateway_payment_id), 'gateway', p.gateway,
                   'collectedBy', pu.name, 'simulated', p.status = 'SIMULATED') order by p.created_at)
            from payments p left join users pu on pu.id = p.collected_by
           where p.shipment_id = s.id and p.status in ('CAPTURED', 'SIMULATED')), '[]') as payments,
         coalesce((select json_agg(json_build_object('status', e.status, 'at', e.occurred_at, 'location', e.location, 'note', e.note,
                   'recordedAt', e.recorded_at, 'recordedBy', eu.name, 'source', e.source) order by e.id)
            from shipment_tracking_events e left join users eu on eu.id = e.recorded_by where e.shipment_id = s.id), '[]') as events
    from shipments s
    join branches b on b.id = s.branch_id`;

const ACTIVE_ALLOCATION = 'exists (select 1 from shipment_allocations a where a.shipment_id = s.id and a.superseded_at is null)';
const METHOD_TO_MODE: Record<ApiPaymentMethod, string> = { UPI_GATEWAY: 'UPI', ONLINE_GATEWAY: 'ONLINE', CASH: 'CASH', COUNTER_UPI: 'COUNTER_UPI', COUNTER_CARD: 'COUNTER_CARD' };
const MODE_TO_METHOD: Record<string, ApiPaymentMethod> = { UPI: 'UPI_GATEWAY', ONLINE: 'ONLINE_GATEWAY', CASH: 'CASH', COUNTER_UPI: 'COUNTER_UPI', COUNTER_CARD: 'COUNTER_CARD' };
const iso = (d: string | Date) => new Date(d).toISOString();

function toPayment(p: Record<string, any>): PaymentRec {
  return {
    id: p.id, method: MODE_TO_METHOD[p.mode] ?? 'CASH', amount: Number(p.amount) * (p.direction === 'REFUND' ? -1 : 1), at: iso(p.at),
    receiptNo: p.receiptNo, reference: p.reference, collectedBy: p.gateway ? 'Payment gateway' : p.collectedBy, simulated: p.simulated,
  };
}

function toRecord(r: Record<string, any>): ShipmentRecord {
  const a = r.allocation;
  return {
    id: r.id, trackingNumber: r.tracking_number, bookedAt: iso(r.created_at), branchId: r.branch_code,
    customerId: r.customer_id, origin: r.origin_city, destination: r.dest_city, originPin: r.origin_pin, destPin: r.dest_pin,
    status: r.status, service: r.service, chargeableWeightKg: Number(r.chargeable_weight_kg), amount: Number(r.total_amount),
    estimatedPartnerCost: r.estimated_partner_cost === null ? null : Number(r.estimated_partner_cost),
    allocation: a ? { ...a, partnerCost: Number(a.partnerCost), allocatedAt: iso(a.allocatedAt) } : null,
    payments: (r.payments as Record<string, any>[]).map(toPayment),
    invoiceNumber: r.invoice_number,
    eta: r.estimated_delivery ? iso(r.estimated_delivery).slice(0, 10) : null,
    paymentMode: r.payment_mode, isDemo: r.is_demo,
    events: (r.events as Record<string, any>[]).map((e) => ({ status: e.status, at: iso(e.at), location: e.location, note: e.note, recordedAt: iso(e.recordedAt), recordedBy: e.recordedBy, source: e.source })),
  };
}

const uuidOrNull = (id: string | null) => (id && /^[0-9a-f-]{36}$/i.test(id) ? id : null);

/** PostgreSQL repository (Supabase). All multi-table writes run in a single transaction. */
export class PgRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  static fromUrl(url: string) {
    return new PgRepository(new Pool({ connectionString: url, max: 10, ssl: url.includes('localhost') || url.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false } }));
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `select u.id, u.email, u.name, u.role_id, b.code as branch_code, u.password_hash, u.is_active
         from users u left join branches b on b.id = u.branch_id
        where lower(u.email) = lower($1) and u.deleted_at is null`, [email]);
    const r = rows[0];
    return r ? { id: r.id, email: r.email, name: r.name, role: r.role_id, branchId: r.branch_code, passwordHash: r.password_hash, active: r.is_active } : null;
  }

  private static readonly STAFF_SELECT = `
    select u.id, u.email, u.name, u.role_id, b.code as branch_code, u.is_active
      from users u left join branches b on b.id = u.branch_id where u.deleted_at is null`;
  private static toStaff(r: Record<string, any>): StaffRecord {
    return { id: r.id, email: r.email, name: r.name, role: r.role_id, branchId: r.branch_code, active: r.is_active };
  }
  async findUserById(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.pool.query(`${PgRepository.STAFF_SELECT} and u.id = $1`, [id]);
    return rows[0] ? PgRepository.toStaff(rows[0]) : null;
  }
  async listStaff(branchId: string | null) {
    const { rows } = await this.pool.query(`${PgRepository.STAFF_SELECT} ${branchId ? 'and b.code = $1' : ''} order by u.name`, branchId ? [branchId] : []);
    return rows.map(PgRepository.toStaff);
  }
  async createStaff(s: NewStaff) {
    try {
      const { rows } = await this.pool.query(
        `insert into users (email, name, password_hash, role_id, branch_id)
         values (lower($1), $2, $3, $4, (select id from branches where code = $5)) returning id`,
        [s.email, s.name, s.passwordHash, s.role, s.branchId]);
      return (await this.findUserById(rows[0].id))!;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new DuplicateEmailError();
      throw e;
    }
  }
  async setStaffActive(id: string, active: boolean) {
    await this.pool.query('update users set is_active = $2 where id = $1', [id, active]);
  }
  async branchExists(code: string) {
    return !!(await this.pool.query('select 1 from branches where code = $1 and deleted_at is null', [code])).rowCount;
  }
  async listAudit({ entity, action, limit, offset }: AuditQuery) {
    const where: string[] = []; const args: unknown[] = [];
    if (entity) { args.push(entity); where.push(`a.entity = $${args.length}`); }
    if (action) { args.push(action); where.push(`a.action = $${args.length}`); }
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const total = (await this.pool.query(`select count(*)::int as n from audit_logs a ${w}`, args)).rows[0].n;
    const { rows } = await this.pool.query(
      `select a.created_at, a.user_id, u.name as user_name, a.action, a.entity, a.entity_id, a.detail
         from audit_logs a left join users u on u.id = a.user_id ${w}
        order by a.created_at desc, a.id desc limit ${Number(limit)} offset ${Number(offset)}`, args);
    return { total, rows: rows.map((r) => ({ at: new Date(r.created_at).toISOString(), userId: r.user_id, userName: r.user_name, action: r.action, entity: r.entity, entityId: r.entity_id, detail: r.detail })) };
  }

  async listShipments({ branchId, status, q, allocated, open, limit, offset }: Parameters<Repository['listShipments']>[0]) {
    const where = ['s.deleted_at is null'];
    if (allocated !== undefined) where.push(allocated ? ACTIVE_ALLOCATION : `not ${ACTIVE_ALLOCATION}`);
    if (open) where.push(`s.status not in ('DELIVERED', 'CANCELLED')`);
    const args: unknown[] = [];
    if (branchId) { args.push(branchId); where.push(`b.code = $${args.length}`); }
    if (status) { args.push(status); where.push(`s.status = $${args.length}`); }
    if (q) { args.push(`%${q}%`); where.push(`(s.tracking_number ilike $${args.length} or s.origin_city ilike $${args.length} or s.dest_city ilike $${args.length})`); }
    const w = `where ${where.join(' and ')}`;
    const total = await this.pool.query(`select count(*)::int as n from shipments s join branches b on b.id = s.branch_id ${w}`, args);
    const { rows } = await this.pool.query(`${SHIPMENT_SELECT} ${w} order by s.created_at desc limit ${Number(limit)} offset ${Number(offset)}`, args);
    return { rows: rows.map(toRecord), total: total.rows[0].n };
  }

  async findShipment(tn: string, branchId: string | null) {
    const args: unknown[] = [tn];
    let extra = '';
    if (branchId) { args.push(branchId); extra = ' and b.code = $2'; }
    const { rows } = await this.pool.query(`${SHIPMENT_SELECT} where s.tracking_number = $1 and s.deleted_at is null${extra}`, args);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByPartnerAwb(code: string, awb: string) {
    const { rows } = await this.pool.query(
      `${SHIPMENT_SELECT} where exists (select 1 from shipment_allocations a join courier_partners cp on cp.id = a.partner_id
                                         where a.shipment_id = s.id and a.superseded_at is null and cp.code = $1 and a.awb = $2)`, [code, awb]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async trackingNumberExists(tn: string) {
    const { rowCount } = await this.pool.query('select 1 from shipments where tracking_number = $1', [tn]);
    return !!rowCount;
  }

  private async byId(id: string) { return toRecord((await this.pool.query(`${SHIPMENT_SELECT} where s.id = $1`, [id])).rows[0]); }

  /** Writes one balanced journal. The deferred trigger re-checks balance at commit. */
  private async postJournal(c: PoolClient, lines: JournalLine[], ref: { branchUuid: string; shipmentId: string; paymentId?: string | null; userId: string | null; isDemo: boolean }) {
    const journalId = randomUUID();
    for (const l of lines) {
      await c.query(`insert into ledger_entries (journal_id, account, debit, credit, branch_id, shipment_id, payment_id, memo, created_by, is_demo)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [journalId, l.account, l.debit, l.credit, ref.branchUuid, ref.shipmentId, ref.paymentId ?? null, l.memo, uuidOrNull(ref.userId), ref.isDemo]);
    }
  }

  async createShipment(n: NewShipment) {
    const id = await this.tx(async (c) => {
      const br = await c.query('select id from branches where code = $1 and deleted_at is null', [n.branchId]);
      if (!br.rowCount) throw new Error('Unknown branch');
      const branchUuid = br.rows[0].id;
      const vol = volumetricWeightKg({ lengthCm: n.package.lengthCm, widthCm: n.package.widthCm, heightCm: n.package.heightCm }, 5000); // courier not known at booking: standard divisor
      const gst = Math.round((n.amount - n.amount / 1.18) * 100) / 100; // amount is GST-inclusive; exact split stored on the invoice
      const s = await c.query(
        `insert into shipments (tracking_number, branch_id, customer_id, created_by, service, zone, status, origin_pin, dest_pin, origin_city, dest_city,
            chargeable_weight_kg, volumetric_weight_kg, freight, insurance_charge, gst, total_amount, estimated_partner_cost,
            allocation_mode, estimated_delivery, payment_mode, is_demo, created_at)
         values ($1,$2,$3,$4,$5,$6,'BOOKED',$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,'MANUAL',$17,$18,$19,$20) returning id`,
        [n.trackingNumber, branchUuid, n.customerId, uuidOrNull(n.createdBy), n.service, resolveZone(n.originPin, n.destPin), n.originPin, n.destPin, n.origin, n.destination,
         n.chargeableWeightKg, vol, n.amount - gst, gst, n.amount, n.estimatedPartnerCost, n.eta, n.paymentMode, n.isDemo, n.bookedAt]);
      const sid = s.rows[0].id;
      for (const [kind, p, pin] of [['SENDER', n.sender, n.originPin], ['RECEIVER', n.receiver, n.destPin]] as const) {
        await c.query('insert into shipment_addresses (shipment_id, kind, name, phone, address, pin, email) values ($1,$2,$3,$4,$5,$6,$7)', [sid, kind, p.name, p.phone, p.address, pin, p.email ?? null]);
        if (n.saveContacts) {
          await c.query(`insert into contacts (branch_id, name, phone, email, address, pin) values ($1,$2,$3,$4,$5,$6)
                         on conflict (branch_id, phone, name) do update set address = excluded.address, pin = excluded.pin,
                           email = coalesce(excluded.email, contacts.email), use_count = contacts.use_count + 1, last_used_at = now()`,
            [branchUuid, p.name, p.phone, p.email ?? null, p.address, pin]);
        }
      }
      const k = n.package;
      await c.query(`insert into shipment_packages (shipment_id, kind, package_type, actual_weight_kg, length_cm, width_cm, height_cm, declared_value, insured)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [sid, k.kind, k.type, k.actualWeightKg, k.lengthCm, k.widthCm, k.heightCm, k.declaredValue, k.insurance]);
      await c.query(`insert into shipment_tracking_events (shipment_id, status, location, note, occurred_at, source, recorded_at) values ($1,'BOOKED',$2,'Shipment booked',$3,'SYSTEM',$3)`, [sid, n.origin, n.bookedAt]);

      let paymentId: string | null = null;
      const p = n.payment;
      if (p) {
        const counter = p.method === 'CASH' || p.method === 'COUNTER_UPI' || p.method === 'COUNTER_CARD';
        const receiptNo = counter ? (await c.query('select next_receipt_no($1) as r', [branchUuid])).rows[0].r : null;
        paymentId = (await c.query(
          `insert into payments (shipment_id, branch_id, mode, amount, status, gateway, gateway_payment_id, receipt_no, reference, collected_by, is_demo, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [sid, branchUuid, METHOD_TO_MODE[p.method], p.amount, p.simulated ? 'SIMULATED' : 'CAPTURED', counter ? null : p.simulated ? 'SIMULATED' : 'RAZORPAY',
           counter ? null : p.gatewayRef, receiptNo, counter ? p.gatewayRef : null, counter ? uuidOrNull(p.collectedBy) : null, n.isDemo, n.bookedAt])).rows[0].id;
      } else {
        // amount due — not money received; kept so the dues report sees how the customer intends to pay
        await c.query(`insert into payments (shipment_id, branch_id, mode, amount, status, is_demo, created_at) values ($1,$2,$3,$4,'PENDING',$5,$6)`,
          [sid, branchUuid, n.paymentMode, n.amount, n.isDemo, n.bookedAt]);
      }
      for (const [i, j] of n.journals.entries()) await this.postJournal(c, j, { branchUuid, shipmentId: sid, paymentId: i > 0 ? paymentId : null, userId: n.createdBy, isDemo: n.isDemo });

      // invoice: gapless company-wide number; a tax invoice only once a GSTIN is configured
      const co = (await c.query('select legal_name, gstin from company_settings')).rows[0];
      const iv = n.invoice;
      await c.query(`insert into invoices (invoice_number, branch_id, customer_id, shipment_id, taxable_value, cgst, sgst, igst, total, issued_at, is_demo, is_tax_invoice, seller_legal_name, seller_gstin)
                     values (next_invoice_no($9),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [branchUuid, n.customerId, sid, iv.taxable, iv.cgst, iv.sgst, iv.igst, iv.total, n.bookedAt, n.isDemo, !!co.gstin, co.legal_name, co.gstin]);

      return sid as string;
    });
    return this.byId(id);
  }

  async addEvent(id: string, e: NewEvent) {
    await this.tx(async (c) => {
      await c.query(`insert into shipment_tracking_events (shipment_id, status, location, note, occurred_at, source, raw_status, recorded_by, verified)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, e.status, e.location, e.note, e.at, e.source, e.rawStatus ?? null, uuidOrNull(e.recordedBy), e.verified]);
      await c.query(`update shipments set status = $2::text, delivered_at = case when $2::text = 'DELIVERED' then $3::timestamptz else delivered_at end,
                       estimated_delivery = case when $2::text = 'DELIVERED' then null else estimated_delivery end where id = $1`,
        [id, e.status, e.at]);
    });
  }

  async listAggregators() {
    const { rows } = await this.pool.query(`select code, name, mode, portal_url, is_demo from aggregators where is_enabled order by name`);
    return rows.map((r) => ({ code: r.code, name: r.name, mode: r.mode, portalUrl: r.portal_url, isDemo: r.is_demo }));
  }

  async allocate(shipmentId: string, a: NewAllocation, journal: JournalLine[]) {
    try {
      await this.tx(async (c) => {
        const s = (await c.query('select branch_id, is_demo from shipments where id = $1 for update', [shipmentId])).rows[0];
        const agg = (await c.query('select id from aggregators where code = $1 and is_enabled', [a.aggregatorCode])).rows[0];
        if (!s || !agg) throw new Error('Unknown shipment or aggregator');
        const clash = await c.query(`select 1 from shipment_allocations where superseded_at is null and lower(courier_name) = lower($1) and awb = $2 and shipment_id <> $3`, [a.courierName, a.awb, shipmentId]);
        if (clash.rowCount) throw new AllocationConflictError('This AWB is already allocated to another shipment');
        await c.query(`update shipment_allocations set superseded_at = now(), superseded_by = $2, supersede_reason = $3
                         where shipment_id = $1 and superseded_at is null`, [shipmentId, a.userId, a.reason]);
        const partner = (await c.query('select id from courier_partners where lower(name) = lower($1) or lower(code) = lower($1) limit 1', [a.courierName])).rows[0];
        await c.query(`insert into shipment_allocations (shipment_id, aggregator_id, aggregator_ref, courier_name, partner_id, awb, partner_cost, allocated_by)
                       values ($1,$2,$3,$4,$5,$6,$7,$8)`, [shipmentId, agg.id, a.aggregatorRef, a.courierName, partner?.id ?? null, a.awb, a.partnerCost, a.userId]);
        await c.query('update shipments set partner_id = $2, partner_cost = $3 where id = $1', [shipmentId, partner?.id ?? null, a.partnerCost]);

        await this.postJournal(c, journal, { branchUuid: s.branch_id, shipmentId, userId: a.userId, isDemo: s.is_demo });
      });
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'shipment_allocations_awb_uq') throw new AllocationConflictError('This AWB is already allocated to another shipment');
      throw e;
    }
  }

  async collect(shipmentId: string, col: NewCollection, journal: (receiptNo: string) => JournalLine[]) {
    const pid = await this.tx(async (c) => {
      const s = (await c.query('select branch_id, is_demo from shipments where id = $1 for update', [shipmentId])).rows[0];
      if (!s) throw new Error('Shipment not found');
      const receiptNo: string = (await c.query('select next_receipt_no($1) as r', [s.branch_id])).rows[0].r;
      const id = (await c.query(
        `insert into payments (shipment_id, branch_id, mode, amount, status, receipt_no, reference, collected_by, is_demo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [shipmentId, s.branch_id, col.method, col.amount, col.simulated ? 'SIMULATED' : 'CAPTURED', receiptNo, col.reference, col.userId, s.is_demo])).rows[0].id;
      await this.postJournal(c, journal(receiptNo), { branchUuid: s.branch_id, shipmentId, paymentId: id, userId: col.userId, isDemo: s.is_demo });
      return id as string;
    });
    return (await this.byId(shipmentId)).payments.find((p) => p.id === pid)!;
  }

  async listLedger({ branchId, limit, offset }: { branchId: string | null; limit: number; offset: number }) {
    const w = branchId ? 'where b.code = $1' : '';
    const args = branchId ? [branchId] : [];
    const total = (await this.pool.query(`select count(*)::int as n from ledger_entries l join branches b on b.id = l.branch_id ${w}`, args)).rows[0].n;
    const { rows } = await this.pool.query(
      `select l.journal_id, l.posted_at, l.account, l.debit, l.credit, l.memo, b.code as branch_code, s.tracking_number, p.receipt_no
         from ledger_entries l join branches b on b.id = l.branch_id
         left join shipments s on s.id = l.shipment_id left join payments p on p.id = l.payment_id
        ${w} order by l.posted_at desc, l.id desc limit ${Number(limit)} offset ${Number(offset)}`, args);
    return {
      total,
      rows: rows.map((r) => ({ journalId: r.journal_id, postedAt: iso(r.posted_at), account: r.account, debit: Number(r.debit), credit: Number(r.credit),
        memo: r.memo, branchId: r.branch_code, trackingNumber: r.tracking_number, receiptNo: r.receipt_no })),
    };
  }


  async searchContacts(branchId: string | null, q: string, limit: number) {
    const term = q.trim().toLowerCase();
    const args: unknown[] = [`${term}%`, `% ${term}%`, `${term.replace(/\D/g, '') || '~'}%`];
    let w = `(lower(c.name) like $1 or lower(c.name) like $2 or c.phone like $3)`;
    if (branchId) { args.push(branchId); w += ` and b.code = $${args.length}`; }
    const { rows } = await this.pool.query(
      `select c.id, c.name, c.phone, c.email, c.address, c.pin, c.use_count, c.last_used_at from contacts c join branches b on b.id = c.branch_id
        where ${w} order by c.use_count desc, c.last_used_at desc limit ${Number(limit)}`, args);
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, pin: r.pin, useCount: r.use_count, lastUsedAt: iso(r.last_used_at) }));
  }

  async pincodeOffices(pin: string) {
    try {
      const { rows } = await this.pool.query('select office_name, office_type, delivery, district, state from pincode_directory where pin = $1 order by office_type, office_name', [pin]);
      return rows.map((r) => ({ name: r.office_name, officeType: r.office_type, delivery: r.delivery, district: r.district, state: r.state }));
    } catch (e) {
      if ((e as { code?: string }).code === '42P01') return []; // migration 0004 not applied yet
      throw e;
    }
  }

  // ------------------------------------------------------------ company settings & invoices

  async getCompany(): Promise<CompanySettings> {
    const r = (await this.pool.query('select legal_name, gstin, address, state_code, invoice_prefix from company_settings')).rows[0];
    return { legalName: r.legal_name, gstin: r.gstin, address: r.address, stateCode: r.state_code, invoicePrefix: r.invoice_prefix };
  }
  async setCompany(c: Omit<CompanySettings, 'invoicePrefix'>, userId: string) {
    await this.pool.query('update company_settings set legal_name = $1, gstin = $2, address = $3, state_code = $4, updated_by = $5, updated_at = now()',
      [c.legalName, c.gstin, c.address, c.stateCode, uuidOrNull(userId)]);
    return this.getCompany();
  }

  private static readonly INVOICE_SELECT = `
    select i.invoice_number, i.issued_at, b.code as branch_code, s.tracking_number, i.taxable_value, i.cgst, i.sgst, i.igst, i.total,
           i.is_tax_invoice, i.seller_legal_name, i.seller_gstin, i.is_demo, s.origin_city, s.dest_city,
           a.name as cust_name, a.phone as cust_phone, a.address as cust_address
      from invoices i join branches b on b.id = i.branch_id
      left join shipments s on s.id = i.shipment_id
      left join shipment_addresses a on a.shipment_id = s.id and a.kind = 'SENDER'`;
  private static toInvoice(r: Record<string, any>): InvoiceRecord {
    return {
      number: r.invoice_number, issuedAt: iso(r.issued_at), branchId: r.branch_code, trackingNumber: r.tracking_number,
      taxable: Number(r.taxable_value), cgst: Number(r.cgst), sgst: Number(r.sgst), igst: Number(r.igst), total: Number(r.total),
      isTaxInvoice: r.is_tax_invoice, sellerLegalName: r.seller_legal_name, sellerGstin: r.seller_gstin, isDemo: r.is_demo,
      customer: r.cust_name ? { name: r.cust_name, phone: r.cust_phone, address: r.cust_address } : null, origin: r.origin_city, destination: r.dest_city,
    };
  }
  async listInvoices({ branchId, limit, offset }: { branchId: string | null; limit: number; offset: number }) {
    const w = branchId ? 'where b.code = $1' : ''; const args = branchId ? [branchId] : [];
    const total = (await this.pool.query(`select count(*)::int as n from invoices i join branches b on b.id = i.branch_id ${w}`, args)).rows[0].n;
    const { rows } = await this.pool.query(`${PgRepository.INVOICE_SELECT} ${w} order by i.issued_at desc, i.invoice_number desc limit ${Number(limit)} offset ${Number(offset)}`, args);
    return { total, rows: rows.map(PgRepository.toInvoice) };
  }
  async findInvoice(number: string, branchId: string | null) {
    const { rows } = await this.pool.query(`${PgRepository.INVOICE_SELECT} where i.invoice_number = $1 ${branchId ? 'and b.code = $2' : ''}`, branchId ? [number, branchId] : [number]);
    return rows[0] ? PgRepository.toInvoice(rows[0]) : null;
  }

  async trialBalance(branchId: string | null) {
    const { rows } = await this.pool.query(
      `select l.account, sum(l.debit) as debit, sum(l.credit) as credit from ledger_entries l join branches b on b.id = l.branch_id
        ${branchId ? 'where b.code = $1' : ''} group by l.account order by l.account`, branchId ? [branchId] : []);
    return rows.map((r) => ({ account: r.account, debit: Number(r.debit), credit: Number(r.credit) }));
  }

  async listBranches(branchId: string | null): Promise<BranchRecord[]> {
    const { rows } = await this.pool.query(
      `select b.code, b.name, b.city from branches b where b.deleted_at is null ${branchId ? 'and b.code = $1' : ''} order by b.code`, branchId ? [branchId] : []);
    return rows.map((r) => ({ id: r.code, name: r.name, city: r.city }));
  }

  async audit(e: { userId: string | null; action: string; entity: string; entityId: string; detail?: unknown }) {
    await this.pool.query('insert into audit_logs (user_id, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5)',
      [uuidOrNull(e.userId), e.action, e.entity, e.entityId, e.detail ? JSON.stringify(e.detail) : null]);
  }

  close() { return this.pool.end(); }
}
