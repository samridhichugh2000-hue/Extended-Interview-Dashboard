// Syncs Trainer skills (courses marked) from the Koenig "Get Trainer
// Skills" API into employees.skills_count/skills_details, Trainer team
// only. Per-employee API like exam summary/utilization — one call per
// Trainer, matched directly by employee_id.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTrainerSkills } = await import('../lib/koenigSkillsApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

let updated = 0;
let unmatched = 0;
for (const emp of trainerEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const skills = await getTrainerSkills(empCode);

  await db.execute({
    sql: 'UPDATE employees SET skills_count = ?, skills_details = ? WHERE id = ?',
    args: [skills.length, JSON.stringify(skills), emp.id],
  });
  if (skills.length) updated++; else unmatched++;
}

console.log(`Synced skills data for Trainer roster — ${updated} employees have at least one skill (${unmatched} have none).`);
const check = await db.execute("SELECT id, name, skills_count FROM employees WHERE team = 'Trainer' AND skills_count > 0 ORDER BY skills_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.skills_count);
