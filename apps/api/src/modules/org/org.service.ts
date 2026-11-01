import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { REPOSITORY, DuplicateEmailError, type Repository } from '../../database/repository';
import { GLOBAL_ROLES, ROLES, branchScope, type AuthUser, type Role } from '../../common/roles';
import { parse } from '../../common/validation';
import { AuditService } from '../audit/audit.service';

export const CreateStaffSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().min(2).max(120),
  role: z.enum(ROLES),
  branchId: z.string().max(40).nullable().default(null),
  // at least 10 characters with a letter and a digit
  password: z.string().min(10).max(200).regex(/[A-Za-z]/, 'Password needs a letter').regex(/\d/, 'Password needs a digit'),
});

/**
 * Who may create which role. Branch-level managers can only add booking staff to their own branch;
 * nobody can create a role above their own.
 */
const CAN_CREATE: Record<Role, Role[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BOOKING_STAFF'],
  ADMIN: ['ACCOUNTANT', 'BOOKING_STAFF'],
  ACCOUNTANT: [], BOOKING_STAFF: [], CUSTOMER: [],
};

@Injectable()
export class OrgService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository, @Inject(AuditService) private readonly audit: AuditService) {}

  branches(user: AuthUser) { return this.repo.listBranches(branchScope(user)); }
  staff(user: AuthUser) { return this.repo.listStaff(branchScope(user)); }

  async createStaff(user: AuthUser, body: unknown) {
    const input = parse(CreateStaffSchema, body);
    if (!CAN_CREATE[user.role].includes(input.role)) throw new ForbiddenException(`Your role cannot create ${input.role} accounts`);
    const scope = branchScope(user);
    // branch-scoped creators always create inside their own branch
    const branchId = scope ?? input.branchId;
    const needsBranch = !GLOBAL_ROLES.includes(input.role);
    if (needsBranch && !branchId) throw new BadRequestException('Branch is required for this role');
    if (!needsBranch && input.branchId) throw new BadRequestException(`${input.role} is a company-wide role and cannot be tied to a branch`);
    if (needsBranch && !(await this.repo.branchExists(branchId!))) throw new BadRequestException('Unknown branch');
    try {
      const created = await this.repo.createStaff({
        email: input.email, name: input.name, role: input.role, branchId: needsBranch ? branchId : null,
        passwordHash: await bcrypt.hash(input.password, 10),
      });
      await this.audit.record(user, 'STAFF.CREATE', 'user', created.id, { email: created.email, role: created.role, branchId: created.branchId });
      return created;
    } catch (e) {
      if (e instanceof DuplicateEmailError) throw new ConflictException(e.message);
      throw e;
    }
  }

  async setActive(user: AuthUser, id: string, active: boolean) {
    if (id === user.id) throw new BadRequestException('You cannot change your own account status');
    const target = await this.repo.findUserById(id);
    const scope = branchScope(user);
    // outside the caller's branch looks the same as not existing
    if (!target || (scope && target.branchId !== scope)) throw new NotFoundException('Staff member not found');
    if (!CAN_CREATE[user.role].includes(target.role)) throw new ForbiddenException(`Your role cannot manage ${target.role} accounts`);
    await this.repo.setStaffActive(id, active);
    await this.audit.record(user, active ? 'STAFF.ACTIVATE' : 'STAFF.DEACTIVATE', 'user', id, { email: target.email });
    return { ...target, active };
  }
}
