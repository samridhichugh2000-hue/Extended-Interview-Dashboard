// Runs every Koenig sync feed in sequence, in the order that respects data
// dependencies (sync-koenig seeds/updates the employee roster that every
// other per-employee feed joins against). One feed failing logs the error
// and continues rather than aborting the whole run, so a single flaky API
// doesn't block the rest of the day's sync.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
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

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Tee output to the log as before, but keep the tail so a failed feed's
    // reason can be recorded for the dashboard's sync-status panel.
    let tail = '';
    const keep = (stream, sink) => stream.on('data', (d) => { sink.write(d); tail = (tail + d.toString()).slice(-1500); });
    keep(child.stdout, process.stdout);
    keep(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ code, tail }));
  });
}

const started = new Date().toISOString();
console.log(`\n=== sync-all starting at ${started} ===`);

// Optional: `node sync-all.mjs --from=sync-trainerrc.mjs` resumes part-way
// (e.g. after killing a stuck run) instead of redoing the feeds already done.
const fromArg = process.argv.find((a) => a.startsWith('--from='))?.slice(7);
const startIdx = fromArg ? Math.max(0, SCRIPTS.indexOf(fromArg)) : 0;
const results = [];
for (const script of SCRIPTS.slice(startIdx)) {
  console.log(`\n--- ${script} ---`);
  const { code, tail } = await run(script);
  results.push({ script, code });
  const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings|injected env|dotenv/i.test(l));
  await recordFeedRun(script, code === 0, code === 0 ? lines.filter((l) => /^Synced|^Updated/i.test(l)).pop() || lines[lines.length - 1] : lines.filter((l) => /fail|error/i.test(l)).slice(-2).join(' | ') || `exit code ${code}`);
  if (code !== 0) console.error(`${script} exited with code ${code} — continuing with remaining syncs.`);
}

const failed = results.filter((r) => r.code !== 0);
console.log(`\n=== sync-all finished at ${new Date().toISOString()} ===`);
console.log(`${results.length - failed.length}/${results.length} feeds synced successfully.`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => f.script).join(', '));
  process.exit(1);
}
