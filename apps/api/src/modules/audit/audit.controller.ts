import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { REPOSITORY, type Repository } from '../../database/repository';
import { parse } from '../../common/validation';
import { Roles } from '../auth/decorators';

const AuditQuery = z.object({
  entity: z.string().max(40).optional(), action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Company-wide audit trail — not available to branch-scoped roles. */
@Controller('audit')
@Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
export class AuditController {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  @Get()
  async list(@Query() q: unknown) {
    const { entity, action, page, pageSize } = parse(AuditQuery, q);
    const { rows, total } = await this.repo.listAudit({ entity, action, limit: pageSize, offset: (page - 1) * pageSize });
    return { rows, total, page, pageSize };
  }
}
