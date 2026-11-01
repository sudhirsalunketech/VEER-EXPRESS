import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(cfg));
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: cfg.corsOrigins, credentials: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  await app.listen(cfg.port);
  console.log(`Veer Express API (${cfg.mode} mode) on :${cfg.port}/api/v1`);
}
bootstrap();
