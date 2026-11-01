import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, Role } from '../../common/roles';

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';
/** Restrict a route or controller to these roles (in addition to requiring a valid JWT). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Opt a route out of authentication. Everything else requires a JWT. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
