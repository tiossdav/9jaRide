import { DispatchService } from './dispatch.service';
import { keys } from './dispatch.types';

// Unit tests for the accept guard with mocked Redis and Postgres. They check the decision logic only;
// real concurrent accepts need the integration test against Postgres + Valkey (see backend/README.md).
function setup(opts: { offeredTo?: string | null; lockFree?: boolean; assignRows?: number; offerRows?: number; assignError?: any }) {
  const redis: any = {
    get: jest.fn().mockResolvedValue(opts.offeredTo ?? null),
    set: jest.fn().mockResolvedValue(opts.lockFree === false ? null : 'OK'),
    del: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => ({ hset: () => redis._m, set: () => redis._m, del: () => redis._m, exec: jest.fn().mockResolvedValue([]) })),
  };
  redis._m = redis.multi();
  const queries: string[] = [];
  const client: any = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (sql.includes("SET driver_id")) {
        if (opts.assignError) throw opts.assignError;
        return { rowCount: opts.assignRows ?? 1, rows: opts.assignRows === 0 ? [] : [{ rider_id: 'rider-1' }] };
      }
      if (sql.includes("SET status = 'ACCEPTED'")) return { rowCount: opts.offerRows ?? 1, rows: [] };
      return { rowCount: 1, rows: [] };
    }),
    release: jest.fn(),
  };
  const pool: any = { connect: jest.fn().mockResolvedValue(client) };
  const notifier: any = { rideAssigned: jest.fn().mockResolvedValue(undefined) };
  return { service: new DispatchService(pool, redis, notifier), redis, client, queries, notifier };
}

describe('DispatchService.acceptOffer', () => {
  it('rejects an accept when the offer expired (no offer key in Redis)', async () => {
    const { service, client } = setup({ offeredTo: null });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: false, reason: 'offer_expired' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects a driver the ride was not offered to', async () => {
    const { service, client } = setup({ offeredTo: 'driver-2' });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: false, reason: 'not_offered_to_you' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('loses when another accept already holds the Redis lock', async () => {
    const { service, client } = setup({ offeredTo: 'driver-1', lockFree: false });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: false, reason: 'ride_taken' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('loses when the conditional UPDATE touches zero rows, and releases the lock', async () => {
    const { service, redis, queries } = setup({ offeredTo: 'driver-1', assignRows: 0 });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: false, reason: 'ride_taken' });
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
    expect(redis.del).toHaveBeenCalledWith(keys.rideAcceptLock('ride-1'));
  });

  it('reports driver_busy when the one-active-ride unique index fires', async () => {
    const { service } = setup({ offeredTo: 'driver-1', assignError: Object.assign(new Error('dup'), { code: '23505' }) });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: false, reason: 'driver_busy' });
  });

  it('rolls back the assignment if the offer had already expired in Postgres', async () => {
    const { service, queries } = setup({ offeredTo: 'driver-1', offerRows: 0 });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: false, reason: 'offer_expired' });
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });

  it('assigns, commits and notifies the rider on the happy path', async () => {
    const { service, queries, notifier } = setup({ offeredTo: 'driver-1' });
    expect(await service.acceptOffer('ride-1', 'driver-1')).toEqual({ ok: true, rideId: 'ride-1' });
    expect(queries).toContain('COMMIT');
    expect(notifier.rideAssigned).toHaveBeenCalledWith('rider-1', 'driver-1', 'ride-1');
  });
});
