import { Client } from 'pg';

export const SYSTEM = '00000000-0000-0000-0000-000000000001';
export const SYSTEM_APPROVER = '00000000-0000-0000-0000-000000000002';

/** Starting fares so a ride can be booked on day one. Change them any time in the portal (Trip Fees); these are not final prices. */
export const STARTING_FARES = [
  { category: 'regular', base: 120000, perKm: 20000, perMinute: 15000 },
  { category: 'comfort', base: 160000, perKm: 26000, perMinute: 19500 },
  { category: 'package', base: 100000, perKm: 18000, perMinute: 12000 },
];

export async function insertStartingFares(db: Client): Promise<void> {
  for (const f of STARTING_FARES) {
    await db.query(
      `INSERT INTO pricing_versions (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, waiting_per_minute_kobo, free_waiting_seconds, tax_kobo, created_by, approved_by, approved_at)
       VALUES ($1, '2026-01-01T00:00:00+01', $2, $3, $4, 5000, 180, 3000, $5, $6, now())`,
      [f.category, f.base, f.perKm, f.perMinute, SYSTEM, SYSTEM_APPROVER],
    );
  }
}
