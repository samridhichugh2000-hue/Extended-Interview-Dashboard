// Server-runnable equivalents of scripts/sync-*.mjs, for use by the
// /api/sync/[feed] routes. Each function takes the shared db client (from
// getDb()) instead of creating its own, and reads credentials from
// process.env directly (already populated by Vercel — no dotenv needed here,
// unlike the standalone CLI scripts these mirror).
import { getDb } from './db.js';
import { loadExcludedIds, removeEmployees, isBlueCollarDesignation } from './excludedEmployees.js';
import { isExcludedGraphMeeting } from './meetingFilters.js';

// Used by syncSc/syncAssignments/syncMgrFeedback — reconstructs an
// employee's join date from tenure_days (for recycled-emp-code exclusion),
// capped to at most `lookbackDays` regardless of actual tenure, so a
// multi-year veteran's count reflects recent activity, not a full-career
// total (e.g. 1074 SCs raised over 18 years isn't a meaningful figure).
// SC/Assignments use 2 years; Manager Feedback uses 1 year (see call sites).
function sinceDate(tenureDays, lookbackDays) {
  const joined = new Date();
  joined.setDate(joined.getDate() - tenureDays);
  joined.setHours(0, 0, 0, 0);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
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

// Runs `fn` over `items` with at most `limit` in flight at once. A plain
// sequential loop over the ~350-500 rows these per-employee feeds each hit
// (one Koenig API round-trip per row, ~300ms-1s each) takes 1-6 minutes —
// well past Vercel's 60s function limit, so the cron route gets killed
// mid-loop and only the first N rows it managed ever get updated (confirmed
// live for exam/negfeedback/skills/inhouseskills/tbt/techcalls-trainer: only
// ~57-90 of ~324 active Trainers were ever synced in production). Bounded
// concurrency keeps every one of these comfortably under that cap.
export async function mapWithConcurrency(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
const SYNC_CONCURRENCY = 20;

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
  const excludedIds = await loadExcludedIds(db);
  const newJoiners = rawNewJoiners
    .filter((nj) => nj.section !== null && nj.empId)
    .filter((nj) => !excludedIds.has(normalizeEmpId(nj.empId)))
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
        // Solutions Managers are FM wherever Koenig files their department.
        sql: `UPDATE employees SET name = ?, email = ?, team = CASE WHEN ? = 'PT Team' AND trim(designation) = 'Solutions Manager' THEN 'FM Team' ELSE ? END, manager = ?, doj = ?, tenure_days = ?, active = ?
              WHERE id = ?`,
        args: [nj.name, nj.email || null, nj.section, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), nj.active ? 1 : 0, nj.empId],
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

  // Batched into one round trip (same fix as syncSc/syncAssignments) instead
  // of a DELETE+INSERTs+UPDATE per employee — this now also runs inline at
  // the top of the weeklyreport cron (see SYNC_RUNNERS.weeklyreport below),
  // so it needs to stay well clear of Vercel Hobby's 60s function limit
  // rather than only being fast enough for its own standalone cron-job.org
  // schedule.
  const statements = [];
  let updated = 0;
  for (const [employeeId, incidents] of byEmployee) {
    incidents.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
    const current = incidents.find((i) => i.isActive) || null;

    statements.push({ sql: 'DELETE FROM pip_status WHERE employee_id = ?', args: [employeeId] });
    for (const i of incidents) {
      statements.push({
        sql: `INSERT INTO pip_status (employee_id, type, issued_on, review_by, breaches, comment, is_active, source_id)
              VALUES (?, ?, ?, ?, '[]', ?, ?, ?)`,
        args: [employeeId, i.type, i.fromDate || '—', i.toDate || '—', i.comment, i.isActive ? 1 : 0, i.sourceId],
      });
    }

    const status = current ? (current.type === 'PIP' ? 'PIP Issued' : 'PA Issued') : 'In Progress';
    statements.push({
      sql: 'UPDATE employees SET status = ?, hr_note = ? WHERE id = ?',
      args: [status, current ? current.comment : null, employeeId],
    });
    updated++;
  }

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced ${rows.length} incidents; ${byEmployee.size} matched; ${updated} employee records updated.` };
}

export async function syncPms() {
  const db = getDb();
  const { getEmployeeNr } = await import('./koenigNrApi.js');

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthKey(date) {
    return `${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
  }
  // Month keys ("Jul-2026") as a sortable index (year * 12 + month).
  function monthIndex(key) {
    const [mon, year] = key.split('-');
    return Number(year) * 12 + MONTHS.indexOf(mon);
  }
  // employees.doj is a display string like "19 May 25" / "07 Sept 26" (some
  // rows spell September out) — only the month and year matter here.
  function dojMonthIndex(doj) {
    const m = /^\d{1,2}\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})$/.exec(String(doj || '').trim());
    if (!m) return null;
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    if (mon < 0) return null;
    const year = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
    return year * 12 + mon;
  }
  function formatLakhs(raw) {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    return '₹' + (n / 100000).toFixed(1) + 'L';
  }
  function parseNR(raw) {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }
  // Trailing 6 calendar months ending with the current one. M1 is the oldest
  // of the 6, M6 the most recent, same left-to-right convention as the six
  // metric columns the Sales table renders.
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
  // Chronological (oldest first) so trailing-N-month windows (Sales PA Algo)
  // can just slice off the end.
  function fullHistory(monthlyRevenue) {
    return Object.entries(monthlyRevenue)
      .map(([month, raw]) => ({ month, nr: parseNR(raw) }))
      .sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
  }
  const nameTokens = (n) => String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  // The NR API returns a fixed 24-month window (May-2025 .. Apr-2027) for
  // every CCE, zero-filled — including months before the person joined and
  // months still to come. History is cut to [DOJ month .. current month]
  // (so a trailing-12 average never counts pre-joining zeros, matching what
  // the old per-range API returned) and months after the current one become
  // the future-NR view.
  const nrRows = await getEmployeeNr();

  const now = new Date();
  const currentIdx = now.getFullYear() * 12 + now.getMonth();
  const futureMonthKeys = [];
  for (let i = 1; i <= 6; i++) futureMonthKeys.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));

  const salesEmployees = await db.execute("SELECT id, name, doj FROM employees WHERE team = 'Sales'");

  // Matching: by EmpId when the API supplies one; otherwise by name, which
  // needs care (it carries a trailing "-" and nicknames like "Gourav Garg
  // Gabe", and we have genuinely different people with near-identical names,
  // e.g. Subham Saha / Shubham Saha). A name matches only when the employee's
  // name tokens are an exact leading prefix of the API's, and only when that
  // pairing is one-to-one — anything ambiguous is skipped, never guessed.
  const hasEmpIds = nrRows.some((r) => r.empId != null);
  const rowByEmpId = new Map(nrRows.filter((r) => r.empId != null).map((r) => [r.empId, r]));
  const claims = new Map();
  const candidatesFor = new Map();
  if (!hasEmpIds) {
    for (const row of salesEmployees.rows) {
      const toks = nameTokens(row.name);
      const cands = toks.length
        ? nrRows.filter((r) => { const t = nameTokens(r.name); return t.length >= toks.length && toks.every((x, i) => t[i] === x); })
        : [];
      candidatesFor.set(row.id, cands);
      for (const c of cands) claims.set(c, (claims.get(c) || 0) + 1);
    }
  }

  let updated = 0;
  let unmatched = 0;
  let ambiguous = 0;
  for (const row of salesEmployees.rows) {
    let nr;
    if (hasEmpIds) {
      nr = rowByEmpId.get(parseInt(row.id.replace('EMP', ''), 10));
    } else {
      const cands = candidatesFor.get(row.id) || [];
      if (cands.length > 1 || (cands.length === 1 && claims.get(cands[0]) > 1)) { ambiguous++; continue; }
      nr = cands[0];
    }
    if (!nr) { unmatched++; continue; }

    const dojIdx = dojMonthIndex(row.doj);
    const monthlyRevenue = {};
    const futureRev = {};
    for (const [month, raw] of Object.entries(nr.monthlyRevenue)) {
      const idx = monthIndex(month);
      if (idx > currentIdx) futureRev[month] = raw;
      else if (dojIdx == null || idx >= dojIdx) monthlyRevenue[month] = raw;
    }
    const months = lastSixMonths(monthlyRevenue);
    const history = fullHistory(monthlyRevenue);
    // Next 6 months at most — and only months the API actually returns: its
    // columns end at a fixed month, so past that point a month is dropped
    // rather than shown as a made-up ₹0.
    const future = futureMonthKeys
      .filter((month) => futureRev[month] !== undefined)
      .map((month) => ({ month, nr: parseNR(futureRev[month]) }));
    await db.execute({
      sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ?, nr_monthly_details = ?, nr_future_details = ? WHERE id = ?',
      args: [...months, JSON.stringify(history), JSON.stringify(future), row.id],
    });
    updated++;
  }

  // Team NR — for managers. Every NR row carries its CCE's Manager, so a
  // manager's team is the rows whose Manager is that person (direct reports
  // only). Stored as a monthly series (months up to the current one) for the
  // manager-level (ASM) quarter target, which is crore-scale and set against
  // the manager's own NR *plus* their team's. Names are matched exactly
  // (normalized, one employee per name); anyone who manages nobody gets null.
  const normName = (n) => nameTokens(n).join(' ');
  const rowsByManager = new Map();
  for (const r of nrRows) {
    const k = normName(r.manager);
    if (!k) continue;
    if (!rowsByManager.has(k)) rowsByManager.set(k, []);
    rowsByManager.get(k).push(r);
  }
  const nameCounts = new Map();
  for (const row of salesEmployees.rows) nameCounts.set(normName(row.name), (nameCounts.get(normName(row.name)) || 0) + 1);
  const teamStatements = [];
  let managers = 0;
  for (const row of salesEmployees.rows) {
    const k = normName(row.name);
    const team = nameCounts.get(k) === 1 ? rowsByManager.get(k) : null;
    let details = null;
    if (team?.length) {
      const totals = new Map();
      for (const r of team) {
        for (const [month, raw] of Object.entries(r.monthlyRevenue)) {
          if (monthIndex(month) > currentIdx) continue;
          totals.set(month, (totals.get(month) || 0) + parseNR(raw));
        }
      }
      details = [...totals.entries()]
        .map(([month, nr]) => ({ month, nr: Math.round(nr * 100) / 100, members: team.length }))
        .sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
      managers++;
    }
    teamStatements.push({ sql: 'UPDATE employees SET team_nr_details = ? WHERE id = ?', args: [details ? JSON.stringify(details) : null, row.id] });
  }
  if (teamStatements.length) await db.batch(teamStatements, 'write');

  return { message: `Synced NR for ${updated} Sales employees (${unmatched} not in the NR API${ambiguous ? `, ${ambiguous} skipped — ambiguous name match` : ''}); team NR for ${managers} managers.` };
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
    const since = sinceDate(emp.tenure_days, 730);
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

