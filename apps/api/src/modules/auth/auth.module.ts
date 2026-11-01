import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { LoginThrottle } from './login-throttle';

@Module({ imports: [AuditModule], controllers: [AuthController], providers: [LoginThrottle] })
export class AuthModule {}
