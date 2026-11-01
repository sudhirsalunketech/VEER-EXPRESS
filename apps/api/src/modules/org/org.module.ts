import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

@Module({ imports: [AuditModule], controllers: [OrgController], providers: [OrgService] })
export class OrgModule {}
