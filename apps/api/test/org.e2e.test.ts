/** Auth, org (branches & staff) and audit modules — run against memory storage, and Postgres when available. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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

describe.each(targets)('auth / org / audit ($name)', ({ env }) => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const login = async (email: string, password = 'Demo@123') => (await http().post('/api/v1/auth/login').send({ email, password })).body.accessToken as string;
  const as = (tok: string) => ({ authorization: `Bearer ${tok}` });
  const uniq = () => `t${randomUUID().slice(0, 8)}@demo.veer`;
  const STRONG = 'Str0ngPassw0rd';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig(env))] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
  });
  afterAll(() => app.close());

  describe('auth', () => {
    it('returns the current user', async () => {
      const r = await http().get('/api/v1/auth/me').set(as(await login('staff@demo.veer'))).expect(200);
      expect(r.body).toMatchObject({ email: 'staff@demo.veer', role: 'BOOKING_STAFF', branchId: 'BR-KMT', active: true });
      expect(r.body).not.toHaveProperty('passwordHash');
    });

    it('locks an email after 5 failed attempts, even for the right password', async () => {
      const email = uniq();
      const tok = await login('superadmin@demo.veer');
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email, name: 'Lock Test', role: 'ACCOUNTANT', password: STRONG }).expect(201);
      for (let i = 0; i < 5; i++) await http().post('/api/v1/auth/login').send({ email, password: 'wrong-password' }).expect(401);
      await http().post('/api/v1/auth/login').send({ email, password: STRONG }).expect(429);
    });
  });

  describe('staff management', () => {
    it('admin adds counter staff to the Kamothe branch', async () => {
      const r = await http().post('/api/v1/org/staff').set(as(await login('admin@demo.veer'))).send({ email: uniq(), name: 'Kamothe Counter', role: 'BOOKING_STAFF', branchId: 'BR-KMT', password: STRONG }).expect(201);
      expect(r.body).toMatchObject({ role: 'BOOKING_STAFF', branchId: 'BR-KMT', active: true });
    });

    it('nobody can create a role above their own; franchise roles no longer exist', async () => {
      const admin = await login('admin@demo.veer');
      await http().post('/api/v1/org/staff').set(as(admin)).send({ email: uniq(), name: 'X Y', role: 'SUPER_ADMIN', password: STRONG }).expect(403);
      await http().post('/api/v1/org/staff').set(as(admin)).send({ email: uniq(), name: 'X Y', role: 'FRANCHISE_OWNER', branchId: 'BR-KMT', password: STRONG }).expect(400);
      await http().post('/api/v1/org/staff').set(as(admin)).send({ email: uniq(), name: 'X Y', role: 'BRANCH_MANAGER', branchId: 'BR-KMT', password: STRONG }).expect(400);
      const staff = await login('staff@demo.veer');
      await http().post('/api/v1/org/staff').set(as(staff)).send({ email: uniq(), name: 'X Y', role: 'BOOKING_STAFF', password: STRONG }).expect(403);
      const accounts = await login('accounts@demo.veer');
      await http().post('/api/v1/org/staff').set(as(accounts)).send({ email: uniq(), name: 'X Y', role: 'BOOKING_STAFF', password: STRONG }).expect(403);
    });

    it('validates branch rules, password strength and duplicate emails', async () => {
      const tok = await login('superadmin@demo.veer');
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email: uniq(), name: 'No Branch', role: 'BOOKING_STAFF', password: STRONG }).expect(400);
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email: uniq(), name: 'Global', role: 'ACCOUNTANT', branchId: 'BR-KMT', password: STRONG }).expect(400);
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email: uniq(), name: 'Bad Branch', role: 'BOOKING_STAFF', branchId: 'BR-XXX', password: STRONG }).expect(400);
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email: uniq(), name: 'Weak', role: 'ACCOUNTANT', password: 'short1' }).expect(400);
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email: 'staff@demo.veer', name: 'Dup', role: 'ACCOUNTANT', password: STRONG }).expect(409);
    });

    it('only admins manage staff', async () => {
      await http().get('/api/v1/org/staff').set(as(await login('admin@demo.veer'))).expect(200);
      await http().get('/api/v1/org/staff').set(as(await login('staff@demo.veer'))).expect(403);
      await http().get('/api/v1/org/staff').set(as(await login('accounts@demo.veer'))).expect(403);
    });

    it('deactivation takes effect immediately and blocks login', async () => {
      const admin = await login('admin@demo.veer');
      const email = uniq();
      const created = await http().post('/api/v1/org/staff').set(as(admin)).send({ email, name: 'Temp Staff', role: 'BOOKING_STAFF', branchId: 'BR-KMT', password: STRONG }).expect(201);
      const staffTok = await login(email, STRONG);
      await http().get('/api/v1/auth/me').set(as(staffTok)).expect(200);
      await http().post(`/api/v1/org/staff/${created.body.id}/deactivate`).set(as(admin)).expect(200);
      await http().get('/api/v1/auth/me').set(as(staffTok)).expect(401);      // existing token rejected
      await http().get('/api/v1/shipments').set(as(staffTok)).expect(401);
      await http().post('/api/v1/auth/login').send({ email, password: STRONG }).expect(401);
      await http().post(`/api/v1/org/staff/${created.body.id}/activate`).set(as(admin)).expect(200);
      await http().post('/api/v1/auth/login').send({ email, password: STRONG }).expect(200);
    });

    it('cannot deactivate your own account', async () => {
      const admin = await login('superadmin@demo.veer');
      const me = (await http().get('/api/v1/auth/me').set(as(admin))).body;
      await http().post(`/api/v1/org/staff/${me.id}/deactivate`).set(as(admin)).expect(400);
    });

    it('there is one branch: Kamothe', async () => {
      const r = await http().get('/api/v1/org/branches').set(as(await login('admin@demo.veer'))).expect(200);
      expect(r.body).toEqual([expect.objectContaining({ id: 'BR-KMT' })]);
    });
  });

  describe('audit', () => {
    it('records staff changes and logins; readable only by company-wide roles', async () => {
      const tok = await login('superadmin@demo.veer');
      const email = uniq();
      await http().post('/api/v1/org/staff').set(as(tok)).send({ email, name: 'Audit Me', role: 'ACCOUNTANT', password: STRONG }).expect(201);
      const r = await http().get('/api/v1/audit?action=STAFF.CREATE&pageSize=200').set(as(tok)).expect(200);
      expect(r.body.rows.some((a: { detail: { email?: string } }) => a.detail?.email === email)).toBe(true);
      const logins = await http().get('/api/v1/audit?action=AUTH.LOGIN').set(as(tok)).expect(200);
      expect(logins.body.total).toBeGreaterThan(0);
      await http().get('/api/v1/audit').set(as(await login('staff@demo.veer'))).expect(403);
    });
  });
});
