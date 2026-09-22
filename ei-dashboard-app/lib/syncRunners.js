// Server-runnable equivalents of scripts/sync-*.mjs, for use by the
// /api/sync/[feed] routes. Each function takes the shared db client (from
// getDb()) instead of creating its own, and reads credentials from
// process.env directly (already populated by Vercel — no dotenv needed here,
// unlike the standalone CLI scripts these mirror).
import { getDb } from './db.js';

// Shared by syncSc/syncAssignments/syncMgrFeedback — reconstructs an
// employee's join date from tenure_days (for recycled-emp-code exclusion),
// capped to at most the last 2 years regardless of actual tenure, so a
// multi-year veteran's count reflects recent activity, not a full-career
// total (e.g. 1074 SCs raised over 18 years isn't a meaningful figure).
const SINCE_LOOKBACK_DAYS = 730;
function sinceDate(tenureDays) {
  const joined = new Date();
  joined.setDate(joined.getDate() - tenureDays);
  joined.setHours(0, 0, 0, 0);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SINCE_LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return joined > cutoff ? joined : cutoff;
}

function displayDate(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw || '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, ' ');
}

function tenureDays(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function normalizeEmpId(raw) {
  const n = Math.trunc(Number(raw));
  return 'EMP' + (Number.isFinite(n) ? n : String(raw).trim());
}

const FETCH_FROM = '2000-01-01';

function fetchRange() {
  const to = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: FETCH_FROM, to: fmt(to) };
}

