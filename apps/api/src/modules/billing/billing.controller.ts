import { Body, Controller, Get, Inject, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth';
import { AuditService } from '../audit/audit.service';
import { STAFF_ROLES, branchScope, type AuthUser } from '../../common/roles';
import { parse } from '../../common/validation';
import { REPOSITORY, type Repository } from '../../database/repository';

const Page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) });
const Company = z.object({
  legalName: z.string().trim().min(3).max(160),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format').nullable(),
  address: z.string().trim().max(400).nullable(),
  stateCode: z.string().regex(/^\d{2}$/, 'Two-digit GST state code').nullable(),
}).refine((c) => !c.gstin || !c.stateCode || c.gstin.slice(0, 2) === c.stateCode, { message: 'GSTIN does not match the state code', path: ['gstin'] });

@Controller()
export class BillingController {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository, @Inject(AuditService) private readonly audit: AuditService) {}

  // ------------------------------------------------------------ company settings

  @Get('settings/company') @Roles(...STAFF_ROLES)
  company() { return this.repo.getCompany(); }

  @Put('settings/company') @Roles('SUPER_ADMIN')
  async setCompany(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const c = parse(Company, body);
    const before = await this.repo.getCompany();
    const after = await this.repo.setCompany(c, u.id);
    await this.audit.record(u, 'COMPANY.UPDATE', 'company', 'settings', { before: { legalName: before.legalName, gstin: before.gstin }, after: { legalName: after.legalName, gstin: after.gstin } });
    return after;
  }

  // ------------------------------------------------------------ invoices

  @Get('invoices') @Roles(...STAFF_ROLES)
  async invoices(@CurrentUser() u: AuthUser, @Query() q: unknown) {
    const { page, pageSize } = parse(Page, q);
    return { ...(await this.repo.listInvoices({ branchId: branchScope(u), limit: pageSize, offset: (page - 1) * pageSize })), page, pageSize };
  }

  @Get('invoices/:number') @Roles(...STAFF_ROLES)
  async invoice(@CurrentUser() u: AuthUser, @Param('number') number: string) {
    const inv = await this.repo.findInvoice(decodeURIComponent(number), branchScope(u));
    if (!inv) throw new NotFoundException('Invoice not found');
    return { ...inv, company: await this.repo.getCompany() };
  }
}
