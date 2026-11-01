import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface CreateOrderResult { orderId: string; amount: number; currency: 'INR'; gateway: 'SIMULATED' | 'RAZORPAY'; publicKeyId?: string }
export interface PaymentGateway {
  readonly name: 'SIMULATED' | 'RAZORPAY';
  createOrder(amountInr: number, receipt: string): Promise<CreateOrderResult>;
  /** Verify the checkout callback signature server-side. Card data never touches our servers. */
  verifyPayment(p: { orderId: string; paymentId: string; signature: string }): boolean;
}

/** DEMO gateway. Never moves money. Results are marked SIMULATED in the payments table. */
export class SimulatedGateway implements PaymentGateway {
  readonly name = 'SIMULATED' as const;
  async createOrder(amount: number) { return { orderId: `sim_order_${randomUUID().slice(0, 12)}`, amount, currency: 'INR' as const, gateway: this.name }; }
  verifyPayment(p: { orderId: string; signature: string }) { return p.signature === `simulated:${p.orderId}`; }
}

/**
 * Razorpay architecture. Orders are created server-side with the key secret (env only);
 * the browser receives only order_id + public key_id and opens Razorpay Checkout.
 * NOT ACTIVE until keys are provided and verified in Razorpay test mode.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'RAZORPAY' as const;
  constructor(private readonly keyId: string, private readonly keySecret: string) {}

  async createOrder(amountInr: number, receipt: string): Promise<CreateOrderResult> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64') },
      body: JSON.stringify({ amount: Math.round(amountInr * 100), currency: 'INR', receipt }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Razorpay order creation failed (HTTP ${res.status})`);
    const j = (await res.json()) as { id: string };
    return { orderId: j.id, amount: amountInr, currency: 'INR', gateway: this.name, publicKeyId: this.keyId };
  }

  /** Razorpay standard checkout signature: HMAC_SHA256(order_id|payment_id, key_secret). */
  verifyPayment(p: { orderId: string; paymentId: string; signature: string }) {
    const expected = createHmac('sha256', this.keySecret).update(`${p.orderId}|${p.paymentId}`).digest('hex');
    return expected.length === p.signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(p.signature));
  }
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
