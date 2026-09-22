// Writes rating results back to weekly_responses. Takes a path to a JSON
// file: an array of {id, rating, reason} (id = weekly_responses.id, as
// listed by list-unrated-responses.mjs). Paired script — a Claude Code
// agent rates each row from list-unrated-responses.mjs's output itself
// (no LLM API call here), writes its ratings to a JSON file, then runs this
// to persist them.
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/save-ratings.mjs <path-to-ratings.json>');
  process.exit(1);
}

const ratings = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(ratings)) {
  console.error('Expected a JSON array of {id, rating, reason}.');
  process.exit(1);
}

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

let applied = 0;
for (const { id, rating, reason } of ratings) {
  const r = Number(rating);
  if (!id || !Number.isInteger(r) || r < 1 || r > 5 || !reason) {
    console.error(`Skipping malformed entry: ${JSON.stringify({ id, rating, reason })}`);
    continue;
  }
  await db.execute({
    sql: 'UPDATE weekly_responses SET ai_rating = ?, ai_rating_reason = ? WHERE id = ?',
    args: [String(r), reason, id],
  });
  applied++;
}

console.log(`Applied ${applied} of ${ratings.length} rating(s).`);
