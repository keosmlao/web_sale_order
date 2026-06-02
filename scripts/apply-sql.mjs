// Apply a raw SQL migration file from sql/ to the database.
// Usage: node scripts/apply-sql.mjs sql/add-menu-visibility.sql
//
// The project applies its sql/ migrations manually (no prisma migrate); this
// is a small, dependency-light runner using the same pg + DATABASE_URL setup
// as the app. Migration files are written to be idempotent.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-sql.mjs <path-to-sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log(`✓ Applied ${file}`);
} catch (e) {
  console.error(`✗ Failed to apply ${file}:`, e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
