import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DomainExceptionFilter } from './common/domain-exception.filter';

/** Shared by main.ts and the HTTP tests, so tests exercise the same pipes and filters as production. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
}