export async function syncTargetAchievement() {
  const db = getDb();
  const { getTargetAchievement } = await import('./koenigTargetApi.js');

  // Koenig's own QuarterName isn't a fixed vocabulary we can trust to sort
  // lexically ("Q10" < "Q2" as strings) — pull the leading number out of it
  // and compare (year, quarter number) pairs so "most recent" is always the
  // latest quarter actually on file, regardless of naming.
  function quarterNum(name) {
    const m = String(name || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function isNewer(a, b) {
    if (!b) return true;
    const ay = parseInt(a.quarterYear, 10) || 0;
    const by = parseInt(b.quarterYear, 10) || 0;
    if (ay !== by) return ay > by;
    return quarterNum(a.quarterName) > quarterNum(b.quarterName);
  }

  const rows = await getTargetAchievement();
  const latestByEmpId = new Map();
  for (const r of rows) {
    const current = latestByEmpId.get(r.empId);
    if (isNewer(r, current)) latestByEmpId.set(r.empId, r);
  }

  const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empId = parseInt(emp.id.replace('EMP', ''), 10);
    const target = latestByEmpId.get(empId);
    if (!target) { unmatched++; continue; }

    statements.push({
      sql: 'UPDATE employees SET quarter_target_pct = ?, quarter_target_name = ?, quarter_target_year = ?, quarter_target_remarks = ? WHERE id = ?',
      args: [
        target.achievedPct != null ? parseFloat(target.achievedPct) : null,
        target.quarterName || null,
        target.quarterYear || null,
        target.remarks || null,
        emp.id,
      ],
    });
    updated++;
  }

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced quarter target achievement for ${updated} Sales employees (${unmatched} unmatched).` };
}

// Get Targets Data (lib/koenigTargetsDataApi.js) has real, current target
// figures — unlike Get Target Achieved Details above, which has returned
// zero rows for every query tried. It gives the target amount, not an
// achievement %, so this writes quarter_target_amount (a column
// syncTargetAchievement never touches) and leaves quarter_target_pct alone;
// DashboardClient.js's quarterTargetLabel computes the % itself from this
// amount and the employee's already-synced current-quarter NR.
export async function syncTargetsData() {
  const db = getDb();
  const { getTargetsData } = await import('./koenigTargetsDataApi.js');
  const { currentQuarter, TARGET_QUARTERS } = await import('./paAlgo.js');

  const { name: qName, year: qYear } = currentQuarter();

  const rows = await getTargetsData();
  const byEmpId = new Map();
  // Every shown quarter's target per employee, same CSM > CM > ASM priority.
  const byEmpQuarters = new Map();
  // Rupee targets come as type 'CSM' - and as 'CM' for a few Sales reps (e.g.
  // Umar Farooq), whose target was silently dropped when only 'CSM' was kept.
  // Sales managers (Dinesh Jha, Kunal Singh, Neha Shah, ...) carry theirs as
  // 'ASM' (crore-scale) — it's their own target, so it's used too, but only
  // when they have no CSM/CM row for the quarter. Priority: CSM > CM > ASM.
  // 'DM' (Trainers, unit counts) is deliberately left out.
  const RANK = { CSM: 3, CM: 2, ASM: 1 };
  for (const r of rows) {
    if (!RANK[r.type]) continue;
    if (TARGET_QUARTERS.some((q) => q.name === r.targetName && q.year === Number(r.targetYear))) {
      const key = `${r.empId}|${r.targetName}|${r.targetYear}`;
      const have = byEmpQuarters.get(key);
      if (!have || RANK[r.type] > RANK[have.type]) byEmpQuarters.set(key, r);
    }
    if (r.targetName !== qName || Number(r.targetYear) !== qYear) continue;
    const have = byEmpId.get(r.empId);
    if (have && RANK[have.type] >= RANK[r.type]) continue;
    byEmpId.set(r.empId, r);
  }

  const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  for (const emp of salesEmployees.rows) {
    const empId = parseInt(emp.id.replace('EMP', ''), 10);
    const quarterTargets = TARGET_QUARTERS
      .map((q) => byEmpQuarters.get(`${empId}|${q.name}|${q.year}`))
      .filter(Boolean)
      .map((r) => ({ name: r.targetName, year: Number(r.targetYear), amount: r.target, type: r.type }));
    statements.push({ sql: 'UPDATE employees SET quarter_targets = ? WHERE id = ?', args: [quarterTargets.length ? JSON.stringify(quarterTargets) : null, emp.id] });
    const target = byEmpId.get(empId);
    if (!target) { unmatched++; continue; }

    statements.push({
      sql: 'UPDATE employees SET quarter_target_amount = ?, quarter_target_name = ?, quarter_target_year = ?, quarter_target_type = ? WHERE id = ?',
      args: [target.target, target.targetName, String(target.targetYear), target.type, emp.id],
    });
    updated++;
  }

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced ${qName} ${qYear} CSM target amount for ${updated} Sales employees (${unmatched} unmatched).` };
}

