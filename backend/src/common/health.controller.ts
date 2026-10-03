import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { Public } from '../auth/auth.types';
import { PG_POOL, REDIS } from './infra.module';

@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS) private readonly redis: Redis) {}

  /** For the load balancer: 200 only when both stores answer. Reveals nothing else. */
  @Public() @Get('health')
  async health() {
    try {
      await Promise.all([this.pool.query('SELECT 1'), this.redis.ping()]);
    } catch {
      throw new ServiceUnavailableException();
    }
    return { ok: true };
  }
}
