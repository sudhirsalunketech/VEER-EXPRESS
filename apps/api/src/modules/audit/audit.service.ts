import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, type Repository } from '../../database/repository';
import type { AuthUser } from '../../common/roles';

/** Single entry point for writing audit records. Audit rows are append-only in the database. */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async record(user: Pick<AuthUser, 'id'> | null, action: string, entity: string, entityId: string, detail?: unknown) {
    await this.repo.audit({ userId: user?.id ?? null, action, entity, entityId, detail });
    this.log.debug(`${action} ${entity}:${entityId} by ${user?.id ?? 'system'}`);
  }
}
