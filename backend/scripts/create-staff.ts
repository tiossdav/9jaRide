import 'dotenv/config';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { hashPassword } from '../src/auth/auth.service';

// Usage: npm run staff:create -- <email> "<Full Name>" <support|finance|admin>
// The password comes from STAFF_PASSWORD, or a random one is generated and printed once. Staff are never created over HTTP.
async function main() {
  const [email, fullName, role] = process.argv.slice(2);
  if (!email || !fullName || !['support', 'finance', 'admin'].includes(role)) {
    throw new Error('usage: npm run staff:create -- <email> "<Full Name>" <support|finance|admin>');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const password = process.env.STAFF_PASSWORD ?? randomBytes(15).toString('base64url');
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [email.trim().toLowerCase(), fullName, role, await hashPassword(password)],
    );
    console.log(`created ${role} ${email} (${rows[0].id})`);
    if (!process.env.STAFF_PASSWORD) console.log(`password (shown once): ${password}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