// Every currently-active Sales/Trainer/PT Team employee gets inserted, not
// just ones within the original 6-month "new joiner" tracking horizon —
// that used to gate inserts on tenure_days < 182, which meant anyone
// already a longer-tenured employee the first time this ever synced them
// was silently never imported (the dashboard's "All employees" view was
// showing e.g. 25 of Sales' real 108 active headcount). FETCH_FROM stays
// wide both to actually see those older joiners at all, and because
// Koenig's `active` flag is only returned for rows inside the queried
// from/to range — already-known rows need to keep falling inside it too,
// to get fresh active/tenure_days updates for as long as Koenig reports on
// them, rather than freezing at their last-seen value if they later exit.
export async function syncKoenig() {
  const db = getDb();
  const { getNewJoiners } = await import('./koenigApi.js');

  const { from, to } = fetchRange();
  const rawNewJoiners = await getNewJoiners(from, to);
  const newJoiners = rawNewJoiners
    .filter((nj) => nj.section !== null && nj.empId)
    .map((nj) => ({ ...nj, empId: normalizeEmpId(nj.empId) }));

  if (!newJoiners.length) {
    throw new Error('Koenig API returned zero usable new joiners — aborting without touching Turso.');
  }

  const existing = await db.execute('SELECT id FROM employees');
  const knownIds = new Set(existing.rows.map((r) => r.id));

  const seen = new Set();
  let inserted = 0;
  let updatedCount = 0;
  for (const nj of newJoiners) {
    if (seen.has(nj.empId)) continue;
    seen.add(nj.empId);

    if (knownIds.has(nj.empId)) {
      await db.execute({
        sql: `UPDATE employees SET name = ?, email = ?, team = ?, manager = ?, doj = ?, tenure_days = ?, active = ?
              WHERE id = ?`,
        args: [nj.name, nj.email || null, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), nj.active ? 1 : 0, nj.empId],
      });
      updatedCount++;
    } else if (nj.active) {
      await db.execute({
        sql: `INSERT INTO employees (id, name, email, team, manager, doj, tenure_days, status, score, trend_note, hr_note, metric1, metric2, metric3, alert, active)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
        args: [nj.empId, nj.name, nj.email || null, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), 1],
      });
      inserted++;
    }
  }

  return { message: `Synced ${newJoiners.length} new joiners: ${inserted} new, ${updatedCount} updated.` };
}

export async function syncPip() {
  const db = getDb();
  const { getPipPanelData } = await import('./koenigPipApi.js');

  const rows = await getPipPanelData('2020-01-01', '2030-01-01');
  const existing = await db.execute('SELECT id FROM employees');
  const knownIds = new Set(existing.rows.map((r) => r.id));

  const byEmployee = new Map();
  for (const r of rows) {
    const employeeId = 'EMP' + r.empCode;
    if (!knownIds.has(employeeId)) continue;
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, []);
    byEmployee.get(employeeId).push(r);
  }

  let updated = 0;
  for (const [employeeId, incidents] of byEmployee) {
    incidents.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
    const current = incidents.find((i) => i.isActive) || null;

    await db.execute({ sql: 'DELETE FROM pip_status WHERE employee_id = ?', args: [employeeId] });
    for (const i of incidents) {
      await db.execute({
        sql: `INSERT INTO pip_status (employee_id, type, issued_on, review_by, breaches, comment, is_active, source_id)
              VALUES (?, ?, ?, ?, '[]', ?, ?, ?)`,
        args: [employeeId, i.type, i.fromDate || '—', i.toDate || '—', i.comment, i.isActive ? 1 : 0, i.sourceId],
      });
    }

    const status = current ? (current.type === 'PIP' ? 'PIP Issued' : 'PA Issued') : 'In Progress';
    await db.execute({
      sql: 'UPDATE employees SET status = ?, hr_note = ? WHERE id = ?',
      args: [status, current ? current.comment : null, employeeId],
    });
    updated++;
  }

  return { message: `Synced ${rows.length} incidents; ${byEmployee.size} matched; ${updated} employee records updated.` };
}

export async function syncPms() {
  const db = getDb();
  const { getCCENRData } = await import('./koenigPmsApi.js');

  function monthKey(date) {
    const mon = date.toLocaleString('en-US', { month: 'short' });
    return `${mon}-${date.getFullYear()}`;
  }
  function formatLakhs(raw) {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    return '₹' + (n / 100000).toFixed(1) + 'L';
  }
  // Trailing 6 calendar months ending with the current one — was "first 6
  // months since joining" (relative to DOJ), which left this permanently
  // blank for anyone whose first 6 months predates the ~8-month window this
  // even fetches (i.e. every veteran since the full roster import). M1 is
  // still the oldest of the 6, M6 the most recent, same left-to-right
  // convention as before; genuine NJs barely notice the change since their
  // trailing 6 months already mostly overlaps their actual tenure.
  function lastSixMonths(monthlyRevenue) {
    const now = new Date();
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const raw = monthlyRevenue[monthKey(d)];
      out.push(raw !== undefined ? formatLakhs(raw) : '—');
    }
    return out;
  }
  function eightMonthsAgo() {
    const d = new Date();
    d.setMonth(d.getMonth() - 8);
    return d.toISOString().slice(0, 10);
  }
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  const nrRows = await getCCENRData(eightMonthsAgo(), today());
  const nrByEmpId = new Map(nrRows.map((r) => [r.empId, r]));
  const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

  let updated = 0;
  let unmatched = 0;
  for (const row of salesEmployees.rows) {
    const empId = parseInt(row.id.replace('EMP', ''), 10);
    const nr = nrByEmpId.get(empId);
    if (!nr) { unmatched++; continue; }

    const months = lastSixMonths(nr.monthlyRevenue);
    await db.execute({
      sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ? WHERE id = ?',
      args: [...months, row.id],
    });
    updated++;
  }

  return { message: `Synced NR for ${updated} Sales employees (${unmatched} unmatched).` };
}

export async function syncAudit() {
  const db = getDb();
  const { getEnquiryAudits, isNegativeRating } = await import('./koenigEnquiryAuditApi.js');

  function normalize(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }
  function namesMatch(employeeName, csmName) {
    const empTokens = normalize(employeeName);
    const csmTokens = new Set(normalize(csmName));
    if (empTokens.length === 0) return false;
    return csmTokens.has(empTokens[0]) && csmTokens.has(empTokens[empTokens.length - 1]);
  }

  const audits = await getEnquiryAudits('2020-01-01', '2030-01-01');
  const salesEmployees = await db.execute("SELECT id, name FROM employees WHERE team = 'Sales'");

  // Every employee is checked against the full, successfully-fetched audit
  // feed, so a name match of zero is a confirmed zero negative audits, not
  // an unknown — write it rather than leaving neg_audits null forever (null
  // would otherwise show as "no data traced" in the Worry Index instead of
  // a real, counted 0).
  let updated = 0;
  let confirmedZero = 0;
  for (const emp of salesEmployees.rows) {
    const matches = audits.filter((a) => namesMatch(emp.name, a.csmName));
    const negatives = matches.filter((a) => isNegativeRating(a.rating));
    const remarks = negatives.map((a) => ({
      createdOn: a.createdOn,
      rating: a.rating,
      remark: a.remark,
      enquiryId: a.enquiryId,
      clientEmail: a.clientEmail,
    }));
    await db.execute({
      sql: 'UPDATE employees SET neg_audits = ?, audit_remarks = ? WHERE id = ?',
      args: [negatives.length, JSON.stringify(remarks), emp.id],
    });
    if (matches.length) updated++; else confirmedZero++;
  }

  return { message: `Synced audit data for ${updated} Sales employees with matched records (${confirmedZero} confirmed zero — no name match in the feed).` };
}

export async function syncSc() {
  const db = getDb();
  const { getScList } = await import('./koenigScListApi.js');

  const rows = await getScList('2020-01-01', '2030-01-01');
  const byEmpCode = new Map();
  for (const r of rows) {
    if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
    byEmpCode.get(r.empCode).push(r);
  }

  const salesEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Sales'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empCode = parseInt(emp.id.replace('EMP', ''), 10);
    const since = sinceDate(emp.tenure_days);
    const all = byEmpCode.get(empCode) || [];
    const scs = all.filter((s) => new Date(s.createdOn) >= since).sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
    if (!scs.length) { unmatched++; continue; }

    const details = scs.map((s) => ({ scId: s.scId, createdOn: s.createdOn, status: s.status, quotationStatus: s.quotationStatus }));
    statements.push({
      sql: 'UPDATE employees SET sc_raised = ?, sc_details = ? WHERE id = ?',
      args: [scs.length, JSON.stringify(details), emp.id],
    });
    updated++;
  }

  // Batch every employee's UPDATE into one round trip instead of one await
  // per row — the per-row DB latency, not the upstream fetch, was what pushed
  // this feed over Vercel Hobby's 60s limit (narrowing the query window
  // didn't help because the fetch was never the bottleneck).
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced SC data for ${updated} Sales employees (${unmatched} unmatched).` };
}

export async function syncCsmRoster() {
  const db = getDb();
  const { getCsmRoster } = await import('./koenigCsmRosterApi.js');

  const rows = await getCsmRoster();
  const byEmpCode = new Map();
  for (const r of rows) {
    if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
    byEmpCode.get(r.empCode).push(r);
  }

  const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empCode = parseInt(emp.id.replace('EMP', ''), 10);
    const shifts = (byEmpCode.get(empCode) || []).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    if (!shifts.length) { unmatched++; continue; }

    const details = shifts.map((s) => ({ startDate: s.startDate, startTime: s.startTime, endDate: s.endDate, endTime: s.endTime }));
    statements.push({
      sql: 'UPDATE employees SET roster_count = ?, roster_details = ? WHERE id = ?',
      args: [shifts.length, JSON.stringify(details), emp.id],
    });
    updated++;
  }

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced CSM Roster data for ${updated} Sales employees (${unmatched} unmatched).` };
}

export async function syncUtil() {
  const db = getDb();
  const { getMonthlyUtilization } = await import('./koenigUtilApi.js');

  function monthKey(date) {
    const mon = date.toLocaleString('en-US', { month: 'short' });
    return `${mon} ${date.getFullYear()}`;
  }
  function firstSixMonths(tenureDays, months) {
    const doj = new Date();
    doj.setDate(doj.getDate() - tenureDays);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(doj.getFullYear(), doj.getMonth() + i, 1);
      const rec = months[monthKey(d)];
      out.push(rec && rec.util !== null ? `${rec.util}%` : '—');
    }
    return out;
  }

  const trainerEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Trainer'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const data = await getMonthlyUtilization(empCode);
    if (!data) { unmatched++; continue; }

    const values = firstSixMonths(emp.tenure_days, data.months);
    await db.execute({
      sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ? WHERE id = ?',
      args: [...values, emp.id],
    });
    updated++;
  }

  return { message: `Synced utilization for ${updated} Trainer employees (${unmatched} unmatched).` };
}

export async function syncExam() {
  const db = getDb();
  const { getExamSummary } = await import('./koenigExamApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const summary = await getExamSummary(empCode);
    if (!summary) { unmatched++; continue; }

    await db.execute({
      sql: 'UPDATE employees SET exam_pass = ?, exam_fail = ?, exam_total = ?, exam_not_updated = ? WHERE id = ?',
      args: [summary.passCount, summary.failCount, summary.totalExam, summary.statusNotUpdated, emp.id],
    });
    updated++;
  }

  return { message: `Synced exam data for ${updated} Trainer employees (${unmatched} unmatched).` };
}

export async function syncNegFeedback() {
  const db = getDb();
  const { getTrainerNegativeFeedback } = await import('./koenigNegativeFeedbackApi.js');

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

  return { message: `Synced negative feedback — ${updated} Trainer employees have at least one record.` };
}

export async function syncAssignments() {
  const db = getDb();
  const { getTrainerAssignments } = await import('./koenigAssignmentApi.js');

  const rows = await getTrainerAssignments('2020-01-01', '2030-01-01');
  const byEmpCode = new Map();
  for (const r of rows) {
    if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
    byEmpCode.get(r.empCode).push(r);
  }

  const trainerEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Trainer' AND active = 1");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    const empCode = parseInt(emp.id.replace('EMP', ''), 10);
    const since = sinceDate(emp.tenure_days);
    const all = byEmpCode.get(empCode) || [];
    const assignments = all
      .filter((a) => new Date(a.startDate) >= since)
      .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    const details = assignments.map((a) => ({
      assignmentId: a.assignmentId,
      courseName: a.courseName,
      startDate: a.startDate,
      endDate: a.endDate,
      totalPax: a.totalPax,
      deliveryMode: a.deliveryMode,
      batchType: a.batchType,
    }));
    statements.push({
      sql: 'UPDATE employees SET assignments_count = ?, assignments_details = ? WHERE id = ?',
      args: [assignments.length, JSON.stringify(details), emp.id],
    });
    if (assignments.length) updated++; else unmatched++;
  }

  // Same batching fix as syncSc — one round trip for all employee updates
  // instead of one per employee, to stay under Vercel Hobby's 60s limit.
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced assignments — ${updated} Trainer employees have at least one (${unmatched} have none).` };
}

