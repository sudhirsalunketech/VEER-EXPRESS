/** Optional e-mail (bill + tracking) and the branch address book used for auto-fill at the counter. */
import 'reflect-metadata';
import { randomInt } from 'node:crypto';
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

describe.each(targets)('e-mail & address book ($name)', ({ env }) => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
  const uniqueName = () => `Zeta Customer ${randomInt(1e5, 9e5)}`;
  const phone = () => `9${randomInt(100000000, 999999999)}`;
  const booking = (sender: object, receiver: object = { name: 'Rx Person', phone: '9800000022', address: '12 Connaught Place, New Delhi' }) => ({
    originPin: '411001', destPin: '110001', actualWeightKg: 1, dims: { lengthCm: 10, widthCm: 10, heightCm: 10 }, service: 'EXPRESS',
    kind: 'PARCEL', originCity: 'Pune', destCity: 'New Delhi', paymentMode: 'COUNTER', sender, receiver,
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig(env))] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
    for (const [k, email] of Object.entries({ counter: 'staff@demo.veer', admin: 'superadmin@demo.veer', accounts: 'accounts@demo.veer' })) {
      tok[k] = (await http().post('/api/v1/auth/login').send({ email, password: 'Demo@123' }).expect(200)).body.accessToken;
    }
  });
  afterAll(() => app.close());

  describe('e-mail', () => {
    it('is optional, validated, and reported honestly as simulated', async () => {
      const sender = { name: 'Mail Sender', phone: '9800000011', address: 'Shop 4, FC Road, Pune' };
      const none = (await http().post('/api/v1/public/bookings').send(booking(sender)).expect(201)).body;
      expect(none).toMatchObject({ emailStatus: 'NONE', emailTo: null });
      const blank = (await http().post('/api/v1/public/bookings').send(booking({ ...sender, email: '' })).expect(201)).body;
      expect(blank.emailStatus).toBe('NONE');
      await http().post('/api/v1/public/bookings').send(booking({ ...sender, email: 'not-an-email' })).expect(400);

      const r = (await http().post('/api/v1/public/bookings').send(booking({ ...sender, email: 'Customer@Example.com' })).expect(201)).body;
      expect(r).toMatchObject({ emailStatus: 'SIMULATED', emailTo: 'customer@example.com' });
      const log = (await http().get('/api/v1/admin/notifications').set(as('admin')).expect(200)).body;
      const mail = log.find((n: { channel: string; body: string }) => n.channel === 'EMAIL' && n.body.includes(r.trackingNumber));
      expect(mail).toMatchObject({ status: 'SIMULATED', to: 'c***@example.com', template: 'booking_email' });
      expect(mail.body).toContain(r.invoiceNumber);
      expect(mail.body).toContain(`/track?tn=${r.trackingNumber}`);
    });
  });

  describe('address book', () => {
    it('saves sender and receiver from a booking and finds them by name or mobile', async () => {
      const name = uniqueName(); const ph = phone();
      await http().post('/api/v1/shipments').set(as('counter')).send(booking({ name, phone: ph, address: '22 Sector 18, Kamothe', email: 'zeta@example.com' })).expect(201);
      const byName = (await http().get(`/api/v1/contacts?q=${encodeURIComponent(name.split(' ')[1])}`).set(as('counter')).expect(200)).body;
      expect(byName.find((c: { name: string }) => c.name === name)).toMatchObject({ phone: ph, email: 'zeta@example.com', address: '22 Sector 18, Kamothe', pin: '411001' });
      const byPhone = (await http().get(`/api/v1/contacts?q=${ph.slice(0, 6)}`).set(as('counter')).expect(200)).body;
      expect(byPhone.some((c: { name: string }) => c.name === name)).toBe(true);
      const rx = (await http().get('/api/v1/contacts?q=Rx').set(as('counter')).expect(200)).body;
      expect(rx.some((c: { name: string; pin: string }) => c.name === 'Rx Person' && c.pin === '110001')).toBe(true);
    });

    it('repeat customers keep one entry with the latest address', async () => {
      const name = uniqueName(); const ph = phone();
      await http().post('/api/v1/shipments').set(as('counter')).send(booking({ name, phone: ph, address: 'Old address, Kamothe' })).expect(201);
      await http().post('/api/v1/shipments').set(as('counter')).send(booking({ name, phone: ph, address: 'New address, Kamothe' })).expect(201);
      const hits = (await http().get(`/api/v1/contacts?q=${encodeURIComponent(name)}`).set(as('counter'))).body.filter((c: { name: string }) => c.name === name);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ address: 'New address, Kamothe', useCount: 2 });
    });

    it('is staff-only and never public', async () => {
      const name = uniqueName();
      await http().post('/api/v1/shipments').set(as('counter')).send(booking({ name, phone: phone(), address: 'Private address, Kamothe' })).expect(201);
      const q = `/api/v1/contacts?q=${encodeURIComponent(name)}`;
      await http().get(q).expect(401);                                                // public
      await http().get(q).set(as('accounts')).expect(403);                             // not a counter role
      await http().get('/api/v1/contacts?q=a').set(as('counter')).expect(400);            // too short to search
    });
  });
});
