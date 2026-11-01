import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../auth/auth';
import { CourierRegistry } from '../couriers/courier-registry';
import { NotificationService } from '../notifications/notifications';
import { REPOSITORY, type Repository } from '../../database/repository';
import { branchScope, INTERNAL_COST_ROLES, type AuthUser } from '../../common/roles';
import { parse } from '../../common/validation';
import { CONFIG, type AppConfig } from '../../config';
import { QuoteSchema, ShipmentsService, dueOf } from '../shipments/shipments.service';
import { z } from 'zod';

@Controller()
export class ReportsController {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(CourierRegistry) private readonly couriers: CourierRegistry,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(ShipmentsService) private readonly shipments: ShipmentsService,
  ) {}

  @Public() @Get('health')
  health() { return { status: 'ok', mode: this.cfg.mode, time: new Date().toISOString() }; }

  /** Partner configuration — credentials are never included. */
  @Get('admin/courier-partners') @Roles('SUPER_ADMIN', 'ADMIN')
  partners() { return this.couriers.list(); }

  /** Allocation preview with full candidate economics (internal). */
  @Post('admin/allocation/preview') @HttpCode(200) @Roles(...INTERNAL_COST_ROLES)
  preview(@Body() body: unknown) {
    const b = parse(QuoteSchema.extend({ mode: z.enum(['MANUAL', 'CHEAPEST', 'RULE_BASED']).default('CHEAPEST'), partnerCode: z.string().optional() }), body);
    return this.shipments.allocate(b, b.mode, b.partnerCode);
  }

  @Get('dashboard') @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BOOKING_STAFF')
  async dashboard(@CurrentUser() u: AuthUser) {
    const { rows } = await this.repo.listShipments({ branchId: branchScope(u), limit: 10_000, offset: 0 });
    const today = new Date().toISOString().slice(0, 10);
    const revenue = rows.reduce((s, x) => s + x.amount, 0);
    const payable = rows.reduce((s, x) => s + (x.allocation?.partnerCost ?? 0), 0);
    const open = rows.filter((s) => s.status !== 'DELIVERED');
    const inTransit = rows.filter((s) => ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY'].includes(s.status)).length;
    const base = {
      totalShipments: rows.length, todaysBookings: rows.filter((s) => s.bookedAt.startsWith(today)).length, inTransit,
      delivered: rows.filter((s) => s.status === 'DELIVERED').length, pendingPickup: rows.filter((s) => s.status === 'BOOKED').length,
      awaitingAllocation: open.filter((s) => !s.allocation).length,
      paymentDueCount: rows.filter((s) => dueOf(s) > 0).length,
      paymentDueAmount: Math.round(rows.reduce((t, s) => t + dueOf(s), 0) * 100) / 100,
      totalRevenue: Math.round(revenue * 100) / 100, sampleData: this.cfg.mode !== 'production',
    };
    if (!INTERNAL_COST_ROLES.includes(u.role)) return base;
    return { ...base, partnerPayable: Math.round(payable * 100) / 100, grossProfit: Math.round((revenue / 1.18 - payable) * 100) / 100 };
  }

  @Get('admin/notifications') @Roles('SUPER_ADMIN', 'ADMIN')
  notificationLog() { return this.notifications.recent; }
}