export async function syncSkills() {
  const db = getDb();
  const { getTrainerSkills } = await import('./koenigSkillsApi.js');

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

  return { message: `Synced skills — ${updated} Trainer employees have at least one (${unmatched} have none).` };
}

export async function syncInHouseSkills() {
  const db = getDb();
  const { getInHouseSkills } = await import('./koenigInHouseSkillsApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const skills = await getInHouseSkills(empCode);

    await db.execute({
      sql: 'UPDATE employees SET in_house_skills_count = ?, in_house_skills_details = ? WHERE id = ?',
      args: [skills.length, JSON.stringify(skills), emp.id],
    });
    if (skills.length) updated++; else unmatched++;
  }

  return { message: `Synced in-house skills — ${updated} Trainer employees have at least one (${unmatched} have none).` };
}

export async function syncTechCalls() {
  const db = getDb();
  const { getTechCalls } = await import('./koenigTechCallApi.js');

  const salesEmployees = await db.execute("SELECT id, name FROM employees WHERE team = 'Sales'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const result = await getTechCalls(empCode, emp.name);

    await db.execute({
      sql: 'UPDATE employees SET tech_calls_count = ?, tech_calls_details = ? WHERE id = ?',
      args: [result ? result.techCalls : 0, JSON.stringify(result ? [result.raw] : []), emp.id],
    });
    if (result) updated++; else unmatched++;
  }

  return { message: `Synced tech calls — ${updated} Sales employees have at least one (${unmatched} have none).` };
}

