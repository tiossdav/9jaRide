import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');

// Postgres is the source of truth; Redis (Valkey) holds only live positions, locks and short-lived offers.
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      // Connect through the Supabase pooler in production (spec: Check 2). Keep max small per instance.
      useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL, max: 20 }),
    },
    {
      provide: REDIS,
      useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    },
  ],
  exports: [PG_POOL, REDIS],
})
export class InfraModule {}
