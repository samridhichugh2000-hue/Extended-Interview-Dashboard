// Syncs Trainer negative feedback from the Koenig "Get Trainer Negative
// Feedback" API into employees.neg_feedback/neg_feedback_details, Trainer
// team only. Matched directly by employee_id — no fuzzy name/email matching
// needed, unlike the enquiry audit feed.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTrainerNegativeFeedback } = await import('../lib/koenigNegativeFeedbackApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

let updated = 0;
for (const emp of trainerEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const feedback = await getTrainerNegativeFeedback(empCode);

  await db.execute({
    sql: 'UPDATE employees SET neg_feedback = ?, neg_feedback_details = ? WHERE id = ?',
    args: [feedback.length, JSON.stringify(feedback), emp.id],
  });
  if (feedback.length) updated++;
}

console.log(`Synced negative feedback for Trainer roster — ${updated} employees have at least one record.`);
const check = await db.execute("SELECT id, name, neg_feedback FROM employees WHERE team = 'Trainer' AND neg_feedback > 0 ORDER BY neg_feedback DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.neg_feedback);