export async function syncTechCallsTrainer() {
  const db = getDb();
  const { getConvertedTechCalls } = await import('./koenigTechCallConvertedApi.js');

  const trainerEmployees = await db.execute("SELECT id, email FROM employees WHERE team = 'Trainer'");

  let updated = 0;
  let noEmail = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    if (!emp.email) { noEmail++; continue; }
    const result = await getConvertedTechCalls(emp.email);
    if (!result) { unmatched++; continue; }

    await db.execute({ sql: 'UPDATE employees SET tech_calls_converted = ? WHERE id = ?', args: [result.converted, emp.id] });
    updated++;
  }

  return { message: `Synced converted tech calls for ${updated} Trainer employees (${unmatched} unmatched, ${noEmail} no email).` };
}

export async function syncTbt() {
  const db = getDb();
  const { getTbtRecords } = await import('./koenigTbtApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const records = await getTbtRecords(empCode);

    await db.execute({
      sql: 'UPDATE employees SET tbt_count = ?, tbt_details = ? WHERE id = ?',
      args: [records.length, JSON.stringify(records), emp.id],
    });
    if (records.length) updated++; else unmatched++;
  }

  return { message: `Synced TBT data — ${updated} Trainer employees have at least one (${unmatched} have none).` };
}

export async function syncShoddy() {
  const db = getDb();
  const { getShoddyRecords } = await import('./koenigShoddyApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  let updated = 0;
  let unmatched = 0;
  for (const emp of allEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const { negative, positive } = await getShoddyRecords(empCode);

    await db.execute({
      sql: 'UPDATE employees SET shoddy_neg_count = ?, shoddy_neg_details = ?, shoddy_pos_count = ?, shoddy_pos_details = ? WHERE id = ?',
      args: [negative.length, JSON.stringify(negative), positive.length, JSON.stringify(positive), emp.id],
    });
    if (negative.length || positive.length) updated++; else unmatched++;
  }

  return { message: `Synced Shoddy data — ${updated} employees have at least one record (${unmatched} have none).` };
}

export async function syncMgrFeedback() {
  const db = getDb();
  const { getManagerFeedback } = await import('./koenigManagerFeedbackApi.js');

  const rows = await getManagerFeedback('01-Jan-2020', '01-Jan-2030');
  const byEmpCode = new Map();
  for (const r of rows) {
    if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
    byEmpCode.get(r.empCode).push(r);
  }

  // Emp codes get recycled, same as SC/assignments — reconstruct each
  // employee's join date from tenure_days and only count feedback dated
  // on/after it, so a reused code's prior occupant doesn't attach here.
  const allEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team')");

  // Every employee is checked against the full, successfully-fetched
  // feedback dataset (filtered to since their join date), so zero results
  // is a confirmed 0, not an unknown — write it rather than leaving
  // mgr_feedback_count null forever (null would otherwise show as "no data
  // traced" in the Worry Index instead of a real, counted 0).
  const statements = [];
  let updated = 0;
  let confirmedZero = 0;
  for (const emp of allEmployees.rows) {
    const empCode = parseInt(emp.id.replace('EMP', ''), 10);
    const since = sinceDate(emp.tenure_days);
    const all = byEmpCode.get(empCode) || [];
    const feedback = all.filter((f) => new Date(f.date) >= since).sort((a, b) => new Date(b.date) - new Date(a.date));

    const details = feedback.map((f) => ({
      managerEmpCode: f.managerEmpCode,
      managerName: f.managerName,
      strength: f.strength,
      improvement: f.improvement,
      other: f.other,
      date: f.date,
    }));
    statements.push({
      sql: 'UPDATE employees SET mgr_feedback_count = ?, mgr_feedback_details = ? WHERE id = ?',
      args: [feedback.length, JSON.stringify(details), emp.id],
    });
    if (feedback.length) updated++; else confirmedZero++;
  }

  // Same batching as syncSc/syncAssignments/syncPolls — one round trip for
  // all employee updates instead of one per employee.
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced manager feedback for ${updated} employees with matched records (${confirmedZero} confirmed at 0 since join).` };
}

export async function syncPolls() {
  const db = getDb();
  const { getPollsParticipation } = await import('./pollsApi.js');

  const allEmployees = await db.execute("SELECT id, email FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  const statements = [];
  let updated = 0;
  let noEmail = 0;
  let unmatched = 0;
  for (const emp of allEmployees.rows) {
    if (!emp.email) { noEmail++; continue; }
    const result = await getPollsParticipation(emp.email);
    if (!result) { unmatched++; continue; }

    statements.push({ sql: 'UPDATE employees SET polls_participated = ? WHERE id = ?', args: [result.participated, emp.id] });
    updated++;
  }

  // Same batching as syncSc/syncAssignments — one round trip for all
  // employee updates instead of one per employee.
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced poll participation for ${updated} employees (${unmatched} had no record on the polls dashboard, ${noEmail} had no email on file).` };
}

