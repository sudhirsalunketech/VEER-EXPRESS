import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AggregatorsController, ContactsController, PublicController, ShipmentsController, WebhooksController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [AuditModule],
  controllers: [AggregatorsController, ContactsController, PublicController, ShipmentsController, WebhooksController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
