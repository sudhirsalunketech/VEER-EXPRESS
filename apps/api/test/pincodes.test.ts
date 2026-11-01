/** PIN lookup: local directory → India Post service → graceful "unknown". The outside service is stubbed. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';
import { PincodeService } from '../src/modules/pincodes/pincode.service';
import { parseCsv, toRows } from '../scripts/import-pincodes';

const indiaPost = (offices: object[] | null) => new Response(JSON.stringify([{ Status: offices ? 'Success' : 'Error', PostOffice: offices }]), { status: 200 });
const ANDHERI = [
  { Name: 'Andheri ', BranchType: 'Head Post Office', DeliveryStatus: 'Delivery', District: 'Mumbai', State: 'Maharashtra' },
  { Name: 'Azad Nagar', BranchType: 'Sub Post Office', DeliveryStatus: 'Delivery', District: 'Mumbai', State: 'Maharashtra' },
];

const targets = [
  { name: 'memory', env: { APP_MODE: 'demo' } },
  ...(process.env.TEST_DATABASE_URL ? [{ name: 'postgres', env: { APP_MODE: 'development', DATABASE_URL: process.env.TEST_DATABASE_URL } }] : []),
];

describe.each(targets)('PIN lookup ($name)', ({ name, env }) => {
  let app: INestApplication; let svc: PincodeService; let calls: string[] = [];
  let next: () => Promise<Response> = async () => indiaPost(ANDHERI);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig(env))] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.init();
    svc = app.get(PincodeService);
    svc.fetcher = (async (url: string) => { calls.push(String(url)); return next(); }) as typeof fetch;
  });
  afterAll(() => app.close());

  it('rejects malformed PINs', async () => {
    await http().get('/api/v1/public/pincodes/012345').expect(400);
    await http().get('/api/v1/public/pincodes/12ab56').expect(400);
  });

  it('returns area, district and state from India Post, then serves it from cache', async () => {
    calls = []; next = async () => indiaPost(ANDHERI);
    const r = (await http().get('/api/v1/public/pincodes/400053').expect(200)).body;
    expect(r).toMatchObject({ pin: '400053', found: true, label: 'Andheri, Mumbai', district: 'Mumbai', state: 'Maharashtra', deliverable: true, source: 'INDIA_POST' });
    expect(r.areas).toEqual(['Andheri', 'Azad Nagar']);
    await http().get('/api/v1/public/pincodes/400053').expect(200);
    expect(calls).toHaveLength(1);
  });

  it('a PIN India Post does not know is "not found", not an error', async () => {
    next = async () => indiaPost(null);
    expect((await http().get('/api/v1/public/pincodes/999999').expect(200)).body).toMatchObject({ found: false, unverified: false, source: 'NONE' });
  });

  it('when the service is down the PIN is "unverified" and is retried next time', async () => {
    calls = []; next = async () => { throw new Error('network down'); };
    expect((await http().get('/api/v1/public/pincodes/302001').expect(200)).body).toMatchObject({ found: false, unverified: true });
    next = async () => indiaPost([{ Name: 'Jaipur G.P.O.', BranchType: 'Head Post Office', DeliveryStatus: 'Delivery', District: 'Jaipur', State: 'Rajasthan' }]);
    expect((await http().get('/api/v1/public/pincodes/302001').expect(200)).body).toMatchObject({ found: true, state: 'Rajasthan' });
    expect(calls).toHaveLength(2);
  });

  it.runIf(name === 'postgres')('the local directory wins over the outside service', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await pool.query(`insert into pincode_directory (pin, office_name, office_type, district, state) values ('410209', 'Kamothe', 'SO', 'Raigad', 'Maharashtra')
                        on conflict do nothing`);
      calls = [];
      expect((await http().get('/api/v1/public/pincodes/410209').expect(200)).body).toMatchObject({ found: true, label: 'Kamothe, Raigad', source: 'LOCAL_DIRECTORY' });
      expect(calls).toHaveLength(0);
    } finally { await pool.end(); }
  });
});

describe('India Post CSV import', () => {
  it('parses the data.gov.in directory format', () => {
    const csv = 'circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename\n'
      + 'Maharashtra Circle,Navi Mumbai,Navi Mumbai,"Kamothe S.O",410209,SO,Delivery,RAIGAD,MAHARASHTRA\r\n'
      + 'X,Y,Z,Bad Row,01234,BO,Delivery,A,B\n'
      + 'X,Y,Z,"Panvel, H.O",410206,HO,Non-Delivery,RAIGAD,MAHARASHTRA\n';
    expect(toRows(parseCsv(csv))).toEqual([
      { pin: '410209', name: 'Kamothe', type: 'SO', delivery: true, district: 'Raigad', state: 'Maharashtra' },
      { pin: '410206', name: 'Panvel', type: 'HO', delivery: false, district: 'Raigad', state: 'Maharashtra' },
    ]);
  });
});
