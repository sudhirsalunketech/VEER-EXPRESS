import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ReportsController } from './reports.controller';

@Module({ imports: [ShipmentsModule], controllers: [ReportsController] })
export class ReportsModule {}
