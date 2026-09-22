// Syncs Trainer in-house skills (courses marked in-house) from the Koenig
// "Get In-House Skills Marked by Employee" API into
// employees.in_house_skills_count/in_house_skills_details, Trainer team
// only. Per-employee API like Trainer Skills, matched directly by emp_code.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getInHouseSkills } = await import('../lib/koenigInHouseSkillsApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

// Bounded concurrency — see scripts/sync-exam.mjs for why.
const CONCURRENCY = 20;
async function mapWithConcurrency(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

let updated = 0;
let unmatched = 0;
await mapWithConcurrency(trainerEmployees.rows, CONCURRENCY, async (emp) => {
  const empCode = emp.id.replace('EMP', '');
  const skills = await getInHouseSkills(empCode);

  await db.execute({
    sql: 'UPDATE employees SET in_house_skills_count = ?, in_house_skills_details = ? WHERE id = ?',
    args: [skills.length, JSON.stringify(skills), emp.id],
  });
  if (skills.length) updated++; else unmatched++;
});

console.log(`Synced in-house skills data for Trainer roster — ${updated} employees have at least one (${unmatched} have none).`);
const check = await db.execute("SELECT id, name, in_house_skills_count FROM employees WHERE team = 'Trainer' AND in_house_skills_count > 0 ORDER BY in_house_skills_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.in_house_skills_count);
