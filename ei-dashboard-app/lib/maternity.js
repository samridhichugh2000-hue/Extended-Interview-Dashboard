// Who is on maternity leave today, for the "Maternity" tag under a name. Sales and
// Trainer come from the Past ML snapshot (lib/pastMl.js), PT / FM / Recruitment from
// lib/onMaternity.js. Both are snapshots — re-run scripts/gen-past-ml.mjs and
// scripts/gen-on-maternity.mjs to pick up new leaves. Display only.
import { PAST_ML } from './pastMl.js';
import { ON_MATERNITY } from './onMaternity.js';

const LEAVES = new Map();
for (const c of PAST_ML.cases) LEAVES.set(c.id, { from: c.mlFrom, to: c.mlTo, approval: c.approval });
for (const c of ON_MATERNITY.cases) LEAVES.set(c.id, { from: c.from, to: c.to, approval: c.approval });

// { from, to, approval } when the employee's maternity leave covers today (IST), else null.
export function maternityNow(id) {
  const l = LEAVES.get(id);
  if (!l) return null;
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  return l.from <= today && today <= l.to ? l : null;
}