// Sales Pipeline (lib/koenigPipelineApi.js) — per-CSM only, ~3s per call and
// explicitly not meant to be hammered across a whole team at once, so this
// runs strictly sequentially (no concurrency, unlike every other per-
// employee sync here) with a short pause between calls. For ~100+ Sales
// employees that's several minutes — fine for the local Windows Task,
// too slow for a single Vercel serverless invocation, so this is meant to
// run via scripts/sync-pipeline.mjs in scripts/sync-all.mjs, not the
// /api/sync/[feed] route (though it's still registered there for ad-hoc
// testing against a handful of employees).
const PIPELINE_CALL_DELAY_MS = 300;
export async function syncPipeline() {
  const db = getDb();
  const { getSalesPipeline } = await import('./koenigPipelineApi.js');

  const salesEmployees = await db.execute("SELECT id, email FROM employees WHERE team = 'Sales' AND active = 1");

  let updated = 0, notFound = 0, noEmail = 0, apiErrors = 0;
  for (const emp of salesEmployees.rows) {
    if (!emp.email) { noEmail++; continue; }
    try {
      const pipeline = await getSalesPipeline(emp.email);
      if (pipeline.status === 'CSM_NOT_FOUND') { notFound++; continue; }

      await db.execute({
        sql: `UPDATE employees SET pipeline_months = ?, pipeline_undated_nr = ?, pipeline_undated_deals = ?, pipeline_total_nr = ?, pipeline_total_deals = ?, pipeline_synced_at = ? WHERE id = ?`,
        args: [
          JSON.stringify(pipeline.months), pipeline.undated.expectedNR, pipeline.undated.deals,
          pipeline.totalNR, pipeline.totalDeals, new Date().toISOString(), emp.id,
        ],
      });
      updated++;
    } catch (err) {
      console.error(`Pipeline sync failed for ${emp.email}:`, err.message);
      apiErrors++;
    }
    await new Promise((resolve) => setTimeout(resolve, PIPELINE_CALL_DELAY_MS));
  }

  return { message: `Synced Sales Pipeline for ${updated} CSMs (${notFound} not found on the pipeline system, ${apiErrors} API errors, ${noEmail} had no email on file).` };
}

// `onlyIds` (optional array of employee ids) re-runs just those trainers — used
// to retry the few whose months timed out on a full run.
export async function syncUtil({ onlyIds } = {}) {
  const db = getDb();
  const { getMonthlyScHours } = await import('./koenigUtilScApi.js');
  const { computeUtilization } = await import('./utilization.js');

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthKey = (year, m) => `${MONTHS[m]} ${year}`;
  // employees.doj is a display string like "19 May 25" / "07 Sept 26" — only
  // the month and year matter (months before joining are not fetched).
  function dojMonthIndex(doj) {
    const m = /^\d{1,2}\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})$/.exec(String(doj || '').trim());
    if (!m) return null;
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    if (mon < 0) return null;
    const year = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
    return year * 12 + mon;
  }
  // Trailing 6 calendar months ending with the current one (the 6 shown on the
  // Trainer table). M1 is the oldest, M6 the most recent.
  function lastSixMonths(byMonth) {
    const now = new Date();
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const rec = byMonth.get(monthKey(d.getFullYear(), d.getMonth()));
      out.push(rec ? `${Math.round(rec.util)}%` : '—');
    }
    return out;
  }

  // The PA Algo's longest window is 360 days (12 months) — fetch the trailing
  // 12 completed months plus the current one, trimmed to the DOJ month (a
  // month before someone joined is "not employed", not 0% utilization).
  const HISTORY_MONTHS = 13;
  const now = new Date();
  const currentIdx = now.getFullYear() * 12 + now.getMonth();
  const startIdx = currentIdx - (HISTORY_MONTHS - 1);

  const allTrainers = await db.execute("SELECT id, doj FROM employees WHERE team = 'Trainer'");
  const trainers = { rows: onlyIds ? allTrainers.rows.filter((t) => onlyIds.includes(t.id)) : allTrainers.rows };

  // One call per (trainer, month) — flat task list over the shared concurrency
  // pool rather than a nested loop, so slow trainers don't hold up the rest.
  const tasks = [];
  for (const t of trainers.rows) {
    const from = Math.max(startIdx, dojMonthIndex(t.doj) ?? startIdx);
    for (let idx = from; idx <= currentIdx; idx++) tasks.push({ id: t.id, idx });
  }
  const byTrainer = new Map();
  const failed = new Set();
  // 8 in flight, not the usual 20: this feed's calls are heavy on Koenig's
  // side (~1.5s each) and 20 at once made them time out server-side.
  await mapWithConcurrency(tasks, 8, async ({ id, idx }) => {
    try {
      const year = Math.floor(idx / 12);
      const m = idx % 12;
      const hrs = await getMonthlyScHours(id.replace('EMP', ''), year, m);
      if (!byTrainer.has(id)) byTrainer.set(id, new Map());
      byTrainer.get(id).set(monthKey(year, m), {
        month: monthKey(year, m),
        idx,
        scHours: hrs.scHours,
        nonScHours: hrs.nonScHours,
        hours: hrs.totalHours,
        ...computeUtilization(hrs.scHours, hrs.nonScHours),
      });
    } catch (err) {
      console.error(`Utilization SC/NonSC failed for ${id} (${idx}):`, err.message);
      failed.add(id);
    }
  });

  // A trainer with any failed month keeps its previous data rather than being
  // overwritten with a partial history.
  const statements = [];
  let updated = 0;
  for (const t of trainers.rows) {
    const byMonth = byTrainer.get(t.id);
    if (!byMonth || failed.has(t.id)) continue;
    const history = [...byMonth.values()]
      .sort((a, b) => a.idx - b.idx)
      .map(({ idx, ...rest }) => rest);
    statements.push({
      sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ?, util_monthly_details = ? WHERE id = ?',
      args: [...lastSixMonths(byMonth), JSON.stringify(history), t.id],
    });
    updated++;
  }
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced SC + Non-SC utilization for ${updated} Trainer employees (${failed.size} kept previous data after API errors).` };
}

export async function syncExam() {
  const db = getDb();
  const { getExamDetails } = await import('./koenigExamApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    const summary = await getExamDetails(empCode);
    if (!summary) { unmatched++; return; }

    statements.push({
      sql: 'UPDATE employees SET exam_pass = ?, exam_fail = ?, exam_total = ?, exam_not_updated = ?, exam_details = ? WHERE id = ?',
      args: [summary.passCount, summary.failCount, summary.totalExam, summary.statusNotUpdated, JSON.stringify(summary.exams), emp.id],
    });
    updated++;
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced exam data for ${updated} Trainer employees (${unmatched} unmatched).` };
}

export async function syncNegFeedback() {
  const db = getDb();
  const { getTrainerNegativeFeedback } = await import('./koenigNegativeFeedbackApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  const statements = [];
  let updated = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    const feedback = await getTrainerNegativeFeedback(empCode);

    statements.push({
      sql: 'UPDATE employees SET neg_feedback = ?, neg_feedback_details = ? WHERE id = ?',
      args: [feedback.length, JSON.stringify(feedback), emp.id],
    });
    if (feedback.length) updated++;
  });

  if (statements.length) await db.batch(statements, 'write');

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
    const since = sinceDate(emp.tenure_days, 730);
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