export async function syncKgt() {
  const db = getDb();
  const { getKgtParticipation } = await import('./kgtApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  let updated = 0;
  let unmatched = 0;
  for (const emp of allEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const result = await getKgtParticipation(empCode);
    if (!result) { unmatched++; continue; }

    await db.execute({
      sql: 'UPDATE employees SET kgt_count = ?, kgt_details = ? WHERE id = ?',
      args: [result.count, JSON.stringify(result.kgts), emp.id],
    });
    updated++;
  }

  return { message: `Synced KGT participation for ${updated} employees (${unmatched} had no record on the polls dashboard).` };
}

const GRAPH_MEETINGS_LOOKBACK_DAYS = Number(process.env.GRAPH_MEETINGS_LOOKBACK_DAYS || 7);

// A recurring/reconvened meeting keeps the same onlineMeetingId across every
// occurrence, so attendanceReports for it can span weeks/months of past
// occurrences under one id — restrict to the report(s) whose own
// meetingStartDateTime actually lines up with *this* calendar occurrence
// first, so a stale report from an unrelated earlier date never gets
// aggregated in as if the rep joined this one. Matched by email within
// those, case-insensitive since Graph's casing on attendanceRecords isn't
// guaranteed to match what's on file.
const OCCURRENCE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h either side of scheduledStart
function findAttendance(reports, email, parseGraphDateTime, scheduledStart) {
  const target = email.toLowerCase();
  const matchingReports = reports.filter((report) => {
    const reportStart = report.meetingStartDateTime ? parseGraphDateTime(report.meetingStartDateTime) : null;
    return reportStart && Math.abs(reportStart.getTime() - scheduledStart.getTime()) <= OCCURRENCE_WINDOW_MS;
  });

  let earliestJoin = null, latestLeave = null, totalSeconds = 0, found = false;
  for (const report of matchingReports) {
    for (const rec of report.attendanceRecords || []) {
      if ((rec.emailAddress || '').toLowerCase() !== target) continue;
      found = true;
      totalSeconds += rec.totalAttendanceInSeconds || 0;
      for (const interval of rec.attendanceIntervals || []) {
        const join = parseGraphDateTime(interval.joinDateTime);
        const leave = parseGraphDateTime(interval.leaveDateTime);
        if (!earliestJoin || join < earliestJoin) earliestJoin = join;
        if (!latestLeave || leave > latestLeave) latestLeave = leave;
      }
    }
  }
  return found ? { joinedAt: earliestJoin, leftAt: latestLeave, attendanceSeconds: totalSeconds } : null;
}

export async function recomputeGraphAggregates(db, employeeId) {
  const res = await db.execute({
    sql: 'SELECT timing_status, av_issue FROM graph_meetings WHERE employee_id = ?',
    args: [employeeId],
  });
  const total = res.rows.length;
  const late = res.rows.filter((r) => r.timing_status === 'Late').length;
  const missed = res.rows.filter((r) => r.timing_status === 'Did Not Join').length;
  const avIssues = res.rows.filter((r) => r.av_issue === 1).length;
  await db.execute({
    sql: 'UPDATE employees SET meetings_count = ?, meetings_late_count = ?, meetings_missed_count = ?, av_issue_count = ? WHERE id = ?',
    args: [total, late, missed, avIssues, employeeId],
  });
}

// Graph API Calls — pulls each active Sales rep's Outlook calendar for Teams
// meetings in the last GRAPH_MEETINGS_LOOKBACK_DAYS days, resolves each to
// its online meeting + attendanceReports, and records whether they joined
// on time. Audio/video quality isn't touched here at all — that only ever
// arrives via the callRecords webhook (see the graph_meetings table comment
// in lib/schema.sql), so re-running this never overwrites av_issue.
export async function syncGraphMeetings() {
  const db = getDb();
  const { getCalendarTeamsMeetings, resolveUserIdByEmail, resolveOnlineMeeting, getAttendanceReports, parseGraphDateTime, ON_TIME_GRACE_SECONDS } = await import('./graphCallsApi.js');

  const to = new Date();
  const from = new Date(to.getTime() - GRAPH_MEETINGS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const employees = await db.execute("SELECT id, email FROM employees WHERE team = 'Sales' AND active = 1");

  // The organizer/attendance endpoints need the organizer's AAD object id,
  // not their email — cache the lookup since the same organizer (e.g. a
  // sales manager running team calls) recurs across many meetings/reps.
  const organizerIdCache = new Map();
  async function organizerIdFor(email) {
    if (!organizerIdCache.has(email)) organizerIdCache.set(email, resolveUserIdByEmail(email).catch(() => null));
    return organizerIdCache.get(email);
  }

  let processed = 0, noEmail = 0, apiErrors = 0, meetingsSynced = 0;
  for (const emp of employees.rows) {
    if (!emp.email) { noEmail++; continue; }

    let events;
    try {
      events = await getCalendarTeamsMeetings(emp.email, from.toISOString(), to.toISOString());
    } catch (err) {
      console.error(`Graph calendar fetch failed for ${emp.email}:`, err.message);
      apiErrors++;
      continue;
    }

    for (const event of events) {
      const organizerEmail = event.organizer?.emailAddress?.address;
      const joinUrl = event.onlineMeeting?.joinUrl;
      if (!organizerEmail || !joinUrl) continue;

      const scheduledStart = parseGraphDateTime(event.start.dateTime);
      const scheduledEnd = event.end?.dateTime ? parseGraphDateTime(event.end.dateTime) : null;

      let timingStatus = 'No Data', joinedAt = null, leftAt = null, attendanceSeconds = null, delaySeconds = null, onlineMeetingId = null;
      try {
        const organizerId = await organizerIdFor(organizerEmail);
        const meeting = organizerId ? await resolveOnlineMeeting(organizerId, joinUrl) : null;
        if (meeting) {
          onlineMeetingId = meeting.id;
          const reports = await getAttendanceReports(organizerId, meeting.id);
          const attendance = findAttendance(reports, emp.email, parseGraphDateTime, scheduledStart);
          if (attendance) {
            joinedAt = attendance.joinedAt;
            leftAt = attendance.leftAt;
            attendanceSeconds = attendance.attendanceSeconds;
            delaySeconds = Math.round((joinedAt.getTime() - scheduledStart.getTime()) / 1000);
            timingStatus = delaySeconds <= ON_TIME_GRACE_SECONDS ? 'On Time' : 'Late';
          } else {
            timingStatus = scheduledEnd && scheduledEnd < new Date() ? 'Did Not Join' : 'No Data';
          }
        }
      } catch (err) {
        // Meeting organized outside this app's reach (e.g. an external
        // tenant), or attendance not published yet — leave as 'No Data'
        // rather than failing the whole sync over one meeting.
        if (err.status !== 404 && err.status !== 403) console.error(`Graph attendance lookup failed for ${emp.email} / ${event.subject}:`, err.message);
      }

      await db.execute({
        sql: `INSERT INTO graph_meetings (employee_id, subject, organizer_email, scheduled_start, scheduled_end, join_url, online_meeting_id, joined_at, left_at, attendance_seconds, delay_seconds, timing_status, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(employee_id, join_url, scheduled_start) DO UPDATE SET
                subject = excluded.subject, online_meeting_id = excluded.online_meeting_id,
                joined_at = excluded.joined_at, left_at = excluded.left_at,
                attendance_seconds = excluded.attendance_seconds, delay_seconds = excluded.delay_seconds,
                timing_status = excluded.timing_status, synced_at = excluded.synced_at`,
        args: [
          emp.id, event.subject || null, organizerEmail, scheduledStart.toISOString(), scheduledEnd ? scheduledEnd.toISOString() : null,
          joinUrl, onlineMeetingId, joinedAt ? joinedAt.toISOString() : null, leftAt ? leftAt.toISOString() : null,
          attendanceSeconds, delaySeconds, timingStatus, new Date().toISOString(),
        ],
      });
      meetingsSynced++;
    }

    await recomputeGraphAggregates(db, emp.id);
    processed++;
  }

  return { message: `Synced Teams meeting attendance for ${processed} Sales reps (${meetingsSynced} meetings, ${apiErrors} calendar fetch errors, ${noEmail} had no email on file).` };
}

// Keeps the callRecords webhook subscription alive — creates one if none is
// active, renews the active one once it's within a day of expiring. Must run
// at least daily (it's registered as a plain sync feed, triggered the same
// way as every other non-Vercel-cron feed — see app/api/sync/[feed]/route.js)
// since this resource's subscriptions max out at ~70 hours.
const EXTERNAL_EMAIL_LOOKBACK_DAYS = Number(process.env.EXTERNAL_EMAIL_LOOKBACK_DAYS || 30);

// Outlook Sent Items — External Email Count: for each active Sales rep,
// tallies every email sent to a non-@koenig-solutions.com address in the
// lookback window, via Graph. Purely informational (shown in the employee
// detail modal) — deliberately NOT a Worry Index signal, since emailing
// external contacts is the normal, expected shape of a Sales rep's job
// (client/vendor correspondence), not a red flag on its own.
// details is capped to the top 100 addresses by count for storage/display —
// externalEmailCount itself is always the true total across every address.
export async function syncExternalEmails() {
  const db = getDb();
  const { getSentExternalSummary } = await import('./graphMailer.js');

  const to = new Date();
  const from = new Date(to.getTime() - EXTERNAL_EMAIL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const employees = await db.execute("SELECT id, email FROM employees WHERE team = 'Sales' AND active = 1");

  let processed = 0, noEmail = 0, apiErrors = 0;
  for (const emp of employees.rows) {
    if (!emp.email) { noEmail++; continue; }
    try {
      const recipients = await getSentExternalSummary(emp.email, from.toISOString(), to.toISOString());
      const totalCount = recipients.reduce((sum, r) => sum + r.count, 0);
      await db.execute({
        sql: 'UPDATE employees SET external_email_count = ?, external_email_details = ? WHERE id = ?',
        args: [totalCount, JSON.stringify(recipients.slice(0, 100)), emp.id],
      });
      processed++;
    } catch (err) {
      console.error(`External email sync failed for ${emp.email}:`, err.message);
      apiErrors++;
    }
  }

  return { message: `Synced external email counts for ${processed} Sales reps (${apiErrors} API errors, ${noEmail} had no email on file).` };
}

// Non-RMS Tasks By EmpID — feeds the "Ideas for improvement" Worry Index
// signal (lib/data.js), across all three teams. Per-employee API, one call
// per employee, matched directly by EmpId.
export async function syncIdeas() {
  const db = getDb();
  const { getNonRmsTasks } = await import('./koenigIdeasApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  let updated = 0;
  let confirmedZero = 0;
  let apiErrors = 0;
  for (const emp of allEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    try {
      const tasks = await getNonRmsTasks(empCode);
      await db.execute({
        sql: 'UPDATE employees SET ideas_count = ?, ideas_details = ? WHERE id = ?',
        args: [tasks.length, JSON.stringify(tasks), emp.id],
      });
      if (tasks.length) updated++; else confirmedZero++;
    } catch (err) {
      console.error(`Ideas sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  }

  return { message: `Synced ideas-for-improvement tasks — ${updated} employees have at least one (${confirmedZero} confirmed at 0, ${apiErrors} API errors).` };
}

// Net Payable Details (payroll) — All teams. StartDate/EndDate must fall
// within the same calendar month (see lib/koenigNetPayableApi.js), so this
// tries the current month first and falls back one month if payroll for the
// current month hasn't been run yet (common near the start of a month).
// Purely a data sync — nothing reads net_payable_details in the UI yet.
function monthRange(monthsAgo) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  const year = d.getFullYear();
  const month = d.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    key: `${year}-${pad(month + 1)}`,
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

export async function syncNetPayable() {
  const db = getDb();
  const { getNetPayable } = await import('./koenigNetPayableApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  let apiErrors = 0;
  for (const emp of allEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    try {
      let month = monthRange(0);
      let row = await getNetPayable(empCode, month.start, month.end);
      if (!row) { month = monthRange(1); row = await getNetPayable(empCode, month.start, month.end); }
      if (!row) { unmatched++; continue; }

      statements.push({
        sql: 'UPDATE employees SET net_payable_month = ?, net_payable_details = ? WHERE id = ?',
        args: [month.key, JSON.stringify(row), emp.id],
      });
      updated++;
    } catch (err) {
      console.error(`Net payable sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  }

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced net payable details for ${updated} employees (${unmatched} had no payroll record for this or last month, ${apiErrors} API errors).` };
}

export async function syncGraphSubscription() {
  const db = getDb();
  const { createCallRecordsSubscription, renewSubscription } = await import('./graphCallsApi.js');

  const notificationUrl = `${process.env.APP_BASE_URL}/api/graph/callrecords-webhook`;
  const clientState = process.env.GRAPH_WEBHOOK_CLIENT_STATE;
  if (!clientState) throw new Error('GRAPH_WEBHOOK_CLIENT_STATE is not set — refusing to create an unauthenticated webhook subscription.');

  // Renew 60 minutes shy of the 4230-minute (~70.5h) ceiling Graph enforces
  // for the communications/callRecords resource.
  const expirationDateTime = new Date(Date.now() + 4170 * 60 * 1000).toISOString();

  const existing = await db.execute("SELECT * FROM graph_subscriptions WHERE resource = 'communications/callRecords' ORDER BY expiration_datetime DESC LIMIT 1");
  const current = existing.rows[0];

  if (current && new Date(current.expiration_datetime).getTime() - Date.now() > 24 * 60 * 60 * 1000) {
    return { message: `Existing callRecords subscription still valid until ${current.expiration_datetime} — nothing to do.` };
  }

  if (current) {
    try {
      await renewSubscription(current.id, expirationDateTime);
      await db.execute({
        sql: 'UPDATE graph_subscriptions SET expiration_datetime = ?, renewed_at = ? WHERE id = ?',
        args: [expirationDateTime, new Date().toISOString(), current.id],
      });
      return { message: `Renewed callRecords subscription ${current.id}, now valid until ${expirationDateTime}.` };
    } catch (err) {
      // Graph 404s a PATCH on a subscription that's already expired — fall
      // through and create a fresh one instead of failing the sync.
      console.error(`Renewing subscription ${current.id} failed, creating a new one:`, err.message);
    }
  }

  const created = await createCallRecordsSubscription(notificationUrl, clientState, expirationDateTime);
  await db.execute({
    sql: 'INSERT INTO graph_subscriptions (id, resource, expiration_datetime, created_at) VALUES (?, ?, ?, ?)',
    args: [created.id, 'communications/callRecords', created.expirationDateTime, new Date().toISOString()],
  });
  return { message: `Created callRecords subscription ${created.id}, valid until ${created.expirationDateTime}.` };
}

export const SYNC_RUNNERS = {
  koenig: syncKoenig,
  pip: syncPip,
  pms: syncPms,
  audit: syncAudit,
  sc: syncSc,
  csmroster: syncCsmRoster,
  util: syncUtil,
  exam: syncExam,
  negfeedback: syncNegFeedback,
  assignments: syncAssignments,
  skills: syncSkills,
  inhouseskills: syncInHouseSkills,
  techcalls: syncTechCalls,
  'techcalls-trainer': syncTechCallsTrainer,
  tbt: syncTbt,
  shoddy: syncShoddy,
  polls: syncPolls,
  kgt: syncKgt,
  mgrfeedback: syncMgrFeedback,
  ideas: syncIdeas,
  netpayable: syncNetPayable,
  graphmeetings: syncGraphMeetings,
  graphsubscription: syncGraphSubscription,
  externalemails: syncExternalEmails,
  weeklyreport: async () => {
    const { sendWeeklyReports, sendPaPipWeeklyCheckIns } = await import('./weeklyReportRunner.js');
    const nj = await sendWeeklyReports();
    const paPip = await sendPaPipWeeklyCheckIns();
    return { message: `${nj.message} | ${paPip.message}` };
  },
  weeklyresponsereport: async () => {
    const { sendWeeklyResponseReport } = await import('./weeklyResponseReportRunner.js');
    return sendWeeklyResponseReport();
  },
};
