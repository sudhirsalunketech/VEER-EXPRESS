/** Runs only when TEST_DATABASE_URL points at a migrated + seeded database. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SHIPMENTS } from '@veer/core';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('PostgreSQL repository (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  const http = () => request(app.getHttpServer());
  const login = async (email: string) => (await http().post('/api/v1/auth/login').send({ email, password: 'Demo@123' })).body.accessToken as string;
  const booking = { originPin: '411001', destPin: '110001', actualWeightKg: 1.5, dims: { lengthCm: 30, widthCm: 25, heightCm: 15 }, service: 'EXPRESS', declaredValue: 2500, insurance: true, kind: 'PARCEL', sender: { name: 'PG Sender', phone: '9800000011', address: 'Shop 4, FC Road, Pune' }, receiver: { name: 'PG Receiver', phone: '9800000022', address: '12 Connaught Place, New Delhi' }, paymentMode: 'COUNTER', originCity: 'Pune', destCity: 'New Delhi' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig({ APP_MODE: 'development', DATABASE_URL: url }))] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
    pool = new Pool({ connectionString: url });
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('tracks a seeded shipment publicly', async () => {
    const s = DEMO_SHIPMENTS[5];
    const r = await http().get(`/api/v1/public/track/${s.trackingNumber}`).expect(200);
    expect(r.body.events.length).toBe(s.events.length);
    expect(JSON.stringify(r.body)).not.toContain('partner');
  });

  it('booking writes all rows, its invoice and a balanced booking journal in one transaction', async () => {
    const tok = await login('staff@demo.veer');
    const r = await http().post('/api/v1/shipments').set('authorization', `Bearer ${tok}`).send(booking).expect(201);
    const { rows } = await pool.query(
      `select s.partner_id, s.estimated_partner_cost, (select count(*) from shipment_addresses a where a.shipment_id = s.id)::int as addr,
              (select count(*) from payments p where p.shipment_id = s.id and p.status = 'PENDING')::int as due,
              (select count(*) from invoices i where i.shipment_id = s.id)::int as inv,
              (select coalesce(sum(debit) - sum(credit), 0) from ledger_entries l where l.shipment_id = s.id)::numeric as net,
              (select sum(debit) from ledger_entries l where l.shipment_id = s.id and account = 'CUSTOMER_RECEIVABLE')::numeric as receivable
         from shipments s where tracking_number = $1`, [r.body.trackingNumber]);
    expect(rows[0]).toMatchObject({ partner_id: null, addr: 2, due: 1, inv: 1 });
    expect(Number(rows[0].estimated_partner_cost)).toBeGreaterThan(0);
    expect(Number(rows[0].net)).toBe(0);
    expect(Number(rows[0].receivable)).toBeCloseTo(r.body.quote.total, 2);
  });

  it('unallocated shipments are listed and trackable', async () => {
    const tok = await login('superadmin@demo.veer');
    const r = await http().get('/api/v1/shipments?pageSize=100').set('authorization', `Bearer ${tok}`).expect(200);
    const unallocated = DEMO_SHIPMENTS.filter((s) => !s.allocation);
    for (const s of unallocated) {
      expect(r.body.rows.some((x: { trackingNumber: string }) => x.trackingNumber === s.trackingNumber)).toBe(true);
      await http().get(`/api/v1/public/track/${s.trackingNumber}`).expect(200);
    }
  });

  it('every shipment belongs to the Kamothe branch', async () => {
    const tok = await login('staff@demo.veer');
    const r = await http().get('/api/v1/shipments?pageSize=100').set('authorization', `Bearer ${tok}`).expect(200);
    expect(r.body.rows.length).toBeGreaterThan(0);
    expect(r.body.rows.every((s: { branchId: string }) => s.branchId === 'BR-KMT')).toBe(true);
  });

});