// Distinct assignments each Trainer was Main Trainer on, from the Trainer RC
// Schedule feed (koenigTrainerRcApi.js) — unlike syncAssignments above, this
// feed's TrainerRole field tells a lead trainer apart from a co/backup
// trainer on the same batch, which the plain Trainer Assignment feed can't.
// Feeds the PA Algo's "zero assignments as main trainer" check only — not a
// replacement for assignments_count/assignments_details, which several
// other screens/signals still read. Per-employee API (no bulk mode), like
// syncUtil/syncEmployeeDetails — see mapWithConcurrency above. Same
// recycled-emp-code/2-year lookback guard as syncAssignments, and stops at
// today rather than reaching into the future — a scheduled-but-undelivered
// batch shouldn't count as "has delivered a main assignment" yet.
export async function syncTrainerRc() {
  const db = getDb();
  const { getTrainerRcSchedule, distinctMainTrainerAssignments } = await import('./koenigTrainerRcApi.js');
  const { istDateKey } = await import('./weekUtils.js');

  // Only the PA Algo's 0-3 month trainers use this (see sync-trainerrc.mjs).
  const trainerEmployees = await db.execute("SELECT id, email, tenure_days FROM employees WHERE team = 'Trainer' AND active = 1 AND tenure_days <= 100");
  const today = istDateKey(new Date());

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  let skippedNoEmail = 0;
  let apiErrors = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    if (!emp.email) { skippedNoEmail++; return; }
    try {
      const since = sinceDate(emp.tenure_days, 730);
      const rows = await getTrainerRcSchedule(emp.email, istDateKey(since), today);
      const assignments = distinctMainTrainerAssignments(rows);
      statements.push({
        sql: 'UPDATE employees SET rc_main_assignments_count = ?, rc_main_assignments_details = ? WHERE id = ?',
        args: [assignments.length, JSON.stringify(assignments), emp.id],
      });
      if (assignments.length) updated++; else unmatched++;
    } catch (err) {
      console.error(`Trainer RC sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced Main Trainer assignments for ${updated} Trainer employees (${unmatched} have none, ${skippedNoEmail} no email on file, ${apiErrors} API errors).` };
}

// Precomputes whether each active Trainer is "fully booked" (40+ Scheduled
// Class hours) for the coming ISO week, so weeklyReportRunner's Monday
// check-in send (excludeFullyBookedTrainers) can just read the result off
// the employees row instead of calling Koenig's RC Schedule API live, once
// per Trainer, inside its own 60s-limited request — that inline loop is what
// timed the whole 2026-09-28 Monday send out before any NJ/PA/PIP check-in
// email went out. Runs on Vercel Cron (vercel.json) every Sunday at 18:00 and 21:30 IST for the
// coming Monday-Sunday week — the second run refreshes the first. A no-op on
// every other day.
export async function syncTrainerFullyBooked() {
  const { nextIstDayIsoWeek, weekDateRange, istDateKey, isSundayIst } = await import('./weekUtils.js');
  // Runs on Sunday (IST) for the week that starts the next morning, so
  // Monday's check-in send finds the result already stored instead of
  // depending on a job finishing in the hour before it.
  if (!isSundayIst()) {
    return { message: 'Skipped — RC fully-booked check only runs Sunday (IST), for the coming Monday-Sunday week.' };
  }

  const db = getDb();
  const { getTrainerRcSchedule, totalScHours } = await import('./koenigTrainerRcApi.js');

  const week = nextIstDayIsoWeek(new Date());
  const { start, end } = weekDateRange(week);
  const fromDate = istDateKey(start);
  const toDate = istDateKey(end);

  const trainerEmployees = await db.execute("SELECT id, email FROM employees WHERE team = 'Trainer' AND active = 1");

  const statements = [];
  let checked = 0;
  let skippedNoEmail = 0;
  let apiErrors = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    if (!emp.email) { skippedNoEmail++; return; }
    try {
      const rows = await getTrainerRcSchedule(emp.email, fromDate, toDate);
      const hours = totalScHours(rows);
      statements.push({
        sql: 'UPDATE employees SET rc_fully_booked_week = ?, rc_fully_booked_sc_hours = ? WHERE id = ?',
        args: [week, hours, emp.id],
      });
      checked++;
    } catch (err) {
      // Leaves this employee's rc_fully_booked_week stale (not this week) —
      // weeklyReportRunner treats that as "no data" and fails open (sends
      // the check-in anyway) rather than silently going quiet on them.
      console.error(`RC fully-booked check failed for ${emp.id}, leaving stale:`, err.message);
      apiErrors++;
    }
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Checked RC schedule for ${checked} active Trainers for ${week} (${skippedNoEmail} no email on file, ${apiErrors} API errors — those fail open in Monday's check-in send).` };
}

export async function syncSkills() {
  const db = getDb();
  const { getTrainerSkills } = await import('./koenigSkillsApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    const skills = await getTrainerSkills(empCode);

    statements.push({
      sql: 'UPDATE employees SET skills_count = ?, skills_details = ? WHERE id = ?',
      args: [skills.length, JSON.stringify(skills), emp.id],
    });
    if (skills.length) updated++; else unmatched++;
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced skills — ${updated} Trainer employees have at least one (${unmatched} have none).` };
}

export async function syncInHouseSkills() {
  const db = getDb();
  const { getInHouseSkills } = await import('./koenigInHouseSkillsApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    const skills = await getInHouseSkills(empCode);

    statements.push({
      sql: 'UPDATE employees SET in_house_skills_count = ?, in_house_skills_details = ? WHERE id = ?',
      args: [skills.length, JSON.stringify(skills), emp.id],
    });
    if (skills.length) updated++; else unmatched++;
  });

  if (statements.length) await db.batch(statements, 'write');

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
      args: [result ? result.techCalls : 0, JSON.stringify(result ? result.calls : []), emp.id],
    });
    if (result) updated++; else unmatched++;
  }

  return { message: `Synced tech calls — ${updated} Sales employees have at least one (${unmatched} have none).` };
}

export async function syncTechCallsTrainer() {
  const db = getDb();
  const { getTrainerTechCalls } = await import('./koenigTrainerTechCallsApi.js');

  // The feed needs a date range and ignores its EmpCode filter, so pull every
  // trainer's calls for the last 6 months in one request and group by code.
  const end = new Date(Date.now() + 5.5 * 3600000); // IST today
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  const calls = await getTrainerTechCalls(iso(start), iso(end));
  if (!calls.length) throw new Error('Trainer tech calls API returned no rows — leaving existing data untouched.');

  const byCode = new Map();
  for (const c of calls) {
    if (!byCode.has(c.empCode)) byCode.set(c.empCode, []);
    byCode.get(c.empCode).push({ callId: c.callId, name: c.name, date: c.date, client: c.client, converted: c.converted });
  }

  const trainers = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");
  const statements = [];
  let withCalls = 0;
  for (const emp of trainers.rows) {
    const list = byCode.get(String(emp.id).replace(/^EMP/i, '')) || [];
    if (list.length) withCalls++;
    statements.push({
      sql: 'UPDATE employees SET tech_calls_converted = ?, tech_calls_converted_details = ? WHERE id = ?',
      args: [list.filter((c) => c.converted).length, JSON.stringify(list), emp.id],
    });
  }
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced trainer tech calls — ${calls.length} calls, ${withCalls} of ${trainers.rows.length} Trainer employees have at least one.` };
}

export async function syncTbt() {
  const db = getDb();
  const { getTbtRecords } = await import('./koenigTbtApi.js');

  const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  await mapWithConcurrency(trainerEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    const records = await getTbtRecords(empCode);

    statements.push({
      sql: 'UPDATE employees SET tbt_count = ?, tbt_details = ? WHERE id = ?',
      args: [records.length, JSON.stringify(records), emp.id],
    });
    if (records.length) updated++; else unmatched++;
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced TBT data — ${updated} Trainer employees have at least one (${unmatched} have none).` };
}

export async function syncShoddy() {
  const db = getDb();
  const { getShoddyRecords } = await import('./koenigShoddyApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team') AND active = 1");

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
  const allEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team')");

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
    const since = sinceDate(emp.tenure_days, 365);
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

  const allEmployees = await db.execute("SELECT id, email FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team') AND active = 1");

  const statements = [];
  let updated = 0;
  let noEmail = 0;
  let unmatched = 0;
  for (const emp of allEmployees.rows) {
    if (!emp.email) { noEmail++; continue; }
    const result = await getPollsParticipation(emp.email);
    if (!result) { unmatched++; continue; }

    statements.push({ sql: 'UPDATE employees SET polls_participated = ?, polls_details = ? WHERE id = ?', args: [result.participated, JSON.stringify(result.polls), emp.id] });
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

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team') AND active = 1");

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

// Interviews scheduled per FM, matched by email. The API only lists FMs with
// interviews in the window, so active FM Team members it omits get a real 0.
export async function syncFmInterviews() {
  const db = getDb();
  const { getFmInterviews, FM_INTERVIEWS_LOOKBACK_DAYS } = await import('./fmInterviewsApi.js');

  const istDay = (offsetDays) => new Date(Date.now() + 330 * 60000 - offsetDays * 86400000).toISOString().slice(0, 10);
  const byEmail = await getFmInterviews(istDay(FM_INTERVIEWS_LOOKBACK_DAYS), istDay(0));

  const fms = await db.execute("SELECT id, email FROM employees WHERE team = 'FM Team' AND active = 1");
  let withInterviews = 0;
  let noEmail = 0;
  const statements = [];
  for (const fm of fms.rows) {
    if (!fm.email) { noEmail++; continue; }
    const hit = byEmail.get(String(fm.email).toLowerCase());
    if (hit) withInterviews++;
    statements.push({
      sql: 'UPDATE employees SET fm_interviews_count = ?, fm_interviews_details = ? WHERE id = ?',
      args: [hit ? hit.total : 0, JSON.stringify(hit ? hit.byDate : []), fm.id],
    });
  }
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced interviews for ${statements.length} FMs (${withInterviews} had interviews in the last ${FM_INTERVIEWS_LOOKBACK_DAYS} days, ${noEmail} had no email on file).` };
}

// Interviews created per recruiter over the trailing 6 calendar months (the
// first of the month five months back, up to today) from the Koenig common
// API, one call per active Recruitment Team member keyed by emp code. Details
// are grouped per day with the slot time and interviewer of each interview.
export async function syncRecruiterInterviews() {
  const db = getDb();
  const { getRecruiterInterviews } = await import('./koenigApi.js');

  const istDay = (offsetDays) => new Date(Date.now() + 330 * 60000 - offsetDays * 86400000).toISOString().slice(0, 10);
  const to = istDay(0);
  const [y, m] = to.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - 5, 1));
  const from = first.toISOString().slice(0, 10);

  const recruiters = await db.execute("SELECT id FROM employees WHERE team = 'Recruitment Team' AND active = 1");
  let withInterviews = 0;
  let failed = 0;
  const statements = [];
  for (const rec of recruiters.rows) {
    let rows;
    try {
      rows = await getRecruiterInterviews(String(rec.id).replace('EMP', ''), from, to);
    } catch {
      failed++;
      continue;
    }
    const byDay = new Map();
    for (const r of rows) {
      const day = String(r.date).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { date: day, count: 0, interviews: [] });
      const d = byDay.get(day);
      d.count++;
      d.interviews.push({ time: String(r.date).slice(11, 16), interviewer: r.interviewer });
    }
    if (rows.length) withInterviews++;
    statements.push({
      sql: 'UPDATE employees SET recruiter_interviews_count = ?, recruiter_interviews_details = ? WHERE id = ?',
      args: [rows.length, JSON.stringify([...byDay.values()]), rec.id],
    });
  }
  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced interviews for ${statements.length} recruiters (${withInterviews} had interviews since ${from}, ${failed} failed).` };
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
    sql: 'SELECT g.subject, g.timing_status, g.av_issue, g.client_emails, e.team FROM graph_meetings g JOIN employees e ON e.id = g.employee_id WHERE g.employee_id = ?',
    args: [employeeId],
  });
  const rows = res.rows.filter((r) => {
    let clients = [];
    try { clients = JSON.parse(r.client_emails || '[]'); } catch { /* treat as internal */ }
    return !isExcludedGraphMeeting(r.subject, r.team, clients);
  });
  const total = rows.length;
  const late = rows.filter((r) => r.timing_status === 'Late').length;
  const missed = rows.filter((r) => r.timing_status === 'Did Not Join').length;
  const avIssues = rows.filter((r) => r.av_issue === 1).length;
  const externalMeetings = rows.filter((r) => {
    try { return JSON.parse(r.client_emails || '[]').length > 0; } catch { return false; }
  }).length;
  await db.execute({
    sql: 'UPDATE employees SET meetings_count = ?, meetings_late_count = ?, meetings_missed_count = ?, av_issue_count = ?, external_meetings_count = ? WHERE id = ?',
    args: [total, late, missed, avIssues, externalMeetings, employeeId],
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
  const { isExternalAddress } = await import('./graphMailer.js');

  const to = new Date();
  const from = new Date(to.getTime() - GRAPH_MEETINGS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // All active Sales + Assistant Technical Managers (a Trainer-team designation).
  const employees = await db.execute("SELECT id, email, team FROM employees WHERE active = 1 AND (team = 'Sales' OR (team = 'Trainer' AND trim(designation) = 'Assistant Technical Manager'))");

  // The organizer/attendance endpoints need the organizer's AAD object id,
  // not their email — cache the lookup since the same organizer (e.g. a
  // sales manager running team calls) recurs across many meetings/reps.
  const organizerIdCache = new Map();
  async function organizerIdFor(email) {
    if (!organizerIdCache.has(email)) organizerIdCache.set(email, resolveUserIdByEmail(email).catch(() => null));
    return organizerIdCache.get(email);
  }

  let processed = 0, noEmail = 0, apiErrors = 0, meetingsSynced = 0, skippedResolved = 0;
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

    // Meetings whose timing is already final (On Time/Late/Did Not Join)
    // from a prior run don't need their attendance re-fetched — only
    // 'No Data' (attendance not published yet last time) is worth
    // re-checking. Re-resolving every meeting in the lookback window on
    // every run was the actual driver of hitting Graph's rate limits.
    const existing = await db.execute({
      sql: 'SELECT join_url, scheduled_start, timing_status FROM graph_meetings WHERE employee_id = ?',
      args: [emp.id],
    });
    const finalStatusByKey = new Map(
      existing.rows.filter((r) => r.timing_status !== 'No Data').map((r) => [`${r.join_url}|${r.scheduled_start}`, r.timing_status])
    );

    for (const event of events) {
      const organizerEmail = event.organizer?.emailAddress?.address;
      const joinUrl = event.onlineMeeting?.joinUrl;
      if (!organizerEmail || !joinUrl) continue;

      // "Client meeting" = organizer or any attendee outside the company
      // domain — covers both directions (rep organizes and invites the
      // client, or the client organizes and invites the rep).
      const participants = [organizerEmail, ...(event.attendees || []).map((a) => a.emailAddress?.address)].filter(Boolean);
      const clientEmails = [...new Set(participants.filter(isExternalAddress).map((a) => a.toLowerCase()))];
      // ILO / tech call / Course Advice, cancelled, and (Sales) training / webinars
      if (isExcludedGraphMeeting(event.subject, emp.team, clientEmails)) continue;

      const scheduledStart = parseGraphDateTime(event.start.dateTime);
      const scheduledEnd = event.end?.dateTime ? parseGraphDateTime(event.end.dateTime) : null;

      if (finalStatusByKey.has(`${joinUrl}|${scheduledStart.toISOString()}`)) {
        skippedResolved++;
        meetingsSynced++;
        continue;
      }

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
        sql: `INSERT INTO graph_meetings (employee_id, subject, organizer_email, scheduled_start, scheduled_end, join_url, online_meeting_id, joined_at, left_at, attendance_seconds, delay_seconds, timing_status, client_emails, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(employee_id, join_url, scheduled_start) DO UPDATE SET
                subject = excluded.subject, online_meeting_id = excluded.online_meeting_id,
                joined_at = excluded.joined_at, left_at = excluded.left_at,
                attendance_seconds = excluded.attendance_seconds, delay_seconds = excluded.delay_seconds,
                timing_status = excluded.timing_status, client_emails = excluded.client_emails, synced_at = excluded.synced_at`,
        args: [
          emp.id, event.subject || null, organizerEmail, scheduledStart.toISOString(), scheduledEnd ? scheduledEnd.toISOString() : null,
          joinUrl, onlineMeetingId, joinedAt ? joinedAt.toISOString() : null, leftAt ? leftAt.toISOString() : null,
          attendanceSeconds, delaySeconds, timingStatus, JSON.stringify(clientEmails), new Date().toISOString(),
        ],
      });
      meetingsSynced++;
    }

    await recomputeGraphAggregates(db, emp.id);
    processed++;
  }

  let recordingsNote = '';
  try { recordingsNote = ` ${(await syncGraphRecordings(db)).message}`; }
  catch (err) { recordingsNote = ` Recording check failed: ${err.message}`; }

  return { message: `Synced Teams meeting attendance for ${processed} Sales reps + Assistant Technical Managers (${meetingsSynced} meetings, ${skippedResolved} already resolved and skipped, ${apiErrors} calendar fetch errors, ${noEmail} had no email on file).${recordingsNote}` };
}

// Recording coverage — for every tracked meeting that has resolved to an
// online meeting (organizer inside this tenant) and has already ended, asks
// Graph whether a Teams recording exists and stores the count on the row.
// One lookup per distinct organizer+meeting (recurring series and meetings
// shared by several reps are fetched once), then each row takes the
// recordings created around its own scheduled window. A meeting with no
// recording yet is re-checked for 3 days after it ends (recordings can take a
// while to publish); older ones are final. Rows with no online_meeting_id
// stay NULL ("not checkable").
const RECORDING_RECHECK_MS = 3 * 24 * 60 * 60 * 1000;
export async function syncGraphRecordings(db = getDb()) {
  const { resolveUserIdByEmail, getRecordings, parseGraphDateTime } = await import('./graphCallsApi.js');
  const now = Date.now();
  const res = await db.execute('SELECT g.id, g.subject, g.organizer_email, g.online_meeting_id, g.scheduled_start, g.scheduled_end, g.recording_count, g.recording_checked_at, g.client_emails, e.team FROM graph_meetings g JOIN employees e ON e.id = g.employee_id WHERE g.online_meeting_id IS NOT NULL');

  const groups = new Map();
  for (const r of res.rows) {
    let clients = [];
    try { clients = JSON.parse(r.client_emails || '[]'); } catch { /* treat as internal */ }
    if (isExcludedGraphMeeting(r.subject, r.team, clients)) continue;
    const end = new Date(r.scheduled_end || r.scheduled_start).getTime();
    if (end > now) continue;
    const settled = r.recording_checked_at && (r.recording_count > 0 || now - end > RECORDING_RECHECK_MS);
    if (settled) continue;
    const key = `${r.organizer_email}|${r.online_meeting_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const idCache = new Map();
  let checked = 0, recorded = 0, errors = 0;
  for (const rows of groups.values()) {
    const { organizer_email: email, online_meeting_id: meetingId } = rows[0];
    let recordings;
    try {
      if (!idCache.has(email)) idCache.set(email, resolveUserIdByEmail(email).catch(() => null));
      const organizerId = await idCache.get(email);
      if (!organizerId) { errors++; continue; }
      recordings = await getRecordings(organizerId, meetingId);
    } catch (err) {
      errors++;
      if (err.status !== 404 && err.status !== 403) console.error(`Graph recordings lookup failed for ${email}:`, err.message);
      continue;
    }
    const times = recordings.map((rec) => parseGraphDateTime(rec.createdDateTime)?.getTime()).filter(Boolean);
    for (const r of rows) {
      const start = new Date(r.scheduled_start).getTime();
      const end = new Date(r.scheduled_end || r.scheduled_start).getTime();
      const count = times.filter((t) => t >= start - 30 * 60 * 1000 && t <= end + 2 * 60 * 60 * 1000).length;
      await db.execute({ sql: 'UPDATE graph_meetings SET recording_count = ?, recording_checked_at = ? WHERE id = ?', args: [count, new Date().toISOString(), r.id] });
      checked++;
      if (count > 0) recorded++;
    }
  }
  return { message: `Recording check: ${checked} meetings checked, ${recorded} have a recording, ${errors} meetings not reachable.` };
}

// Keeps the callRecords webhook subscription alive — creates one if none is
// active, renews the active one once it's within a day of expiring. Must run
// at least daily (it's registered as a plain sync feed, triggered the same
// way as every other non-Vercel-cron feed — see app/api/sync/[feed]/route.js)
// since this resource's subscriptions max out at ~70 hours.
const EXTERNAL_EMAIL_LOOKBACK_DAYS = Number(process.env.EXTERNAL_EMAIL_LOOKBACK_DAYS || 30);

// UTC calendar dates for today and the 13 days before it, oldest first —
// zero-fills days with no emails so the modal's trend graph always has
// exactly 14 points regardless of how sparse a rep's sending is.
function last14Days() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Outlook Sent Items — External Email Count: for each active Sales rep,
// tallies every email sent to a non-@koenig-solutions.com address in the
// lookback window, via Graph. Purely informational (shown in the employee
// detail modal) — deliberately NOT a Worry Index signal, since emailing
// external contacts is the normal, expected shape of a Sales rep's job
// (client/vendor correspondence), not a red flag on its own.
// details is capped to the top 100 addresses by count for storage — kept
// for potential future use, though the modal now shows the daily trend
// instead of the address list. externalEmailCount itself is always the
// true total across every address.
export async function syncExternalEmails() {
  const db = getDb();
  const { getSentExternalSummary } = await import('./graphMailer.js');

  const to = new Date();
  const from = new Date(to.getTime() - EXTERNAL_EMAIL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const employees = await db.execute("SELECT id, email FROM employees WHERE team = 'Sales' AND active = 1");
  const days = last14Days();

  let processed = 0, noEmail = 0, apiErrors = 0;
  for (const emp of employees.rows) {
    if (!emp.email) { noEmail++; continue; }
    try {
      const { recipients, daily } = await getSentExternalSummary(emp.email, from.toISOString(), to.toISOString());
      const totalCount = recipients.reduce((sum, r) => sum + r.count, 0);
      const dailySeries = days.map((date) => ({ date, count: daily.get(date) || 0 }));
      await db.execute({
        sql: 'UPDATE employees SET external_email_count = ?, external_email_details = ?, external_email_daily = ? WHERE id = ?',
        args: [totalCount, JSON.stringify(recipients.slice(0, 100)), JSON.stringify(dailySeries), emp.id],
      });
      processed++;
    } catch (err) {
      console.error(`External email sync failed for ${emp.email}:`, err.message);
      apiErrors++;
    }
  }

  return { message: `Synced external email counts for ${processed} Sales reps (${apiErrors} API errors, ${noEmail} had no email on file).` };
}

// Unreplied-email counts for every active employee with a mailbox — shown on
// Graph API Calls -> Unreplied Emails. Stores two integers per person plus
// the list itself (lib/unrepliedStore.js: subject/sender/date/verdict, no body)
// so app/api/outlook/unreplied can answer without a live mailbox read.
// Mailboxes are walked a few at a time: some inboxes hold well over a
// thousand messages a week, so strictly serial would take hours.
const UNREPLIED_CONCURRENCY = Number(process.env.UNREPLIED_CONCURRENCY || 4);
export async function syncUnrepliedEmails() {
  const db = getDb();
  const { getUnrepliedThreads } = await import('./graphUnreplied.js');
  const { saveUnreplied } = await import('./unrepliedStore.js');
  const employees = (await db.execute("SELECT id, name, email FROM employees WHERE active = 1 AND email IS NOT NULL AND email != ''")).rows;

  let done = 0, apiErrors = 0, noMailbox = 0, next = 0, judgeFailures = 0;
  async function worker() {
    while (next < employees.length) {
      const emp = employees[next++];
      try {
        const { threadsConsidered, unreplied, notNeeded, needsReview, judgeFailures: failed } = await getUnrepliedThreads(emp.email, { employee: emp });
        judgeFailures += failed;
        await saveUnreplied(emp.id, unreplied, notNeeded, needsReview);
        await db.execute({
          sql: 'UPDATE employees SET unreplied_email_count = ?, unreplied_review_count = ?, unreplied_email_total = ?, unreplied_synced_at = ? WHERE id = ?',
          args: [unreplied.length, needsReview.length, threadsConsidered, new Date().toISOString(), emp.id],
        });
        done++;
      } catch (err) {
        // 404 = the address on file has no mailbox in the tenant (stale email
        // on the roster) — nothing to count, so it is not an error.
        if (err.status === 404) { noMailbox++; continue; }
        apiErrors++;
        if (err.status !== 403) console.error(`Unreplied email sync failed for ${emp.email}:`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: UNREPLIED_CONCURRENCY }, worker));
  const { judgeUsage } = await import('./judgeEmailThread.js');
  console.log(`Thread judge usage: ${judgeUsage.calls} calls, ${judgeUsage.promptTokens} prompt tokens, ${judgeUsage.completionTokens} completion tokens.`);
  return { message: `Synced unreplied-email counts for ${done} employees (${apiErrors} mailbox errors, ${noMailbox} with no mailbox in the tenant, ${employees.length} active mailboxes, ${judgeFailures} threads the reader could not judge and left as needs-review).` };
}

// Non-RMS Tasks By EmpID — feeds the "Ideas for improvement" Worry Index
// signal (lib/data.js), across all three teams. Per-employee API, one call
// per employee, matched directly by EmpId.
export async function syncIdeas() {
  const db = getDb();
  const { getNonRmsTasks } = await import('./koenigIdeasApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team') AND active = 1");

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

// Employee Salary Details — Sales/CSMs and Trainers only (per instruction not
// to populate salary for anyone else — PA Algo's salary tier / salary-multiple
// criteria read employees.salary). Replaced the Net Payable feed: same value
// (the fixed monthly pay scale), one call per employee, no month fallback.
export async function syncSalary() {
  const db = getDb();
  const { getEmployeeSalary } = await import('./koenigSalaryApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer') AND active = 1");

  const statements = [];
  let updated = 0;
  let noSalary = 0;
  let apiErrors = 0;
  await mapWithConcurrency(allEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    try {
      const row = await getEmployeeSalary(emp.id.replace('EMP', ''));
      if (!row || row.salary == null) { noSalary++; return; }
      statements.push({
        sql: 'UPDATE employees SET salary = ?, salary_source = ? WHERE id = ?',
        args: [row.salary, row.salarySource, emp.id],
      });
      updated++;
    } catch (err) {
      console.error(`Salary sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced salary for ${updated} employees (${noSalary} had no salary on file, ${apiErrors} API errors).` };
}

// Sales/CSMs and Trainers — Koenig "Get Employee Details (PMS)" per-employee
// lookup, used to identify India-based CSMs for PA Algo's salary-multiple
// criteria (country), and Trainer K11 designations for the Trainer PA Algo
// criteria (designation). city/state are stored alongside since they come
// back for free, but nothing else from the raw response (bank account,
// IFSC, UAN, personal phone, home address) is kept — this dashboard has no
// use for it and storing it would be needless PII exposure.
export async function syncEmployeeDetails() {
  const db = getDb();
  const { getEmployeeDetails } = await import('./koenigEmployeeDetailsApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  const statements = [];
  let updated = 0;
  let unmatched = 0;
  let apiErrors = 0;
  const blueCollar = []; // exact blue-collar designations, removed below
  await mapWithConcurrency(allEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    try {
      const details = await getEmployeeDetails(empCode);
      if (!details) { unmatched++; return; }
      if (isBlueCollarDesignation(details.designationName)) { blueCollar.push({ id: emp.id, designation: String(details.designationName).trim() }); return; }
      statements.push({
        sql: 'UPDATE employees SET country = ?, emp_city = ?, emp_state = ?, is_overseas = ?, designation = ? WHERE id = ?',
        args: [details.countryName, details.cityName, details.stateName, details.isOverseas ? 1 : 0, details.designationName, emp.id],
      });
      // Solutions Managers are FM, even if Koenig files them under another department.
      if (String(details.designationName || '').trim() === 'Solutions Manager') {
        statements.push({ sql: "UPDATE employees SET team = 'FM Team' WHERE id = ? AND team = 'PT Team'", args: [emp.id] });
      }
      updated++;
    } catch (err) {
      console.error(`Employee details sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  });

  if (statements.length) await db.batch(statements, 'write');
  for (const designation of new Set(blueCollar.map((b) => b.designation))) {
    await removeEmployees(db, blueCollar.filter((b) => b.designation === designation).map((b) => b.id), `Blue collar — ${designation}`);
  }

  return { message: `Synced employee details for ${updated} employees (${unmatched} had no record, ${apiErrors} API errors, ${blueCollar.length} blue-collar removed).` };
}

// Common Index — All teams. Per-employee lookup only (no bulk mode); see
// mapWithConcurrency above for why this needs bounded concurrency (the
// shared token is safe to reuse across concurrent calls — only fetching a
// *new* token concurrently is the unsafe part, see getToken's comment in
// koenigCommonIndexApi.js).
export async function syncCommonIndex() {
  const db = getDb();
  const { getCommonIndexPoints } = await import('./koenigCommonIndexApi.js');

  const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team') AND active = 1");

  const statements = [];
  let updated = 0;
  let apiErrors = 0;
  await mapWithConcurrency(allEmployees.rows, SYNC_CONCURRENCY, async (emp) => {
    const empCode = emp.id.replace('EMP', '');
    try {
      const points = await getCommonIndexPoints(empCode);
      if (points == null) return;
      statements.push({
        sql: 'UPDATE employees SET common_index_points = ? WHERE id = ?',
        args: [points, emp.id],
      });
      updated++;
    } catch (err) {
      console.error(`Common Index sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  });

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced Common Index points for ${updated} employees (${apiErrors} API errors).` };
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

// "True NR" (net of salary and marketing cost) from the OLD Get Employee NR
// API, per active Sales employee. The API only returns the last ~3 months per
// call, so each run MERGES what it gets into employees.true_nr_details —
// newer values overwrite the same month, older stored months are kept — and
// the history grows over time. Shown next to the newer "NR (before salary and
// marketing cost)" feed (syncPms), which stays the one the PA Algo uses.
export async function syncTrueNr() {
  const db = getDb();
  const { getTrueNrAll } = await import('./koenigTrueNrApi.js');

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthIdx = (key) => {
    const m = /^([A-Za-z]{3})[a-z]*-(\d{4})$/.exec(String(key));
    return m ? parseInt(m[2], 10) * 12 + MONTHS.indexOf(m[1].toLowerCase()) : -1;
  };

  // One call: every month from 17 months back through the end of the current
  // month (same trailing history as the NR feed). The end date is capped at
  // the current month because a later one also returns forward-booked months.
  const now = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const startDate = iso(new Date(now.getFullYear(), now.getMonth() - 17, 1));
  const endDate = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const rows = await getTrueNrAll(startDate, endDate);
  if (!rows.length) throw new Error('True NR API returned no rows — leaving existing data untouched.');
  const byEmpId = new Map(rows.filter((r) => r.empId != null).map((r) => [r.empId, r]));

  const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales' AND active = 1");

  const statements = [];
  let updated = 0;
  let missing = 0;
  for (const emp of salesEmployees.rows) {
    const row = byEmpId.get(parseInt(String(emp.id).replace(/\D/g, ''), 10));
    if (!row) { missing++; continue; }
    // Skip months before the employee joined (the API pads them with 0.00).
    const dojIdx = row.doj ? (() => { const d = new Date(row.doj); return Number.isNaN(d.getTime()) ? -1 : d.getFullYear() * 12 + d.getMonth(); })() : -1;
    const details = Object.entries(row.monthlyRevenue)
      .filter(([month]) => monthIdx(month) >= 0 && monthIdx(month) >= dojIdx)
      .map(([month, trueNr]) => ({ month, trueNr }))
      .sort((a, b) => monthIdx(a.month) - monthIdx(b.month));
    statements.push({ sql: 'UPDATE employees SET true_nr_details = ? WHERE id = ?', args: [JSON.stringify(details), emp.id] });
    updated++;
  }

  if (statements.length) await db.batch(statements, 'write');

  return { message: `Synced True NR for ${updated} Sales employees (${missing} not in the API), ${startDate} to ${endDate}.` };
}

// Last two appraisals per Sales/Trainer employee (GetLastTwoAppraisals), for
// the Analysis screen. Per-employee API, numeric EmpId; employees the API has
// no appraisal for keep an empty list.
export async function syncAppraisals() {
  const db = getDb();
  const { getAppraisals } = await import('./koenigAppraisalApi.js');
  const employees = await db.execute("SELECT id FROM employees WHERE active = 1 AND team IN ('Sales', 'Trainer')");

  const statements = [];
  let withAppraisal = 0;
  let apiErrors = 0;
  await mapWithConcurrency(employees.rows, 6, async (emp) => {
    try {
      const list = await getAppraisals(String(emp.id).replace(/\D/g, ''));
      if (list.length) withAppraisal++;
      statements.push({ sql: 'UPDATE employees SET appraisal_details = ? WHERE id = ?', args: [JSON.stringify(list), emp.id] });
    } catch (err) {
      console.error(`Appraisal sync failed for ${emp.id}:`, err.message);
      apiErrors++;
    }
  });
  if (statements.length) await db.batch(statements, 'write');
  return { message: `Synced appraisals for ${statements.length} Sales/Trainer employees (${withAppraisal} have one on file, ${apiErrors} API errors).` };
}

// Camera-on tracking from Graph call records. For every Teams meeting
// (call record type groupCall) in the last ~30 days (Microsoft's retention)
// it records, per Koenig employee, whether they sent a camera video stream
// ('main-video' - screen share is 'applicationsharing-video' and is ignored),
// how long they attended, and whether the meeting had an external participant
// (guest, phone, ACS user or a user from another tenant). Per meeting it also
// keeps the title (looked up from the organizer's Teams meeting), the
// organizer and the names of who joined (video_meeting_info) so the dashboard
// can show them. No media or chat is read. One-to-one calls (peerToPeer) are
// not meetings and are skipped. A call record already in video_meeting_info is
// not fetched again (blank titles are retried weekly), so daily runs only
// process new meetings.
export async function syncVideo() {
  const db = getDb();
  const { listCallRecords, getCallRecordWithSegments, listTenantUsers, resolveOnlineMeeting } = await import('./graphCallsApi.js');

  const now = new Date();
  const since = new Date(now.getTime() - 29 * 86400000);

  const [records, tenantUsers, empRes, doneRes] = await Promise.all([
    listCallRecords(since.toISOString(), now.toISOString()),
    listTenantUsers(),
    db.execute('SELECT id, email FROM employees WHERE email IS NOT NULL'),
    db.execute('SELECT call_record_id, subject, synced_at FROM video_meeting_info'),
  ]);
  // Skip meetings already saved. A meeting saved WITHOUT a title is looked at
  // again once a week (while Microsoft still holds its call record) in case the
  // title can be found by then.
  const retryBefore = now.getTime() - 7 * 86400000;
  const done = new Set(doneRes.rows.filter((r) => r.subject || new Date(r.synced_at).getTime() > retryBefore).map((r) => r.call_record_id));
  const empByEmail = new Map(empRes.rows.map((r) => [String(r.email).toLowerCase(), r.id]));
  const empByUserId = new Map();
  const nameByUserId = new Map(tenantUsers.filter((u) => u.displayName).map((u) => [u.id, u.displayName]));
  for (const u of tenantUsers) {
    for (const addr of [u.mail, u.userPrincipalName]) {
      const id = addr && empByEmail.get(String(addr).toLowerCase());
      if (id) { empByUserId.set(u.id, id); break; }
    }
  }
  const ownTenant = process.env.GRAPH_TENANT_ID;
  const meetings = records.filter((r) => r.type === 'groupCall' && !done.has(r.id));

  const mergedSeconds = (intervals) => {
    const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let total = 0, curStart = null, curEnd = null;
    for (const [a, b] of sorted) {
      if (curEnd == null || a > curEnd) { if (curEnd != null) total += curEnd - curStart; curStart = a; curEnd = b; }
      else if (b > curEnd) curEnd = b;
    }
    if (curEnd != null) total += curEnd - curStart;
    return Math.round(total / 1000);
  };

  const statements = [];
  let failed = 0, rowsOut = 0, titled = 0;
  await mapWithConcurrency(meetings, 8, async (rec) => {
    let d;
    try { d = await getCallRecordWithSegments(rec.id); } catch (err) { failed++; console.error(`Video sync: call record ${rec.id} failed:`, err.message); return; }
    const byUser = new Map();
    let external = false;
    const people = new Map();
    for (const s of d.sessions || []) {
      const idn = s.caller?.identity || {};
      const uid = idn.user?.id;
      const otherTenant = !!(idn.user && idn.user.tenantId && ownTenant && idn.user.tenantId !== ownTenant);
      if (idn.guest || idn.phone || idn.acsUser || otherTenant) external = true;
      // who joined: internal users by name, everyone else as an external participant
      if (uid && !otherTenant) people.set(uid, { name: idn.user.displayName || nameByUserId.get(uid) || 'Unknown', kind: 'internal' });
      else if (idn.guest) people.set(`g:${idn.guest.displayName || people.size}`, { name: idn.guest.displayName || 'Guest user', kind: 'external' });
      else if (idn.phone) people.set(`p:${people.size}`, { name: 'Phone participant', kind: 'external' });
      else if (otherTenant) people.set(uid, { name: idn.user.displayName || 'External user', kind: 'external' });
      else if (idn.acsUser) people.set(`a:${people.size}`, { name: 'External participant', kind: 'external' });
      if (!uid || otherTenant || !empByUserId.has(uid)) continue;
      const u = byUser.get(uid) || { intervals: [], cam: false };
      u.intervals.push([new Date(s.startDateTime).getTime(), new Date(s.endDateTime).getTime()]);
      for (const g of s.segments || []) for (const m of g.media || []) {
        if (!/^main-video/.test(m.label || '')) continue;
        // Camera ON only if video frames were really sent: Teams lists an empty sent-video stream for
        // people who never turned the camera on (no frame rate, codec 'unknown'), so the stream existing proves nothing.
        if ((m.streams || []).some((st) => /callerToCallee/.test(st.streamDirection || '') && Number(st.averageVideoFrameRate) > 0)) u.cam = true;
      }
      byUser.set(uid, u);
    }
    for (const [uid, u] of byUser) {
      const attended = mergedSeconds(u.intervals);
      statements.push({
        sql: `INSERT INTO video_meetings (call_record_id, user_id, employee_id, started_at, ended_at, attended_seconds, camera_on, is_external, participant_count, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(call_record_id, user_id) DO UPDATE SET attended_seconds = excluded.attended_seconds, camera_on = excluded.camera_on, is_external = excluded.is_external, participant_count = excluded.participant_count, ended_at = excluded.ended_at, synced_at = excluded.synced_at`,
        args: [rec.id, uid, empByUserId.get(uid), rec.startDateTime, rec.endDateTime || null, attended, u.cam ? 1 : 0, external ? 1 : 0, people.size, now.toISOString()],
      });
      rowsOut++;
    }
    // Title: only resolvable for meetings organized inside this tenant.
    const org = d.organizer_v2?.identity?.user || d.organizer?.user;
    let subject = null;
    if (byUser.size && d.joinWebUrl && org?.id) {
      try { subject = (await resolveOnlineMeeting(org.id, d.joinWebUrl))?.subject || null; } catch { /* leave the title blank */ }
      if (subject) titled++;
    }
    statements.push({
      sql: `INSERT INTO video_meeting_info (call_record_id, subject, organizer_name, participants, synced_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(call_record_id) DO UPDATE SET subject = excluded.subject, organizer_name = excluded.organizer_name, participants = excluded.participants, synced_at = excluded.synced_at`,
      args: [rec.id, subject, org?.displayName || null, JSON.stringify([...people.values()]), now.toISOString()],
    });
  });

  for (let i = 0; i < statements.length; i += 200) await db.batch(statements.slice(i, i + 200), 'write');
  return { message: `Synced camera on/off for ${rowsOut} employee-meeting rows from ${meetings.length} new Teams meetings (${titled} titled, ${empByUserId.size} employees matched to Microsoft accounts, ${failed} call records failed).` };
}

export const SYNC_RUNNERS = {
  koenig: syncKoenig,
  pip: syncPip,
  pms: syncPms,
  truenr: syncTrueNr,
  video: syncVideo,
  appraisals: syncAppraisals,
  eisnapshot: async () => (await import("./eiSnapshots.js")).takeEiSnapshot(),
  audit: syncAudit,
  sc: syncSc,
  csmroster: syncCsmRoster,
  target: syncTargetAchievement,
  targetsdata: syncTargetsData,
  pipeline: syncPipeline,
  util: syncUtil,
  exam: syncExam,
  negfeedback: syncNegFeedback,
  assignments: syncAssignments,
  trainerrc: syncTrainerRc,
  rcfullybooked: syncTrainerFullyBooked,
  skills: syncSkills,
  inhouseskills: syncInHouseSkills,
  techcalls: syncTechCalls,
  'techcalls-trainer': syncTechCallsTrainer,
  tbt: syncTbt,
  shoddy: syncShoddy,
  polls: syncPolls,
  kgt: syncKgt,
  fminterviews: syncFmInterviews,
  recruiterinterviews: syncRecruiterInterviews,
  mgrfeedback: syncMgrFeedback,
  ideas: syncIdeas,
  salary: syncSalary,
  empdetails: syncEmployeeDetails,
  commonindex: syncCommonIndex,
  graphmeetings: syncGraphMeetings,
  graphrecordings: syncGraphRecordings,
  graphsubscription: syncGraphSubscription,
  externalemails: syncExternalEmails,
  unrepliedemails: syncUnrepliedEmails,
  // PA/PIP status normally comes from the standalone 'pip' feed, which runs
  // on its own cron-job.org schedule independent of this one — that race let
  // this Monday's run miss six people whose status flipped to PA/PIP Issued
  // only after this job had already sent for the week, so they didn't get
  // caught until pip's own cron happened to land mid-week. Syncing pip here
  // first makes eligibility always reflect current status regardless of when
  // the external cron fires.
  weeklyreport: async () => {
    const { sendWeeklyReports, sendPaPipWeeklyCheckIns } = await import('./weeklyReportRunner.js');
    // Caught rather than left to propagate — a Koenig API hiccup here
    // shouldn't cost everyone their check-in email for the day; falling
    // back to whatever status is already on file (this morning's send is
    // then no worse than before this pip-sync-inline change existed).
    let pipMessage;
    try {
      pipMessage = (await syncPip()).message;
    } catch (err) {
      pipMessage = `pip status refresh failed, using last-known status: ${err.message}`;
    }
    const nj = await sendWeeklyReports();
    const paPip = await sendPaPipWeeklyCheckIns();
    return { message: `${pipMessage} | ${nj.message} | ${paPip.message}` };
  },
  weeklyresponsereport: async () => {
    const { sendWeeklyResponseReport } = await import('./weeklyResponseReportRunner.js');
    return sendWeeklyResponseReport();
  },
};
