// Runs every Koenig sync feed in sequence, in the order that respects data
// dependencies (sync-koenig seeds/updates the employee roster that every
// other per-employee feed joins against). One feed failing logs the error
// and continues rather than aborting the whole run, so a single flaky API
// doesn't block the rest of the day's sync.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '..');
config({ path: path.join(appDir, '.env.local') });
const { recordFeedRun } = await import('../lib/jobStatus.js');

const SCRIPTS = [
  'sync-koenig.mjs',
  'sync-pip.mjs',
  'sync-pms.mjs',
  'sync-truenr.mjs',
  'sync-video.mjs',
  'sync-appraisals.mjs',
  'sync-audit.mjs',
  'sync-sc.mjs',
  'sync-csm-roster.mjs',
  'sync-util.mjs',
  'sync-exam.mjs',
  'sync-negfeedback.mjs',
  'sync-assignments.mjs',
  'sync-trainerrc.mjs',
  'sync-skills.mjs',
  'sync-inhouse-skills.mjs',
  'sync-techcalls.mjs',
  'sync-techcalls-trainer.mjs',
  'sync-tbt.mjs',
  'sync-shoddy.mjs',
  'sync-polls.mjs',
  'sync-kgt.mjs',
  'sync-fminterviews.mjs',
  'sync-recruiterinterviews.mjs',
  'sync-mgrfeedback.mjs',
  'sync-ideas.mjs',
  'sync-salary.mjs',
  'sync-targetsdata.mjs',
  'sync-empdetails.mjs',
  'sync-commonindex.mjs',
  'sync-pipeline.mjs',
  'sync-graph-meetings.mjs',
  'sync-graph-subscription.mjs',
  'sync-external-emails.mjs',
  'sync-unreplied-emails.mjs',
  'snapshot-ei.mjs',
];

// The Windows task fires several times a day (see setup-sync-task.ps1) because the
// laptop is often asleep/unplugged at 06:30. State is kept per local day so each
// trigger resumes where the last one was cut off, and does nothing once a day's
// run has completed.
const STEP_TIMEOUT_MS = 40 * 60 * 1000; // a hung feed must not block the rest
const stateFile = path.join(appDir, 'logs', 'sync-state.json');
const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
let state = { date: today, done: [], finished: false };
try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (s.date === today) state = s; } catch {}
const saveState = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {} };

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { console.error(`${script} exceeded ${STEP_TIMEOUT_MS / 60000} min — killing it.`); child.kill(); }, STEP_TIMEOUT_MS);
    // Tee output to the log as before, but keep the tail so a failed feed's
    // reason can be recorded for the dashboard's sync-status panel.
    let tail = '';
    const keep = (stream, sink) => stream.on('data', (d) => { sink.write(d); tail = (tail + d.toString()).slice(-1500); });
    keep(child.stdout, process.stdout);
    keep(child.stderr, process.stderr);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, tail }); });
  });
}

if (!process.argv.some((a) => a.startsWith('--from=')) && !process.argv.includes('--force') && state.finished) {
  console.log(`sync-all: ${today} already completed — nothing to do.`);
  process.exit(0);
}
const started = new Date().toISOString();
console.log(`\n=== sync-all starting at ${started} ===`);

// Optional: `node sync-all.mjs --from=sync-trainerrc.mjs` resumes part-way
// (e.g. after killing a stuck run) instead of redoing the feeds already done.
const fromArg = process.argv.find((a) => a.startsWith('--from='))?.slice(7);
const startIdx = fromArg ? Math.max(0, SCRIPTS.indexOf(fromArg)) : 0;
if (process.argv.includes('--force')) state = { date: today, done: [], finished: false };
const results = [];
for (const script of SCRIPTS.slice(startIdx)) {
  if (!fromArg && state.done.includes(script)) { console.log(`
--- ${script} --- (already done today, skipping)`); continue; }
  console.log(`\n--- ${script} ---`);
  const { code, tail } = await run(script);
  results.push({ script, code });
  state.done.push(script); saveState(); // only reached if the step ended on its own; a killed machine re-runs it
  const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings|injected env|dotenv/i.test(l));
  await recordFeedRun(script, code === 0, code === 0 ? lines.filter((l) => /^Synced|^Updated/i.test(l)).pop() || lines[lines.length - 1] : lines.filter((l) => /fail|error/i.test(l)).slice(-2).join(' | ') || `exit code ${code}`);
  if (code !== 0) console.error(`${script} exited with code ${code} — continuing with remaining syncs.`);
}

const failed = results.filter((r) => r.code !== 0);
state.finished = true; saveState();
console.log(`\n=== sync-all finished at ${new Date().toISOString()} ===`);
console.log(`${results.length - failed.length}/${results.length} feeds synced successfully.`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => f.script).join(', '));
  process.exit(1);
}
