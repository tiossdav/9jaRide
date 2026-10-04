import 'dotenv/config';
import { Client } from 'pg';
import { hashPassword } from '../src/auth/auth.service';
import { insertStartingFares } from './starting-fares';

/**
 * Run on every start of a hosted copy, after the migrations. It only fills gaps, so it is safe to repeat:
 *  - creates the first admin from ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD when no staff exist yet;
 *  - puts in the starting fares when none exist, so a ride can be booked straight away.
 */
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if ((await db.query('SELECT 1 FROM staff_users LIMIT 1')).rowCount === 0) {
      if (!email || !password) console.log('No staff yet and ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD are not set: no admin created.');
      else if (password.length < 12) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters');
      else {
        await db.query(`INSERT INTO staff_users (email, full_name, role, password_hash) VALUES ($1, 'Administrator', 'admin', $2)`, [email, await hashPassword(password)]);
        console.log(`Created the first admin ${email}. Change the password after signing in.`);
      }
    }
    if ((await db.query('SELECT 1 FROM pricing_versions LIMIT 1')).rowCount === 0) {
      await insertStartingFares(db);
      console.log('Added the starting fares.');
    }
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
