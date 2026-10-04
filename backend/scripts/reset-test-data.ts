import 'dotenv/config';
import Redis from 'ioredis';
import { rmSync } from 'fs';
import { join, resolve } from 'path';
import { Client } from 'pg';
import { SYSTEM, STARTING_FARES, insertStartingFares } from './starting-fares';

/**
 * Wipes every person and everything they did (riders, drivers, rides, money, applications, support, promo codes, staff
 * audit trail, sign-in sessions) so testing starts from a clean slate. It keeps the system's own set-up: the database
 * structure, the car categories, the starting fares, the revenue and cancellation rules, the platform's ledger
 * accounts, the vehicle arrangements, and the staff accounts you name in KEEP_STAFF.
 *
 *   npm run reset:test-data -- --yes
 *
 * Refuses to run when NODE_ENV=production.
 */
const KEEP_TABLES = new Set([
  'schema_migrations', 'spatial_ref_sys', 'vehicle_arrangements', 'asset_types', 'pricing_versions', 'setting_versions', 'app_config', 'ledger_accounts', 'staff_users',
]);
const KEEP_CATEGORIES = ['regular', 'comfort', 'package'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to wipe data when NODE_ENV=production.');
  if (!process.argv.includes('--yes')) {
    console.log('This deletes all riders, drivers, rides, payments and test staff from the database named by DATABASE_URL.\nRun again with --yes to go ahead.');
    process.exit(1);
  }
  const keepStaff = (process.env.KEEP_STAFF ?? 'admin@9jaridepro.test').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    // Switches off the triggers that make the ledger, fees and audit log read-only, and foreign-key checks, for this transaction only.
    await db.query(`SET LOCAL session_replication_role = replica`);
    const tables: string[] = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.tablename);
    const cleared: string[] = [];
    for (const t of tables) {
      if (KEEP_TABLES.has(t)) continue;
      await db.query(`DELETE FROM "${t}"`);
      cleared.push(t);
    }
    // numbering starts again from 1 for the tables just emptied
    const seqs = await db.query(
      `SELECT pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) AS seq, table_name
         FROM information_schema.columns WHERE table_schema = 'public' AND (column_default LIKE 'nextval%' OR is_identity = 'YES')`,
    );
    for (const s of seqs.rows) if (s.seq && cleared.includes(s.table_name)) await db.query(`ALTER SEQUENCE ${s.seq} RESTART`);

    const staff = await db.query(`DELETE FROM staff_users WHERE lower(email) <> ALL($1::text[])`, [keepStaff]);
    await db.query(`UPDATE staff_users SET failed_logins = 0, locked_until = NULL`);
    const accounts = await db.query(`DELETE FROM ledger_accounts WHERE code NOT LIKE 'platform:%'`);
    await db.query(`DELETE FROM pricing_versions`);
    await db.query(`DELETE FROM asset_types WHERE code <> ALL($1::text[])`, [KEEP_CATEGORIES]);
    await db.query(`UPDATE asset_types SET active = true WHERE code = ANY($1::text[])`, [KEEP_CATEGORIES]);
    await db.query(`DELETE FROM setting_versions WHERE created_by <> $1`, [SYSTEM]);
    await insertStartingFares(db);
    await db.query('COMMIT');
    console.log(`Cleared ${cleared.length} tables, ${staff.rowCount} staff accounts and ${accounts.rowCount} wallet accounts.`);
    console.log(`Kept staff: ${keepStaff.join(', ')}. Starting fares set for: ${STARTING_FARES.map((f) => f.category).join(', ')}.`);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }

  // live driver positions, offers, quotes and rate-limit counters live in Redis
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await redis.flushdb();
  redis.disconnect();
  console.log('Cleared the live cache (Redis).');
  // the uploaded proof documents belong to the people just removed
  rmSync(resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')), { recursive: true, force: true });
  console.log('Removed uploaded files.');
}

main().catch((e) => { console.error(e); process.exit(1); });
