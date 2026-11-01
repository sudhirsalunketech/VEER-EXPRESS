import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SHIPMENTS, isValidTrackingNumber } from '@veer/core';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const login = async (email: string) => (await http().post('/api/v1/auth/login').send({ email, password: 'Demo@123' })).body.accessToken as string;
const FORBIDDEN_PUBLIC_KEYS = ['partnerCode', 'partnerName', 'partnerAwb', 'partnerCost', 'grossMargin', 'grossMarginExGst'];
const leaks = (o: unknown) => FORBIDDEN_PUBLIC_KEYS.filter((k) => JSON.stringify(o).includes(`"${k}"`));

const quote = { originPin: '411001', destPin: '110001', actualWeightKg: 1.5, dims: { lengthCm: 30, widthCm: 25, heightCm: 15 }, service: 'EXPRESS', declaredValue: 2500, insurance: true };
const booking = { ...quote, kind: 'PARCEL', sender: { name: 'Test Sender', phone: '9800000011', address: 'Shop 4, FC Road, Pune' }, receiver: { name: 'Test Receiver', phone: '9800000022', address: '12 Connaught Place, New Delhi' }, paymentMode: 'UPI', originCity: 'Pune', destCity: 'New Delhi' };

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig({ APP_MODE: 'demo' }))] }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(() => app.close());

describe('public API', () => {
  it('health is public', async () => {
    expect((await http().get('/api/v1/health')).body.mode).toBe('demo');
  });

  it('quote returns customer price without partner economics', async () => {
    const r = await http().post('/api/v1/public/quote').send(quote).expect(200);
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.sample).toBe(true);
    expect(leaks(r.body)).toEqual([]);
  });

  it('rejects invalid input with 400 and issue list', async () => {
    const r = await http().post('/api/v1/public/quote').send({ ...quote, originPin: '012345' }).expect(400);
    expect(r.body.issues[0].path).toBe('originPin');
  });

  it('books, issues a valid Veer tracking number and tracks it without leaking partner data', async () => {
    const b = await http().post('/api/v1/public/bookings').send(booking).expect(201);
    expect(isValidTrackingNumber(b.body.trackingNumber)).toBe(true);
    expect(b.body).toMatchObject({ shipmentStatus: 'BOOKED', paymentStatus: 'PAID', balanceDue: 0, simulatedPayment: true });
    expect(leaks(b.body)).toEqual([]);
    const t = await http().get(`/api/v1/public/track/${b.body.trackingNumber}`).expect(200);
    expect(t.body).toMatchObject({ status: 'BOOKED', dispatched: false });
    expect(t.body.lastUpdatedAt).toBeTruthy();
    expect(t.body.updateNotice).toMatch(/not real-time/);
    expect(leaks(t.body)).toEqual([]);
  });

  it('public cannot use credit accounts or cash', async () => {
    await http().post('/api/v1/public/bookings').send({ ...booking, paymentMode: 'CREDIT' }).expect(400);
    await http().post('/api/v1/public/bookings').send({ ...booking, paymentMode: 'CASH' }).expect(400);
  });

  it('staff can record a cash booking', async () => {
    const tok = await login('staff@demo.veer');
    const r = await http().post('/api/v1/shipments').set('authorization', `Bearer ${tok}`).send({ ...booking, paymentMode: 'CASH' }).expect(201);
    expect(r.body).toMatchObject({ paymentStatus: 'PAID', simulatedPayment: true });
    expect(r.body.receiptNo).toMatch(/^KMT-R-\d{6}$/);
  });

  it('unknown tracking number is 404', async () => {
    await http().get('/api/v1/public/track/VX0000000000000').expect(404);
  });
});

