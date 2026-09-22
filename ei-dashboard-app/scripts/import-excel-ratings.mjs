// One-off: imports the historical ratings from
// "Sample Weekly_Response_Review_Rated_Claude.xlsx" (three sheets: Trainer,
// Sales, PT — columns Week, Name, Team, Status, Response State, Q1, A1, Q2,
// A2, Rating (out of 5), Reason for Rating) into weekly_responses, matching
// rows by employee name + week. Skips any row that already has an
// ai_rating (so it's safe to re-run).
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error('Usage: node scripts/import-excel-ratings.mjs <path-to-xlsx>');
  process.exit(1);
}

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);

let matched = 0, alreadyRated = 0, notFound = 0;
for (const sheet of wb.worksheets) {
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const week = row.getCell(1).value;
    const name = row.getCell(2).value;
    const rating = row.getCell(11).value;
    const reason = row.getCell(12).value;
    if (!week || !name || rating == null) continue;

    const existing = await db.execute({
      sql: `SELECT wr.id, wr.ai_rating FROM weekly_responses wr
            JOIN employees e ON e.id = wr.employee_id
            WHERE e.name = ? AND wr.week = ?`,
      args: [name, week],
    });
    const r = existing.rows[0];
    if (!r) { notFound++; console.error(`No DB row for ${name} / ${week}`); continue; }
    if (r.ai_rating) { alreadyRated++; continue; }

    await db.execute({
      sql: 'UPDATE weekly_responses SET ai_rating = ?, ai_rating_reason = ? WHERE id = ?',
      args: [String(rating), String(reason || ''), r.id],
    });
    matched++;
  }
}

console.log(`Imported ${matched}, already rated ${alreadyRated}, no matching DB row ${notFound}.`);
