// Runs the integration tests on any operating system, against their OWN database (jaride_test), so test people and test
// money never end up in the database you use by hand. The database is created and brought up to date automatically.
// Usage: npm run test:int [-- <jest args>]   (set TEST_DATABASE_URL to use a different one)
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const testUrl = process.env.TEST_DATABASE_URL || 'postgres://jaride:jaride@localhost:5432/jaride_test';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

async function ensureDatabase() {
  const url = new URL(testUrl);
  const name = url.pathname.slice(1);
  const admin = new Client({ connectionString: testUrl.replace(`/${name}`, '/postgres') });
  await admin.connect();
  try {
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) {
      await admin.query(`CREATE DATABASE "${name}"`);
      console.log(`created database ${name}`);
    }
  } finally {
    await admin.end();
  }
  const m = spawnSync(npx, ['ts-node', 'scripts/migrate.ts'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl }, shell: process.platform === 'win32' });
  if (m.status !== 0) process.exit(m.status ?? 1);
}

ensureDatabase().then(() => {
  const env = { ...process.env, INTEGRATION: '1', DATABASE_URL: testUrl, REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379/1', UPLOAD_DIR: require('path').join(require('os').tmpdir(), 'jaride-test-uploads') };
  // One file at a time: the suites share one database.
  const r = spawnSync(npx, ['jest', '--runInBand', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: process.platform === 'win32' });
  process.exit(r.status ?? 1);
}, (e) => { console.error(e); process.exit(1); });
