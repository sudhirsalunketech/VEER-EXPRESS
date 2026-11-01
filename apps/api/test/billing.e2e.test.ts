/** Invoices and company GST settings (single branch: Kamothe). */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';

const targets = [
  { name: 'memory', env: { APP_MODE: 'demo' } },
  ...(process.env.TEST_DATABASE_URL ? [{ name: 'postgres', env: { APP_MODE: 'development', DATABASE_URL: process.env.TEST_DATABASE_URL } }] : []),
];
const booking = {
  originPin: '411001', destPin: '110001', actualWeightKg: 1.5, dims: { lengthCm: 30, widthCm: 25, heightCm: 15 }, service: 'EXPRESS',
  declaredValue: 2500, insurance: false, kind: 'PARCEL', originCity: 'Pune', destCity: 'New Delhi', paymentMode: 'COUNTER',
  sender: { name: 'Bill Sender', phone: '9800000011', address: 'Shop 4, FC Road, Pune' }, receiver: { name: 'Bill Receiver', phone: '9800000022', address: '12 Connaught Place, New Delhi' },
};

describe.each(targets)('billing ($name)', ({ env }) => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
  const book = async () => (await http().post('/api/v1/shipments').set(as('counter')).send(booking).expect(201)).body;
  const invoiceUrl = (n: string) => `/api/v1/invoices/${encodeURIComponent(n)}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig(env))] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
    for (const [k, email] of Object.entries({ super: 'superadmin@demo.veer', admin: 'admin@demo.veer', accounts: 'accounts@demo.veer', counter: 'staff@demo.veer' })) {
      tok[k] = (await http().post('/api/v1/auth/login').send({ email, password: 'Demo@123' }).expect(200)).body.accessToken;
    }
  });
  afterAll(async () => {
    await http().put('/api/v1/settings/company').set(as('super')).send({ legalName: 'Veer Express Courier', gstin: null, address: null, stateCode: null });
    await app.close();
  });

  describe('invoices', () => {
    it('every booking gets a gapless company-wide invoice number', async () => {
      const a = await book(); const b = await book();
      expect(a.invoiceNumber).toMatch(/^VX\/\d{2}-\d{2}\/\d{5}$/);
      expect(Number(b.invoiceNumber.slice(-5))).toBe(Number(a.invoiceNumber.slice(-5)) + 1);
      const inv = (await http().get(invoiceUrl(a.invoiceNumber)).set(as('counter')).expect(200)).body;
      expect(inv).toMatchObject({ trackingNumber: a.trackingNumber, branchId: 'BR-KMT', total: a.quote.total, igst: 0 });
      expect(inv.taxable + inv.cgst + inv.sgst).toBeCloseTo(inv.total, 2);
      expect(inv.customer).toMatchObject({ name: 'Bill Sender' });
    });

    it('is not a tax invoice until a GSTIN is configured', async () => {
      await http().put('/api/v1/settings/company').set(as('super')).send({ legalName: 'Veer Express Courier', gstin: null, address: null, stateCode: null }).expect(200);
      const a = await book();
      expect((await http().get(invoiceUrl(a.invoiceNumber)).set(as('counter'))).body).toMatchObject({ isTaxInvoice: false, sellerGstin: null });
    });

    it('company GST settings: Super Admin only, validated, and applied to new invoices', async () => {
      const body = { legalName: 'Veer Express Courier (test)', gstin: '27ABCDE1234F1Z5', address: 'Shop 11, Kamothe', stateCode: '27' };
      await http().put('/api/v1/settings/company').set(as('counter')).send(body).expect(403);
      await http().put('/api/v1/settings/company').set(as('admin')).send(body).expect(403);
      await http().put('/api/v1/settings/company').set(as('super')).send({ ...body, gstin: 'NOT-A-GSTIN' }).expect(400);
      await http().put('/api/v1/settings/company').set(as('super')).send({ ...body, stateCode: '29' }).expect(400);
      await http().put('/api/v1/settings/company').set(as('super')).send(body).expect(200);
      const a = await book();
      expect((await http().get(invoiceUrl(a.invoiceNumber)).set(as('counter'))).body).toMatchObject({ isTaxInvoice: true, sellerGstin: '27ABCDE1234F1Z5', sellerLegalName: 'Veer Express Courier (test)' });
    });

  });
});
