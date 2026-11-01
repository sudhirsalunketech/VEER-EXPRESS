import { Global, Module, type DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CONFIG, type AppConfig } from './config';
import { REPOSITORY } from './database/repository';
import { MemoryRepository } from './database/memory.repository';
import { PgRepository } from './database/pg.repository';
import { CourierRegistry } from './modules/couriers/courier-registry';
import { PAYMENT_GATEWAY, RazorpayGateway, SimulatedGateway } from './modules/payments/payment-gateway';
import { NotificationService } from './modules/notifications/notifications';

/**
 * Shared infrastructure for every module: configuration, storage, JWT, and the external-service
 * adapters (courier, payment, notification). Feature modules depend on these through tokens only.
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const repo = cfg.mode === 'demo' || !cfg.databaseUrl ? new MemoryRepository() : PgRepository.fromUrl(cfg.databaseUrl);
    const gateway = cfg.mode === 'production' && cfg.razorpay ? new RazorpayGateway(cfg.razorpay.keyId, cfg.razorpay.keySecret) : new SimulatedGateway();
    const providers = [
      { provide: CONFIG, useValue: cfg },
      { provide: REPOSITORY, useValue: repo },
      // Partner registry is still the demo set; Milestone 3 loads aggregators/couriers from the database.
      { provide: CourierRegistry, useValue: CourierRegistry.demo() },
      { provide: PAYMENT_GATEWAY, useValue: gateway },
      { provide: NotificationService, useValue: new NotificationService() },
    ];
    const jwt = JwtModule.register({ secret: cfg.jwtSecret, signOptions: { expiresIn: cfg.jwtTtl } });
    return { module: CoreModule, imports: [jwt], providers, exports: [...providers.map((p) => p.provide), jwt] };
  }
}
