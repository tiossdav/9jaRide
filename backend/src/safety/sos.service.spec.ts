import { SosService } from './sos.service';

function build(poolQuery: jest.Mock, overrides: Partial<Record<'staff' | 'sms' | 'caller' | 'ack', any>> = {}) {
  const client: any = { query: poolQuery, release: jest.fn() };
  const pool: any = { connect: jest.fn().mockResolvedValue(client), query: poolQuery };
  const staff = overrides.staff ?? { newSos: jest.fn().mockResolvedValue(undefined) };
  const sms = overrides.sms ?? { send: jest.fn().mockResolvedValue(undefined) };
  const caller = overrides.caller ?? { call: jest.fn().mockResolvedValue(undefined) };
  const ack = overrides.ack ?? { acknowledged: jest.fn().mockResolvedValue(undefined) };
  return { service: new SosService(pool, staff, sms, caller, ack), staff, sms, caller, ack };
}

const input = { idempotencyKey: 'k1', userId: 'u1', role: 'driver' as const, location: { lat: 6.5, lng: 3.3 } };

describe('SosService', () => {
  afterEach(() => { delete process.env.ONCALL_PHONE; });

  it('stores the alert and still confirms when staff alerting fails', async () => {
    process.env.ONCALL_PHONE = '+2340000000000';
    const q = jest.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO sos_events')) return { rowCount: 1, rows: [{ id: 'sos-1' }] };
      if (sql.includes('FROM sos_events WHERE id')) return { rows: [{ raised_by_role: 'driver', ride_id: null, lat: 6.5, lng: 3.3 }] };
      return { rowCount: 0, rows: [] };
    });
    const staff = { newSos: jest.fn().mockRejectedValue(new Error('gateway down')) };
    const sms = { send: jest.fn().mockRejectedValue(new Error('sms down')) };
    const { service } = build(q, { staff, sms });
    await expect(service.raise(input)).resolves.toEqual({ id: 'sos-1', stored: true, duplicate: false });
  });

  it('treats a retry with the same idempotency key as a duplicate and does not re-alert staff', async () => {
    const q = jest.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO sos_events')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM sos_events WHERE idempotency_key')) return { rows: [{ id: 'sos-1' }] };
      return { rowCount: 0, rows: [] };
    });
    const { service, staff } = build(q);
    await expect(service.raise(input)).resolves.toEqual({ id: 'sos-1', stored: true, duplicate: true });
    expect(staff.newSos).not.toHaveBeenCalled();
  });

  it('does not store a confirmation when the database write fails', async () => {
    const q = jest.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO sos_events')) throw new Error('db down');
      return { rowCount: 0, rows: [] };
    });
    const { service } = build(q);
    await expect(service.raise(input)).rejects.toThrow('db down');
  });

  it('acknowledges once and notifies the person who raised it', async () => {
    const q = jest.fn(async (sql: string) =>
      sql.includes("SET status = 'ACKNOWLEDGED'") ? { rows: [{ raised_by: 'u1' }] } : { rows: [], rowCount: 0 });
    const { service, ack } = build(q);
    expect(await service.acknowledge('sos-1', 'staff-1')).toBe(true);
    expect(ack.acknowledged).toHaveBeenCalledWith('u1', 'sos-1');
  });

  it('acknowledging an already-acknowledged alert is a no-op', async () => {
    const { service, ack } = build(jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }));
    expect(await service.acknowledge('sos-1', 'staff-2')).toBe(false);
    expect(ack.acknowledged).not.toHaveBeenCalled();
  });

  it('phones the on-call person for each alert escalated after 60 s', async () => {
    process.env.ONCALL_PHONE = '+2340000000000';
    const q = jest.fn(async (sql: string) =>
      sql.includes('SET escalated_at') ? { rows: [{ id: 'sos-1' }, { id: 'sos-2' }] } : { rows: [], rowCount: 0 });
    const { service, caller } = build(q);
    expect(await service.escalateUnacknowledged()).toBe(2);
    expect(caller.call).toHaveBeenCalledTimes(2);
  });
});
