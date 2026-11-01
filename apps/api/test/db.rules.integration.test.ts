/**
 * Database-level guarantees from migration 0002. Runs only when TEST_DATABASE_URL points at a
 * database with migrations 0001 + 0002 applied and demo data seeded.
 */
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database rules (migration 0002)', () => {
  let pool: Pool;
  let branchId: string; let shipmentId: string; let userId: string; let aggId: string;

  /** Runs fn in a transaction that is always rolled back, so tests leave no trace. */
  const inTx = async <T>(fn: (c: PoolClient) => Promise<T>) => {
    const c = await pool.connect();
    try { await c.query('begin'); return await fn(c); } finally { await c.query('rollback').catch(() => {}); c.release(); }
  };
  const commitFails = (fn: (c: PoolClient) => Promise<void>) => inTx(async (c) => { await fn(c); await c.query('commit'); });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    branchId = (await pool.query(`select id from branches where code = 'BR-KMT'`)).rows[0].id;
    shipmentId = (await pool.query(`select id from shipments where branch_id = $1 limit 1`, [branchId])).rows[0].id;
    userId = (await pool.query(`select id from users where email = 'superadmin@demo.veer'`)).rows[0].id;
    aggId = (await pool.query(`insert into aggregators (code, name, is_demo) values ($1, 'Test aggregator', true)
                               on conflict (code) do update set name = excluded.name returning id`, ['TEST_AGG'])).rows[0].id;
  });
  afterAll(() => pool.end());

  describe('ledger', () => {
    const line = (c: PoolClient, j: string, account: string, debit: number, credit: number) =>
      c.query(`insert into ledger_entries (journal_id, account, debit, credit, branch_id, memo) values ($1,$2,$3,$4,$5,'test')`, [j, account, debit, credit, branchId]);

    it('accepts a balanced journal', async () => {
      await inTx(async (c) => {
        const j = randomUUID();
        await line(c, j, 'BRANCH_CASH', 100, 0);
        await line(c, j, 'CUSTOMER_RECEIVABLE', 0, 100);
        await c.query('set constraints all immediate'); // run the deferred balance check now
      });
    });

    it('rejects an unbalanced journal at commit', async () => {
      await expect(commitFails(async (c) => {
        const j = randomUUID();
        await line(c, j, 'BRANCH_CASH', 100, 0);
        await line(c, j, 'CUSTOMER_RECEIVABLE', 0, 90);
      })).rejects.toThrow(/not balanced/);
    });

    it('rejects a line with both or neither side', async () => {
      await expect(inTx((c) => line(c, randomUUID(), 'BRANCH_CASH', 0, 0))).rejects.toThrow(/check constraint/);
      await expect(inTx((c) => line(c, randomUUID(), 'BRANCH_CASH', 5, 5))).rejects.toThrow(/check constraint/);
    });

    it('is append-only', async () => {
      await expect(inTx(async (c) => {
        const j = randomUUID();
        await line(c, j, 'BRANCH_CASH', 10, 0); await line(c, j, 'CUSTOMER_RECEIVABLE', 0, 10);
        await c.query(`update ledger_entries set debit = 20 where journal_id = $1`, [j]);
      })).rejects.toThrow(/append-only/);
    });
  });

  describe('append-only logs', () => {
    it('audit logs and tracking events cannot be edited or deleted', async () => {
      await expect(inTx((c) => c.query(`delete from audit_logs`))).rejects.toThrow(/append-only/);
      await expect(inTx((c) => c.query(`update shipment_tracking_events set location = 'x'`))).rejects.toThrow(/append-only/);
    });
  });

  describe('allocations', () => {
    const alloc = (c: PoolClient, sid: string, awb: string) => c.query(
      `insert into shipment_allocations (shipment_id, aggregator_id, aggregator_ref, courier_name, awb, partner_cost, allocated_by)
       values ($1,$2,'AGG-TEST-1','DTDC',$3,90,$4)`, [sid, aggId, awb, userId]);

    it('allows one active allocation per shipment; re-allocation supersedes the old one', async () => {
      await inTx(async (c) => {
        await c.query(`update shipment_allocations set superseded_at = now(), superseded_by = $2 where shipment_id = $1 and superseded_at is null`, [shipmentId, userId]);
        await alloc(c, shipmentId, 'TEST000001');
        await expect(alloc(c, shipmentId, 'TEST000002')).rejects.toThrow(/shipment_allocations_active_uq/);
      });
    });

    it('rejects malformed AWB and non-positive cost', async () => {
      await expect(inTx(async (c) => {
        await c.query(`update shipment_allocations set superseded_at = now() where shipment_id = $1`, [shipmentId]);
        await alloc(c, shipmentId, 'bad awb');
      })).rejects.toThrow(/check constraint/);
    });
  });

  describe('manual tracking', () => {
    const ev = (c: PoolClient, opts: { by?: string | null; verified?: boolean; occurred?: string }) => c.query(
      `insert into shipment_tracking_events (shipment_id, status, location, note, occurred_at, source, recorded_by, verified)
       values ($1,'IN_TRANSIT','Pune hub','test',$2,'MANUAL',$3,$4)`,
      [shipmentId, opts.occurred ?? new Date().toISOString(), opts.by === undefined ? userId : opts.by, opts.verified ?? true]);

    it('accepts a signed, verified manual update', async () => { await inTx((c) => ev(c, {})); });
    it('rejects manual updates without staff or verification', async () => {
      await expect(inTx((c) => ev(c, { by: null }))).rejects.toThrow(/tracking_manual_audited/);
      await expect(inTx((c) => ev(c, { verified: false }))).rejects.toThrow(/tracking_manual_audited/);
    });
    it('rejects events that happen after they were recorded', async () => {
      await expect(inTx((c) => ev(c, { occurred: new Date(Date.now() + 3600e3).toISOString() }))).rejects.toThrow(/tracking_event_not_future/);
    });
  });

  describe('receipts', () => {
    it('numbers receipts sequentially per branch', async () => {
      await inTx(async (c) => {
        const a = (await c.query(`select next_receipt_no($1) as r`, [branchId])).rows[0].r as string;
        const b = (await c.query(`select next_receipt_no($1) as r`, [branchId])).rows[0].r as string;
        expect(a).toMatch(/^KMT-R-\d{6}$/);
        expect(Number(b.slice(-6))).toBe(Number(a.slice(-6)) + 1);
      });
    });
    it('a captured counter payment must name the collector and receipt', async () => {
      await expect(inTx((c) => c.query(
        `insert into payments (shipment_id, branch_id, mode, amount, status) values ($1,$2,'CASH',100,'CAPTURED')`, [shipmentId, branchId],
      ))).rejects.toThrow(/payments_counter_audited/);
    });
  });

  describe('invoices & settlements (migration 0003)', () => {
    it('issued invoices cannot be edited or deleted', async () => {
      await expect(inTx((c) => c.query(`update invoices set total = total + 1`))).rejects.toThrow(/append-only/);
      await expect(inTx((c) => c.query(`delete from invoices`))).rejects.toThrow(/append-only/);
    });
    it('invoice numbers are gapless per financial year', async () => {
      await inTx(async (c) => {
        const a = (await c.query(`select next_invoice_no(now()) as n`)).rows[0].n as string;
        const b = (await c.query(`select next_invoice_no(now()) as n`)).rows[0].n as string;
        expect(Number(b.slice(-5))).toBe(Number(a.slice(-5)) + 1);
      });
    });
    const draft = (c: PoolClient) => c.query(
      `insert into settlements (branch_id, period_start, period_end, status, created_by) values ($1, '2020-01-01', '2020-01-02', 'DRAFT', $2) returning id`, [branchId, userId]);
    it('a settlement cannot skip approval, and its creator cannot approve it', async () => {
      await expect(inTx(async (c) => { const { id } = (await draft(c)).rows[0]; await c.query(`update settlements set status = 'PAID', paid_at = now(), paid_reference = 'X1234' where id = $1`, [id]); }))
        .rejects.toThrow(/Invalid settlement transition/);
      await expect(inTx(async (c) => { const { id } = (await draft(c)).rows[0]; await c.query(`update settlements set status = 'APPROVED', approved_by = $2 where id = $1`, [id, userId]); }))
        .rejects.toThrow(/settlements_maker_checker/);
    });
    it('a paid settlement is final', async () => {
      await expect(inTx(async (c) => {
        const { id } = (await draft(c)).rows[0];
        const other = (await c.query(`select id from users where email = 'admin@demo.veer'`)).rows[0].id;
        await c.query(`update settlements set status = 'APPROVED', approved_by = $2 where id = $1`, [id, other]);
        await c.query(`update settlements set status = 'PAID', paid_at = now(), paid_reference = 'UTR9999' where id = $1`, [id]);
        await c.query(`update settlements set paid_reference = 'CHANGED' where id = $1`, [id]);
      })).rejects.toThrow(/Paid settlements cannot be changed/);
    });
  });

  it('payment status comes from payments, not shipment status', async () => {
    const { rows } = await pool.query(
      `select s.status, v.payment_status from shipments s join shipment_payment_summary v on v.shipment_id = s.id where s.payment_mode = 'CREDIT'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.payment_status === 'PENDING')).toBe(true);
    expect(rows.some((r) => r.status === 'DELIVERED' || r.status !== 'BOOKED')).toBe(true); // delivered/in transit yet unpaid
  });
});
