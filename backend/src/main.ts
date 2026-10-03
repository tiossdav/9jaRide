import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // rawBody keeps the exact bytes of each request: the Paystack webhook signature is computed over them.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Behind a load balancer, req.ip must be the client's address (OTP rate limits depend on it).
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  if (process.env.ADMIN_ORIGIN) app.enableCors({ origin: process.env.ADMIN_ORIGIN.split(','), credentials: false });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
