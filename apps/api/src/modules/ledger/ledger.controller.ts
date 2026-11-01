import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth';
import { INTERNAL_COST_ROLES, type AuthUser } from '../../common/roles';
import { parse } from '../../common/validation';
import { REPOSITORY, type Repository } from '../../database/repository';

const LedgerQuery = z.object({
  branchId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Read-only view of the append-only ledger. Contains courier costs, so company-wide finance roles only. */
@Controller('ledger')
@Roles(...INTERNAL_COST_ROLES)
export class LedgerController {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  @Get()
  async list(@CurrentUser() _u: AuthUser, @Query() q: unknown) {
    const { branchId = null, page, pageSize } = parse(LedgerQuery, q);
    const [{ rows, total }, accounts] = await Promise.all([
      this.repo.listLedger({ branchId, limit: pageSize, offset: (page - 1) * pageSize }),
      this.repo.trialBalance(branchId),
    ]);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const debit = r2(accounts.reduce((s, a) => s + a.debit, 0));
    const credit = r2(accounts.reduce((s, a) => s + a.credit, 0));
    return {
      rows, total, page, pageSize,
      trialBalance: { accounts: accounts.map((a) => ({ ...a, balance: r2(a.debit - a.credit) })), debit, credit, balanced: Math.abs(debit - credit) < 0.01 },
    };
  }
}
