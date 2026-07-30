// Applies schema.sql to Turso. Run once against a fresh database, or again
// after schema changes (all statements are idempotent CREATE/ALTER guards).
// Employee data itself comes from scripts/sync-koenig.mjs, not from here.
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const schema = readFileSync(path.join(__dirname, '..', 'lib', 'schema.sql'), 'utf-8');
const statements = schema.split(';').map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) await db.execute(stmt);
console.log('Schema applied.');

// Migration for tables created before metric1/metric2/metric3/alert existed.
for (const col of ['metric1', 'metric2', 'metric3', 'metric4', 'metric5', 'metric6', 'alert']) {
  try {
    await db.execute(`ALTER TABLE employees ADD COLUMN ${col} TEXT`);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}
try {
  await db.execute('ALTER TABLE employees ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
try {
  await db.execute('ALTER TABLE employees ADD COLUMN neg_audits INTEGER');
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
try {
  await db.execute('ALTER TABLE employees ADD COLUMN audit_remarks TEXT');
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
for (const stmt of [
  'ALTER TABLE employees ADD COLUMN sc_raised INTEGER',
  'ALTER TABLE employees ADD COLUMN sc_details TEXT',
  'ALTER TABLE employees ADD COLUMN exam_pass INTEGER',
  'ALTER TABLE employees ADD COLUMN exam_fail INTEGER',
  'ALTER TABLE employees ADD COLUMN exam_total INTEGER',
  'ALTER TABLE employees ADD COLUMN exam_not_updated INTEGER',
  'ALTER TABLE employees ADD COLUMN email TEXT',
  'ALTER TABLE employees ADD COLUMN neg_feedback INTEGER',
  'ALTER TABLE employees ADD COLUMN neg_feedback_details TEXT',
  'ALTER TABLE employees ADD COLUMN assignments_count INTEGER',
  'ALTER TABLE employees ADD COLUMN assignments_details TEXT',
  'ALTER TABLE employees ADD COLUMN skills_count INTEGER',
  'ALTER TABLE employees ADD COLUMN skills_details TEXT',
  'ALTER TABLE employees ADD COLUMN tech_calls_count INTEGER',
  'ALTER TABLE employees ADD COLUMN tech_calls_details TEXT',
  'ALTER TABLE employees ADD COLUMN tech_calls_converted INTEGER',
  'ALTER TABLE employees ADD COLUMN tbt_count INTEGER',
  'ALTER TABLE employees ADD COLUMN tbt_details TEXT',
  'ALTER TABLE employees ADD COLUMN shoddy_neg_count INTEGER',
  'ALTER TABLE employees ADD COLUMN shoddy_neg_details TEXT',
  'ALTER TABLE employees ADD COLUMN shoddy_pos_count INTEGER',
  'ALTER TABLE employees ADD COLUMN shoddy_pos_details TEXT',
]) {
  try {
    await db.execute(stmt);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}

for (const stmt of [
  'ALTER TABLE pip_status ADD COLUMN comment TEXT',
  'ALTER TABLE pip_status ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE pip_status ADD COLUMN source_id INTEGER',
]) {
  try {
    await db.execute(stmt);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}

console.log('Done. Run `npm run sync:koenig` to populate employees from the live API.');
