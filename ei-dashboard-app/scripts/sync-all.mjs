// Runs every Koenig sync feed in sequence, in the order that respects data
// dependencies (sync-koenig seeds/updates the employee roster that every
// other per-employee feed joins against). One feed failing logs the error
// and continues rather than aborting the whole run, so a single flaky API
// doesn't block the rest of the day's sync.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '..');

const SCRIPTS = [
  'sync-koenig.mjs',
  'sync-pip.mjs',
  'sync-pms.mjs',
  'sync-audit.mjs',
  'sync-sc.mjs',
  'sync-util.mjs',
  'sync-exam.mjs',
  'sync-negfeedback.mjs',
  'sync-assignments.mjs',
  'sync-skills.mjs',
  'sync-techcalls.mjs',
  'sync-techcalls-trainer.mjs',
  'sync-tbt.mjs',
  'sync-shoddy.mjs',
];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: appDir,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code));
  });
}

const started = new Date().toISOString();
console.log(`\n=== sync-all starting at ${started} ===`);

const results = [];
for (const script of SCRIPTS) {
  console.log(`\n--- ${script} ---`);
  const code = await run(script);
  results.push({ script, code });
  if (code !== 0) console.error(`${script} exited with code ${code} — continuing with remaining syncs.`);
}

const failed = results.filter((r) => r.code !== 0);
console.log(`\n=== sync-all finished at ${new Date().toISOString()} ===`);
console.log(`${results.length - failed.length}/${results.length} feeds synced successfully.`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => f.script).join(', '));
  process.exit(1);
}
