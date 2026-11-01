import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { loadConfig, type AppConfig } from './config';
import { CoreModule } from './core.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrgModule } from './modules/org/org.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { BillingModule } from './modules/billing/billing.module';
import { PincodesModule } from './modules/pincodes/pincodes.module';

/**
 * Modular monolith: one deployable app, one database, and one Nest module per business area.
 * Modules talk to each other only through exported services (e.g. AuditService, ShipmentsService).
 */
@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(cfg), AuthModule, AuditModule, OrgModule, ShipmentsModule, LedgerModule, BillingModule, PincodesModule, ReportsModule],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
