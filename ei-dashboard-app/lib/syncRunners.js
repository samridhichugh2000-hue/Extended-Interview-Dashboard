// Server-runnable equivalents of scripts/sync-*.mjs, for use by the
// /api/sync/[feed] routes. Each function takes the shared db client (from
// getDb()) instead of creating its own, and reads credentials from
// process.env directly (already populated by Vercel — no dotenv needed here,
// unlike the standalone CLI scripts these mirror).
import { getDb } from './db';

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

function sixMonthsAgo() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export async function syncKoenig() {
  const db = getDb();
  const { getNewJoiners } = await import('./koenigApi.js');

  const { from, to } = sixMonthsAgo();
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
    } else {
      await db.execute({
        sql: `INSERT INTO employees (id, name, email, team, manager, doj, tenure_days, status, score, trend_note, hr_note, metric1, metric2, metric3, alert, active)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
        args: [nj.empId, nj.name, nj.email || null, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), nj.active ? 1 : 0],
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
  function firstSixMonths(dojIso, monthlyRevenue) {
    const doj = new Date(dojIso);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(doj.getFullYear(), doj.getMonth() + i, 1);
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

    const months = firstSixMonths(nr.doj, nr.monthlyRevenue);
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

  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const matches = audits.filter((a) => namesMatch(emp.name, a.csmName));
    if (!matches.length) { unmatched++; continue; }

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
    updated++;
  }

  return { message: `Synced audit data for ${updated} Sales employees (${unmatched} unmatched).` };
}

export async function syncSc() {
  const db = getDb();
  const { getScList } = await import('./koenigScListApi.js');

  function joinDate(tenureDays) {
    const d = new Date();
    d.setDate(d.getDate() - tenureDays);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const rows = await getScList('2020-01-01', '2030-01-01');
  const byEmpCode = new Map();
  for (const r of rows) {
    if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
    byEmpCode.get(r.empCode).push(r);
  }

  const salesEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Sales'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empCode = parseInt(emp.id.replace('EMP', ''), 10);
    const since = joinDate(emp.tenure_days);
    const all = byEmpCode.get(empCode) || [];
    const scs = all.filter((s) => new Date(s.createdOn) >= since).sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
    if (!scs.length) { unmatched++; continue; }

    const details = scs.map((s) => ({ scId: s.scId, createdOn: s.createdOn, status: s.status, quotationStatus: s.quotationStatus }));
    await db.execute({
      sql: 'UPDATE employees SET sc_raised = ?, sc_details = ? WHERE id = ?',
      args: [scs.length, JSON.stringify(details), emp.id],
    });
    updated++;
  }

  return { message: `Synced SC data for ${updated} Sales employees (${unmatched} unmatched).` };
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

  function joinDate(tenureDays) {
    const d = new Date();
    d.setDate(d.getDate() - tenureDays);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const rows = await getTrainerAssignments('2020-01-01', '2030-01-01');
  const byEmpCode = new Map();
  for (const r of rows) {
    if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
    byEmpCode.get(r.empCode).push(r);
  }

  const trainerEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Trainer'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of trainerEmployees.rows) {
    const empCode = parseInt(emp.id.replace('EMP', ''), 10);
    const since = joinDate(emp.tenure_days);
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
    await db.execute({
      sql: 'UPDATE employees SET assignments_count = ?, assignments_details = ? WHERE id = ?',
      args: [assignments.length, JSON.stringify(details), emp.id],
    });
    if (assignments.length) updated++; else unmatched++;
  }

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

export async function syncTechCalls() {
  const db = getDb();
  const { getTechCalls } = await import('./koenigTechCallApi.js');

  const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empCode = emp.id.replace('EMP', '');
    const calls = await getTechCalls(empCode);

    await db.execute({
      sql: 'UPDATE employees SET tech_calls_count = ?, tech_calls_details = ? WHERE id = ?',
      args: [calls.length, JSON.stringify(calls), emp.id],
    });
    if (calls.length) updated++; else unmatched++;
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

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team')");

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

export const SYNC_RUNNERS = {
  koenig: syncKoenig,
  pip: syncPip,
  pms: syncPms,
  audit: syncAudit,
  sc: syncSc,
  util: syncUtil,
  exam: syncExam,
  negfeedback: syncNegFeedback,
  assignments: syncAssignments,
  skills: syncSkills,
  techcalls: syncTechCalls,
  'techcalls-trainer': syncTechCallsTrainer,
  tbt: syncTbt,
  shoddy: syncShoddy,
};
