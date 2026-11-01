import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { REPOSITORY, type Repository } from '../../database/repository';
import type { AuthUser } from '../../common/roles';
import { parse } from '../../common/validation';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public } from './decorators';
import { LoginThrottle } from './login-throttle';

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
// hash of a random secret, so unknown emails cost the same bcrypt time as wrong passwords
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown) {
    const { email, password } = parse(LoginSchema, body);
    if (this.throttle.isLocked(email)) throw new HttpException('Too many failed attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const u = await this.repo.findUserByEmail(email);
    const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
    if (!u || !ok || !u.active) {
      this.throttle.fail(email);
      throw new UnauthorizedException('Invalid credentials');
    }
    this.throttle.succeed(email);
    const user: AuthUser = { id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branchId };
    await this.audit.record(user, 'AUTH.LOGIN', 'user', u.id);
    return { accessToken: this.jwt.sign(user), user };
  }

  /** Current user, re-read from storage so deactivated accounts are visible immediately. */
  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const fresh = await this.repo.findUserById(u.id);
    if (!fresh || !fresh.active) throw new UnauthorizedException('Account is not active');
    return fresh;
  }
}
