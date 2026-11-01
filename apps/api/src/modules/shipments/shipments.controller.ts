import { Body, Controller, Inject, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { UNIFIED_STATUSES } from '@veer/core';
import { z } from 'zod';
import { CurrentUser, Public, Roles } from '../auth/auth';
import { STAFF_ROLES, branchScope, type AuthUser } from '../../common/roles';
import { parse } from '../../common/validation';
import { REPOSITORY, type Repository } from '../../database/repository';
import { AllocationSchema, BookingSchema, CollectionSchema, QuoteSchema, ShipmentsService, TrackingUpdateSchema } from './shipments.service';

/** Operations staff who book in the aggregator account and keep tracking up to date. */
const OPS_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;
/** Anyone at a counter may take money for their own branch. */
const COUNTER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BOOKING_STAFF'] as const;

const ListQuery = z.object({
  status: z.enum(UNIFIED_STATUSES).optional(), q: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Customer-facing endpoints. Responses never include partner name, partner AWB, partner cost or margin. */
@Controller('public')
export class PublicController {
  constructor(@Inject(ShipmentsService) private readonly svc: ShipmentsService) {}

  @Public() @Post('quote') @HttpCode(200)
  quote(@Body() body: unknown) { return this.svc.quotePublic(parse(QuoteSchema, body)); }

  @Public() @Post('payment-orders')
  order(@Body() body: unknown) { return this.svc.createPaymentOrder(parse(QuoteSchema, body)); }

  @Public() @Post('bookings')
  book(@Body() body: unknown) { return this.svc.book(parse(BookingSchema, body), null); }

  @Public() @Get('track/:tn')
  track(@Param('tn') tn: string) { return this.svc.trackPublic(tn); }
}

@Controller('shipments')
@Roles(...STAFF_ROLES)
export class ShipmentsController {
  constructor(@Inject(ShipmentsService) private readonly svc: ShipmentsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: unknown) { return this.svc.list(u, parse(ListQuery, q)); }
  // queue routes are declared before ':tn' so they are not read as tracking numbers
  @Get('queues/allocation') @Roles(...OPS_ROLES) allocationQueue(@CurrentUser() u: AuthUser) { return this.svc.allocationQueue(u); }
  @Get('queues/tracking') @Roles(...OPS_ROLES) trackingQueue(@CurrentUser() u: AuthUser) { return this.svc.trackingQueue(u); }
  @Get(':tn') get(@CurrentUser() u: AuthUser, @Param('tn') tn: string) { return this.svc.getInternal(u, tn); }
  @Post() book(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.book(parse(BookingSchema, body), u); }

  @Post(':tn/allocation') @HttpCode(200) @Roles(...OPS_ROLES)
  allocate(@CurrentUser() u: AuthUser, @Param('tn') tn: string, @Body() body: unknown) { return this.svc.allocateCourier(u, tn, parse(AllocationSchema, body)); }

  @Post(':tn/tracking') @Roles(...OPS_ROLES)
  track(@CurrentUser() u: AuthUser, @Param('tn') tn: string, @Body() body: unknown) { return this.svc.recordTracking(u, tn, parse(TrackingUpdateSchema, body)); }

  @Post(':tn/payments') @Roles(...COUNTER_ROLES)
  collect(@CurrentUser() u: AuthUser, @Param('tn') tn: string, @Body() body: unknown) { return this.svc.collect(u, tn, parse(CollectionSchema, body)); }
}

/** Branch address book for counter staff. Never public: it holds customers' phone numbers and addresses. */
@Controller('contacts')
export class ContactsController {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}
  @Get() @Roles(...COUNTER_ROLES)
  search(@CurrentUser() u: AuthUser, @Query() q: unknown) {
    const { q: term } = parse(z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(60) }), q);
    return this.repo.searchContacts(branchScope(u), term, 8);
  }
}

@Controller('aggregators')
export class AggregatorsController {
  constructor(@Inject(ShipmentsService) private readonly svc: ShipmentsService) {}
  @Get() @Roles(...OPS_ROLES) list() { return this.svc.listAggregators(); }
}

@Controller('webhooks/couriers')
export class WebhooksController {
  constructor(@Inject(ShipmentsService) private readonly svc: ShipmentsService) {}

  @Public() @Post(':partner') @HttpCode(200)
  receive(@Param('partner') partner: string, @Headers() headers: Record<string, string>, @Body() body: unknown) {
    return this.svc.handleWebhook(partner.toUpperCase(), headers, body);
  }
}
