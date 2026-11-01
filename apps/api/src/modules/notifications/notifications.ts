import { Injectable, Logger } from '@nestjs/common';

export type Channel = 'WHATSAPP' | 'SMS' | 'EMAIL';
export type TemplateKey = 'booking_confirmation' | 'booking_email' | 'payment_confirmation' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delivery_exception';

/** Customer-facing templates. Only Veer branding + Veer tracking number — never partner names/AWBs. */
export const TEMPLATES: Record<TemplateKey, string> = {
  booking_confirmation: 'Hi {{name}}, your Veer Express shipment {{tn}} to {{dest}} is booked. Track: {{trackUrl}}',
  booking_email: 'Subject: Your Veer Express booking {{tn}} — invoice {{invoice}}\n\nHi {{name}},\n\nYour shipment {{tn}} from {{origin}} to {{dest}} is booked.\nInvoice: {{invoice}} · Amount: Rs {{amount}} · Payment: {{payment}}\nTrack your shipment: {{trackUrl}}\n\nThank you for choosing Veer Express.',
  payment_confirmation: 'Payment of Rs {{amount}} received for Veer Express shipment {{tn}}. Thank you!',
  picked_up: 'Your Veer Express shipment {{tn}} has been picked up.',
  in_transit: 'Your Veer Express shipment {{tn}} is in transit to {{dest}}.',
  out_for_delivery: 'Your Veer Express shipment {{tn}} is out for delivery today.',
  delivered: 'Your Veer Express shipment {{tn}} has been delivered. Thank you for choosing Veer Express!',
  delivery_exception: 'We could not deliver Veer Express shipment {{tn}}: {{reason}}. We will re-attempt. Need help? {{support}}',
};

export function render(key: TemplateKey, vars: Record<string, string>) {
  return TEMPLATES[key].replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export interface NotificationAdapter { readonly channel: Channel; readonly live: boolean; send(to: string, body: string): Promise<{ providerRef: string | null }> }

/** Demo adapter — logs, sends nothing. WhatsApp (e.g. Meta Cloud API / BSP), SMS (DLT-registered provider) and email (SMTP/API) adapters plug in here. */
export class SimulatedAdapter implements NotificationAdapter {
  readonly live = false;
  constructor(readonly channel: Channel) {}
  async send() { return { providerRef: null }; }
}

export interface NotificationLogEntry { at: string; channel: Channel; to: string; template: TemplateKey; body: string; status: 'SIMULATED' | 'SENT' | 'FAILED' }

@Injectable()
export class NotificationService {
  private readonly log = new Logger('Notifications');
  readonly recent: NotificationLogEntry[] = [];
  constructor(private readonly adapters: NotificationAdapter[] = (['WHATSAPP', 'SMS', 'EMAIL'] as Channel[]).map((c) => new SimulatedAdapter(c))) {}

  /** Returns the outcome per channel so callers can tell the user honestly what happened. */
  async notify(channels: Channel[], to: string, template: TemplateKey, vars: Record<string, string>): Promise<NotificationLogEntry['status'][]> {
    const body = render(template, vars);
    const out: NotificationLogEntry['status'][] = [];
    for (const ch of channels) {
      const a = this.adapters.find((x) => x.channel === ch);
      if (!a) continue;
      let status: NotificationLogEntry['status'] = a.live ? 'SENT' : 'SIMULATED';
      try { await a.send(to, body); } catch (e) { status = 'FAILED'; this.log.warn(`${ch} send failed: ${(e as Error).message}`); }
      const masked = ch === 'EMAIL' ? to.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : to.replace(/\d(?=\d{2})/g, 'x');
      this.recent.unshift({ at: new Date().toISOString(), channel: ch, to: masked, template, body, status });
      out.push(status);
    }
    this.recent.splice(100);
    return out;
  }
}