describe('auth & RBAC', () => {
  it('rejects bad credentials and missing tokens', async () => {
    await http().post('/api/v1/auth/login').send({ email: 'admin@demo.veer', password: 'nope' }).expect(401);
    await http().get('/api/v1/shipments').expect(401);
  });

  it('super admin sees all shipments with allocation economics', async () => {
    const tok = await login('superadmin@demo.veer');
    const r = await http().get('/api/v1/shipments?pageSize=100').set('authorization', `Bearer ${tok}`).expect(200);
    expect(r.body.total).toBeGreaterThanOrEqual(DEMO_SHIPMENTS.length);
    const allocated = r.body.rows.find((s: { allocated: boolean }) => s.allocated);
    expect(allocated.allocation.partnerCost).toBeGreaterThan(0);
  });

  it('counter staff see shipments but no courier, AWB or cost', async () => {
    const tok = await login('staff@demo.veer');
    const r = await http().get('/api/v1/shipments?pageSize=100').set('authorization', `Bearer ${tok}`).expect(200);
    expect(r.body.rows.length).toBeGreaterThan(0);
    expect(r.body.rows.every((s: { branchId: string }) => s.branchId === 'BR-KMT')).toBe(true);
    for (const row of r.body.rows) {
      expect(row).not.toHaveProperty('allocation');
      expect(row).not.toHaveProperty('estimatedPartnerCost');
      expect(row).not.toHaveProperty('grossMarginExGst');
    }
    const dash = await http().get('/api/v1/dashboard').set('authorization', `Bearer ${tok}`).expect(200);
    expect(dash.body).not.toHaveProperty('partnerPayable');
  });

  it('counter staff cannot access admin partner config', async () => {
    const tok = await login('staff@demo.veer');
    await http().get('/api/v1/admin/courier-partners').set('authorization', `Bearer ${tok}`).expect(403);
  });

  it('partner listing never exposes credentials', async () => {
    const tok = await login('superadmin@demo.veer');
    const r = await http().get('/api/v1/admin/courier-partners').set('authorization', `Bearer ${tok}`).expect(200);
    const s = JSON.stringify(r.body);
    expect(s).not.toMatch(/"credentials"|"webhookSecret"|mock-webhook-secret/);
    expect(r.body.find((p: { adapter: string }) => p.adapter === 'BlueDartProvider').capabilities.booking).toBe(false);
  });

  it('every booking belongs to the Kamothe branch and starts unallocated with the amount due', async () => {
    const tok = await login('staff@demo.veer');
    const r = await http().post('/api/v1/shipments').set('authorization', `Bearer ${tok}`).send({ ...booking, paymentMode: 'COUNTER' }).expect(201);
    expect(r.body).toMatchObject({ paymentStatus: 'PENDING', receiptNo: null });
    expect(r.body.balanceDue).toBe(r.body.quote.total);
    const s = await http().get(`/api/v1/shipments/${r.body.trackingNumber}`).set('authorization', `Bearer ${tok}`).expect(200);
    expect(s.body).toMatchObject({ branchId: 'BR-KMT', allocated: false });
    const pub = await http().post('/api/v1/public/bookings').send(booking).expect(201);
    const p = await http().get(`/api/v1/shipments/${pub.body.trackingNumber}`).set('authorization', `Bearer ${tok}`).expect(200);
    expect(p.body.branchId).toBe('BR-KMT');
  });
});

describe('partner webhooks', () => {
  const target = DEMO_SHIPMENTS.find((s) => s.status === 'OUT_FOR_DELIVERY')!;
  const body = { events: [{ partnerAwb: target.allocation!.awb, rawStatus: 'DELIVERED', at: new Date().toISOString(), location: target.destination }] };

  it('rejects unsigned webhooks', async () => {
    await http().post(`/api/v1/webhooks/couriers/${target.partnerCode}`).send(body).expect(401);
    await http().post('/api/v1/webhooks/couriers/NOPE').send(body).expect(404);
  });

  it('applies a signed partner update as a unified status', async () => {
    const sig = createHmac('sha256', 'mock-webhook-secret').update(JSON.stringify(body)).digest('hex');
    const r = await http().post(`/api/v1/webhooks/couriers/${target.partnerCode}`).set('x-mock-signature', sig).send(body).expect(200);
    expect(r.body).toEqual({ received: 1, applied: 1 });
    const t = await http().get(`/api/v1/public/track/${target.trackingNumber}`).expect(200);
    expect(t.body.status).toBe('DELIVERED');
  });
});
