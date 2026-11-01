import { describe, expect, it } from 'vitest';
import { BlueDartProvider } from '../src/modules/couriers/bluedart.provider';
import { TrackonProvider } from '../src/modules/couriers/trackon.provider';
import { GenericCourierProvider } from '../src/modules/couriers/generic.provider';
import { CourierRegistry } from '../src/modules/couriers/courier-registry';
import { RazorpayGateway, SimulatedGateway } from '../src/modules/payments/payment-gateway';
import { createHmac } from 'node:crypto';
import { loadConfig } from '../src/config';

const cfg = { code: 'X', name: 'X', environment: 'TEST' as const, enabled: false, authType: 'API_KEY' as const, statusMap: {} };
const req = { veerTrackingNumber: 'VX2610310000001', service: 'EXPRESS' as const, weightKg: 1, dims: { lengthCm: 1, widthCm: 1, heightCm: 1 }, declaredValue: 0, kind: 'PARCEL' as const, sender: { name: 'a', phone: '9', address: 'a', pin: '411001' }, receiver: { name: 'b', phone: '9', address: 'b', pin: '110001' } };

describe('courier adapters', () => {
  it('unconfigured real-partner adapters fall back to manual AWB instead of pretending to book', async () => {
    for (const P of [BlueDartProvider, TrackonProvider]) {
      const p = new P(cfg);
      expect(p.capabilities().booking).toBe(false);
      expect(await p.createShipment(req)).toEqual({ partnerAwb: null, requiresManualAwb: true });
    }
  });
  it('configured endpoints without implemented mappings refuse to run', async () => {
    const p = new BlueDartProvider({ ...cfg, apiBaseUrl: 'https://partner.invalid', endpoints: { booking: '/b' }, credentials: { k: 'v' } });
    await expect(p.createShipment(req)).rejects.toThrow(/not configured/);
  });
  it('generic provider requires manual AWB', async () => {
    expect((await new GenericCourierProvider(cfg).createShipment()).requiresManualAwb).toBe(true);
  });
  it('normalises partner statuses with per-partner overrides', () => {
    const r = new CourierRegistry();
    r.register({ ...cfg, code: 'P', statusMap: { 'SHIPMENT DELIVERED': 'DELIVERED' } }, 'GenericCourierProvider');
    expect(r.normalize('P', 'ofd')).toBe('OUT_FOR_DELIVERY');
    expect(r.normalize('P', 'shipment delivered')).toBe('DELIVERED');
    expect(r.normalize('P', '???')).toBeNull();
  });
});

describe('payments', () => {
  it('Razorpay signature verification', () => {
    const g = new RazorpayGateway('rzp_test_x', 'secret');
    const signature = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(g.verifyPayment({ orderId: 'order_1', paymentId: 'pay_1', signature })).toBe(true);
    expect(g.verifyPayment({ orderId: 'order_1', paymentId: 'pay_2', signature })).toBe(false);
  });
  it('simulated gateway never claims a real capture', async () => {
    const o = await new SimulatedGateway().createOrder(100);
    expect(o.gateway).toBe('SIMULATED');
  });
});

describe('config', () => {
  it('production refuses weak/missing secrets', () => {
    expect(() => loadConfig({ APP_MODE: 'production' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ APP_MODE: 'production', JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/);
  });
});
