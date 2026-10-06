import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool, types } from 'pg';

// A calendar date (a licence expiry, a birthday, a chart day) is just a date. The default turns it into a moment at local midnight,
// which shows a day early on a server set to Nigerian time. Keep it as the text "YYYY-MM-DD".
types.setTypeParser(types.builtins.DATE, (v: string) => v);

export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');

/** Close connections on shutdown so a deploy drains cleanly (and tests can exit). */
@Injectable()
class InfraShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}

// Postgres is the source of truth; Redis (Valkey) holds only live positions, locks and short-lived offers.
@Global()
@Module({
  providers: [
    InfraShutdown,
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
