import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, Role } from '../../common/roles';
import { REPOSITORY, type Repository } from '../../database/repository';
import { PUBLIC_KEY, ROLES_KEY } from './decorators';

/** Global guard: a valid JWT is required unless the route is @Public(); @Roles() narrows further. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REPOSITORY) private readonly repo: Repository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Missing bearer token');
    try { req.user = this.jwt.verify<AuthUser>(token); } catch { throw new UnauthorizedException('Invalid or expired token'); }
    // deactivation takes effect immediately, not when the token expires
    const current = await this.repo.findUserById(req.user.id);
    if (!current?.active) throw new UnauthorizedException('Account is not active');
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
