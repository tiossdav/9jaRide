import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Pool } from 'pg';
import { Observable, tap } from 'rxjs';
import { PG_POOL } from './infra.module';

/** Records every staff request that changes something (and every refusal of one) in the append-only audit log. */
@Injectable()
export class StaffAuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(StaffAuditInterceptor.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    if (req.method === 'GET' || !req.principal) return next.handle();
    const write = (status: number) =>
      this.pool
        .query(
          `INSERT INTO staff_audit_log (staff_id, method, path, params, status_code, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.principal.id, req.method, req.route?.path ?? req.path, JSON.stringify({ params: req.params, body: req.body }), status, req.ip ?? null],
        )
        .catch((e) => this.log.error(`audit write failed: ${e}`));
    return next.handle().pipe(
      tap({
        next: () => void write(res.statusCode),
        error: (e) => void write(typeof e?.getStatus === 'function' ? e.getStatus() : 500),
      }),
    );
  }
}
