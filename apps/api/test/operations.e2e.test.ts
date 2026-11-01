/** Milestone 3: aggregator allocation, manual tracking, counter collection and ledger — memory, and Postgres when available. */
import 'reflect-metadata';
import { randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SHIPMENTS } from '@veer/core';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';

const targets = [
  { name: 'memory', env: { APP_MODE: 'demo' } },
  ...(process.env.TEST_DATABASE_URL ? [{ name: 'postgres', env: { APP_MODE: 'development', DATABASE_URL: process.env.TEST_DATABASE_URL } }] : []),
];

const booking = {
  originPin: '411001', destPin: '110001', actualWeightKg: 1.5, dims: { lengthCm: 30, widthCm: 25, heightCm: 15 }, service: 'EXPRESS',
  declaredValue: 2500, insurance: false, kind: 'PARCEL', originCity: 'Pune', destCity: 'New Delhi', paymentMode: 'COUNTER',
  sender: { name: 'Ops Sender', phone: '9800000011', address: 'Shop 4, FC Road, Pune' }, receiver: { name: 'Ops Receiver', phone: '9800000022', address: '12 Connaught Place, New Delhi' },
};
const awb = () => `TST${randomInt(1e9, 9e9)}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60e3).toISOString();

describe.each(targets)('operations ($name)', ({ env }) => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const book = async (who = 'counter', extra: object = {}) =>
    (await http().post('/api/v1/shipments').set(as(who)).send({ ...booking, ...extra }).expect(201)).body as { trackingNumber: string; quote: { total: number } };
  const allocation = (o: object = {}) => ({ aggregatorRef: `AGG-${randomInt(1e6, 9e6)}`, courierName: 'DTDC', awb: awb(), partnerCost: 95, ...o });
  const allocate = (tn: string, body = allocation()) => http().post(`/api/v1/shipments/${tn}/allocation`).set(as('ops')).send(body);
  const track = (tn: string, o: object) => http().post(`/api/v1/shipments/${tn}/tracking`).set(as('ops')).send({ verified: true, location: 'Pune hub', occurredAt: minutesAgo(0), ...o });
  const collect = (tn: string, o: object, who = 'counter') => http().post(`/api/v1/shipments/${tn}/payments`).set(as(who)).send(o);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig(env))] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
    for (const [k, email] of Object.entries({ ops: 'ops@demo.veer', counter: 'staff@demo.veer', accounts: 'accounts@demo.veer', admin: 'superadmin@demo.veer' })) {
      tokens[k] = (await http().post('/api/v1/auth/login').send({ email, password: 'Demo@123' }).expect(200)).body.accessToken;
    }
  });
  afterAll(() => app.close());

  describe('allocation', () => {
    it('new bookings wait in the allocation queue; allocating moves them to the tracking queue', async () => {
      const { trackingNumber: tn } = await book();
      const q1 = (await http().get('/api/v1/shipments/queues/allocation').set(as('ops')).expect(200)).body;
      expect(q1.some((s: { trackingNumber: string }) => s.trackingNumber === tn)).toBe(true);
      const r = await allocate(tn).expect(200);
      expect(r.body.allocation).toMatchObject({ courierName: 'DTDC', partnerCost: 95, allocatedBy: 'Demo Operations Executive' });
      const q2 = (await http().get('/api/v1/shipments/queues/allocation').set(as('ops'))).body;
      expect(q2.some((s: { trackingNumber: string }) => s.trackingNumber === tn)).toBe(false);
      const t = (await http().get('/api/v1/shipments/queues/tracking').set(as('ops')).expect(200)).body;
      expect(t.find((s: { trackingNumber: string }) => s.trackingNumber === tn)).toMatchObject({ stale: false });
    });

    it('only operations staff can allocate; counter staff never see courier or cost', async () => {
      const { trackingNumber: tn } = await book();
      await http().post(`/api/v1/shipments/${tn}/allocation`).set(as('counter')).send(allocation()).expect(403);
      await http().get('/api/v1/shipments/queues/allocation').set(as('counter')).expect(403);
      await allocate(tn).expect(200);
      const s = (await http().get(`/api/v1/shipments/${tn}`).set(as('counter')).expect(200)).body;
      expect(s.allocated).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/DTDC|"awb"|aggregator|partnerCost/i);
    });

    it('validates the aggregator reference, AWB and cost', async () => {
      const { trackingNumber: tn } = await book();
      await allocate(tn, allocation({ aggregatorRef: 'x' })).expect(422);
      await allocate(tn, allocation({ awb: 'bad awb!' })).expect(422);
      await allocate(tn, allocation({ partnerCost: 0 })).expect(422);
      await allocate('VX0000000000000').expect(404);
    });

    it('re-allocation needs a reason, keeps history and reverses the cost in the ledger', async () => {
      const { trackingNumber: tn } = await book();
      await allocate(tn, allocation({ partnerCost: 100 })).expect(200);
      await allocate(tn, allocation({ courierName: 'Blue Dart', partnerCost: 120 })).expect(409);
      const r = await allocate(tn, allocation({ courierName: 'Blue Dart', partnerCost: 120, reason: 'DTDC pickup missed, rebooked' })).expect(200);
      expect(r.body.allocation).toMatchObject({ courierName: 'Blue Dart', partnerCost: 120 });
      const audit = (await http().get('/api/v1/audit?action=SHIPMENT.REALLOCATE&pageSize=200').set(as('admin'))).body.rows;
      expect(audit.find((a: { entityId: string }) => a.entityId === tn).detail).toMatchObject({ previous: { partnerCost: 100 }, reason: 'DTDC pickup missed, rebooked' });
      const ledger = (await http().get('/api/v1/ledger?pageSize=200').set(as('accounts'))).body.rows.filter((l: { trackingNumber: string }) => l.trackingNumber === tn);
      const courierCost = ledger.filter((l: { account: string }) => l.account === 'COURIER_COST').reduce((s: number, l: { debit: number; credit: number }) => s + l.debit - l.credit, 0);
      expect(courierCost).toBeCloseTo(120, 2);
    });

    it('the same courier AWB cannot be active on two shipments', async () => {
      const a = await book(); const b = await book();
      const body = allocation();
      await allocate(a.trackingNumber, body).expect(200);
      await allocate(b.trackingNumber, { ...body, aggregatorRef: 'AGG-OTHER1' }).expect(409);
    });
  });

  describe('manual tracking', () => {
    it('enforces allocation, status order, verification and time rules', async () => {
      const { trackingNumber: tn } = await book();
      await track(tn, { status: 'PICKED_UP' }).expect(422); // not allocated yet
      await allocate(tn).expect(200);
      await track(tn, { status: 'DELIVERED' }).expect(422); // cannot skip ahead
      await track(tn, { status: 'PICKED_UP', verified: false }).expect(422);
      await track(tn, { status: 'PICKED_UP', occurredAt: new Date(Date.now() + 3600e3).toISOString() }).expect(422);
      await track(tn, { status: 'PICKED_UP', occurredAt: minutesAgo(60 * 24 * 30) }).expect(422); // before booking
      await track(tn, { status: 'EXCEPTION', remarks: '' }).expect(422); // exception needs a reason
      await track(tn, { status: 'PICKED_UP' }).expect(201);
      await http().post(`/api/v1/shipments/${tn}/tracking`).set(as('counter')).send({ status: 'IN_TRANSIT', occurredAt: minutesAgo(0), location: 'x', verified: true }).expect(403);
    });

    it('customers see the update with "last updated", but never courier, AWB, aggregator or staff', async () => {
      const { trackingNumber: tn } = await book();
      const body = allocation();
      await allocate(tn, body).expect(200);
      await track(tn, { status: 'PICKED_UP', location: 'Pune pickup centre', remarks: 'Picked up from sender' }).expect(201);
      const t = (await http().get(`/api/v1/public/track/${tn}`).expect(200)).body;
      expect(t).toMatchObject({ status: 'PICKED_UP', dispatched: true });
      expect(t.events.at(-1)).toMatchObject({ status: 'PICKED_UP', location: 'Pune pickup centre', note: 'Picked up from sender' });
      expect(Date.now() - Date.parse(t.lastUpdatedAt)).toBeLessThan(60e3);
      const raw = JSON.stringify(t);
      for (const secret of [body.awb, body.aggregatorRef, 'DTDC', 'Demo Operations Executive', 'recordedBy', 'partnerCost']) expect(raw).not.toContain(secret);
    });

    it('keeps events in the order staff recorded them, even within the same minute', async () => {
      const { trackingNumber: tn } = await book();
      await allocate(tn).expect(200);
      const minute = new Date(); minute.setSeconds(0, 0); // as entered in a minute-precision form
      await track(tn, { status: 'PICKED_UP', occurredAt: minute.toISOString() }).expect(201);
      const t = (await http().get(`/api/v1/public/track/${tn}`).expect(200)).body;
      expect(t.events.map((e: { status: string }) => e.status)).toEqual(['BOOKED', 'PICKED_UP']);
    });

    it('staff see who recorded each update', async () => {
      const { trackingNumber: tn } = await book();
      await allocate(tn).expect(200);
      const r = (await track(tn, { status: 'PICKED_UP' }).expect(201)).body;
      expect(r.events.at(-1)).toMatchObject({ source: 'MANUAL', recordedBy: 'Demo Operations Executive' });
    });

    it('stale shipments are flagged in the tracking queue', async () => {
      const q = (await http().get('/api/v1/shipments/queues/tracking').set(as('ops')).expect(200)).body as { hoursSinceUpdate: number; stale: boolean }[];
      expect(q.every((s) => s.stale === s.hoursSinceUpdate >= 12)).toBe(true);
      for (let i = 1; i < q.length; i++) expect(q[i - 1].hoursSinceUpdate).toBeGreaterThanOrEqual(q[i].hoursSinceUpdate);
    });
  });

  describe('counter collection', () => {
    it('issues sequential branch receipts; payment status moves independently of shipment status', async () => {
      const { trackingNumber: tn, quote } = await book();
      const half = Math.round(quote.total / 2);
      const r1 = (await collect(tn, { method: 'CASH', amount: half }).expect(201)).body;
      expect(r1).toMatchObject({ paymentStatus: 'PARTIALLY_PAID', shipmentStatus: 'BOOKED' });
      expect(r1.receipt.receiptNo).toMatch(/^KMT-R-\d{6}$/);
      expect(r1.receipt.collectedBy).toBe('Demo Counter Staff');
      await collect(tn, { method: 'COUNTER_UPI', amount: 1 }).expect(422); // UPI needs a transaction id
      await collect(tn, { method: 'CASH', amount: quote.total }).expect(422); // more than due
      const r2 = (await collect(tn, { method: 'COUNTER_UPI', amount: r1.balanceDue, reference: 'UPI12345678' }).expect(201)).body;
      expect(r2).toMatchObject({ paymentStatus: 'PAID', balanceDue: 0, shipmentStatus: 'BOOKED' });
      expect(Number(r2.receipt.receiptNo.slice(-6))).toBe(Number(r1.receipt.receiptNo.slice(-6)) + 1);
      await collect(tn, { method: 'CASH', amount: 1 }).expect(409);
    });

    it('accountants do not collect; unknown shipments are 404', async () => {
      const { trackingNumber: tn } = await book();
      await collect(tn, { method: 'CASH', amount: 10 }, 'accounts').expect(403);
      await collect('VX0000000000000', { method: 'CASH', amount: 10 }).expect(404);
    });

    it('delivered but unpaid shipments stay PENDING', async () => {
      const s = DEMO_SHIPMENTS.find((x) => x.status === 'DELIVERED' && x.payments.length === 0);
      if (!s) return;
      const r = (await http().get(`/api/v1/shipments/${s.trackingNumber}`).set(as('admin')).expect(200)).body;
      expect(r).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PENDING' });
    });
  });

  describe('ledger', () => {
    it('is balanced, includes receipts, and is visible to finance roles only', async () => {
      const { trackingNumber: tn, quote } = await book();
      const { receipt } = (await collect(tn, { method: 'CASH', amount: quote.total }).expect(201)).body;
      const r = (await http().get('/api/v1/ledger?pageSize=200').set(as('accounts')).expect(200)).body;
      expect(r.trialBalance.balanced).toBe(true);
      const mine = r.rows.filter((l: { trackingNumber: string }) => l.trackingNumber === tn);
      expect(mine.some((l: { account: string; receiptNo: string }) => l.account === 'BRANCH_CASH' && l.receiptNo === receipt.receiptNo)).toBe(true);
      expect(mine.reduce((s: number, l: { debit: number; credit: number }) => s + l.debit - l.credit, 0)).toBeCloseTo(0, 2);
      await http().get('/api/v1/ledger').set(as('counter')).expect(403);
      const branch = (await http().get('/api/v1/ledger?branchId=BR-KMT&pageSize=200').set(as('accounts')).expect(200)).body;
      expect(branch.rows.every((l: { branchId: string }) => l.branchId === 'BR-KMT')).toBe(true);
      expect(branch.trialBalance.balanced).toBe(true);
    });

    it('a cash booking posts booking and payment journals with a receipt', async () => {
      const r = (await http().post('/api/v1/shipments').set(as('counter')).send({ ...booking, paymentMode: 'CASH' }).expect(201)).body;
      expect(r).toMatchObject({ paymentStatus: 'PAID', balanceDue: 0 });
      expect(r.receiptNo).toMatch(/^KMT-R-\d{6}$/);
    });
  });

  it('dashboard counts work awaiting allocation and money due', async () => {
    const d = (await http().get('/api/v1/dashboard').set(as('admin')).expect(200)).body;
    expect(d.awaitingAllocation).toBeGreaterThan(0);
    expect(d.paymentDueCount).toBeGreaterThan(0);
  });
});
