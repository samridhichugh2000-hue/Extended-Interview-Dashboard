import { getDb } from './db.js';
import { escHtml } from './emailDraft.js';

// Weekly Goals Report — the summary Nabila Fatima used to compile by hand for Rohit Aggarwal's team
// (commitments made last week vs what each person reports this week, with a 1-5 follow-through
// rating), now built from the weekly check-in answers for EVERY check-in population and sent to HR
// every Friday:
//   Rohit Aggarwal's team   — from 2026-W45 (EXTRA_CHECKIN_EMPLOYEE_IDS in weeklyReportRunner.js)
//   Raahil Aggarwal's team  — from 2026-W45 (everyone reporting to him)
//   PA / PIP check-in       — employees past their first 6 months who are on a PA/PIP
//   NJ check-in             — employees in their first 6 months
// Each section shows its responses with last week's commitment, this week's update, the AI rating
// and the goal for next week. Everyone who has not submitted is listed at the end, across all
// sections, with their record of misses over the last MISS_HISTORY_WEEKS check-ins. The whole report
// is also attached as one Excel sheet for filtering.
export const GOALS_REPORT_RECIPIENT = 'HR@koenig-solutions.com';
const TEAM_GROUPS_FROM_WEEK = '2026-W45';
const MISS_HISTORY_WEEKS = 8;
const FULLY_BOOKED_SC_HOURS = 40;
const NJ_DAYS = 182;
const DAY = 86400000;
const CHECKIN_TEAMS = ['Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team'];

const GROUPS = [
  { key: 'rohit', title: "Rohit Aggarwal's team" },
  { key: 'raahil', title: "Raahil Aggarwal's team" },
  { key: 'papip', title: 'PA / PIP check-in' },
  { key: 'nj', title: 'NJ check-in' },
];

const SCALE_NOTE = 'Ratings are suggested automatically by comparing each person\'s commitment with their update. Scale: 5 = fully delivered, 3 = partly done or vague, 1 = not done.';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const dayMonth = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayMonthYear = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// A Date for the IST calendar day of an instant, as UTC midnight, so formatting with timeZone UTC is the IST date.
const istDay = (iso) => new Date(Math.floor((new Date(iso).getTime() + IST_OFFSET_MS) / DAY) * DAY);
const istTimeLabel = (iso) => {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${dayMonth(d)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
// Monday (UTC-midnight Date of the IST calendar day) of an ISO week.
const mondayOf = (weekStr) => {
  const [y, w] = weekStr.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY);
};
const isoWeekOf = (monday) => {
  const thursday = new Date(monday.getTime() + 3 * DAY);
  const ft = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const ftThursday = new Date(ft.getTime() - ((ft.getUTCDay() + 6) % 7) * DAY + 3 * DAY);
  return `${thursday.getUTCFullYear()}-W${String(1 + Math.round((thursday - ftThursday) / (7 * DAY))).padStart(2, '0')}`;
};
const prevWeek = (weekStr, n = 1) => isoWeekOf(new Date(mondayOf(weekStr).getTime() - n * 7 * DAY));

const nl2br = (s) => escHtml(s).replace(/\r?\n/g, '<br/>');
const TH = 'border:1px solid #d9d9d9;padding:8px 10px;background:#f3f4f6;font-size:12.5px;text-align:left;vertical-align:top;';
const TD = 'border:1px solid #d9d9d9;padding:8px 10px;font-size:12.5px;vertical-align:top;';
const TABLE = 'border-collapse:collapse;width:100%;margin:8px 0 18px;';

// Builds the report for ISO week `week` (default: this week) and returns { subject, html, stats, rows }.
export async function buildWeeklyGoalsReport({ week } = {}) {
  const db = getDb();
  const { getIsoWeek } = await import('./weekUtils.js');
  const { EXTRA_CHECKIN_EMPLOYEE_IDS, EXTRA_CHECKIN_MANAGERS } = await import('./weeklyReportRunner.js');

  const thisWeek = week || getIsoWeek(new Date());
  const lastWeek = prevWeek(thisWeek);
  const historyWeeks = Array.from({ length: MISS_HISTORY_WEEKS }, (_, i) => prevWeek(thisWeek, i)); // newest first
  const teamGroupsOn = thisWeek >= TEAM_GROUPS_FROM_WEEK;
  const rohitIds = new Set(EXTRA_CHECKIN_EMPLOYEE_IDS);
  const raahilNames = new Set(EXTRA_CHECKIN_MANAGERS.map((m) => m.toLowerCase()));

  // Every check-in sent this week, with the employee, plus anyone who should have had one.
  const wkMarks = historyWeeks.map(() => '?').join(',');
  const rows = (await db.execute({
    sql: `SELECT wr.employee_id, wr.week, wr.state, wr.received_at, wr.a1, wr.a2, wr.a3, wr.attachment_name, wr.ai_rating, wr.ai_rating_reason
          FROM weekly_responses wr WHERE wr.week IN (${wkMarks})`,
    args: historyWeeks,
  })).rows;
  const byEmpWeek = new Map(rows.map((r) => [`${r.employee_id}|${r.week}`, r]));
  const get = (id, wk) => byEmpWeek.get(`${id}|${wk}`) || null;
  const received = (r) => !!r && r.state === 'Received';

  const sentIds = new Set(rows.filter((r) => r.week === thisWeek).map((r) => r.employee_id));
  const teamMarks = CHECKIN_TEAMS.map(() => '?').join(',');
  const emps = (await db.execute({
    sql: `SELECT id, name, team, manager, status, tenure_days, rc_fully_booked_week, rc_fully_booked_sc_hours FROM employees
          WHERE active = 1 AND dor IS NULL AND team IN (${teamMarks})`,
    args: CHECKIN_TEAMS,
  })).rows.filter((e) => sentIds.has(e.id) || rohitIds.has(e.id) || raahilNames.has(String(e.manager || '').trim().toLowerCase())
    || e.tenure_days < NJ_DAYS || e.status === 'PA Issued' || e.status === 'PIP Issued');

  const thisMon = mondayOf(thisWeek);
  const lastMon = mondayOf(lastWeek);
  const today = istDay(new Date().toISOString());
  const weeksAgo = Math.max(0, Math.round((today - thisMon) / DAY / 7));

  const groupOf = (e) => {
    if (teamGroupsOn) {
      if (raahilNames.has(String(e.manager || '').trim().toLowerCase())) return 'raahil';
      if (rohitIds.has(e.id)) return 'rohit';
    }
    const tenureThen = (e.tenure_days ?? 0) - weeksAgo * 7;
    return tenureThen < NJ_DAYS ? 'nj' : 'papip';
  };

  // A PA/PIP check-in is only due while the case's own issued..review-by window is running (Koenig leaves
  // a case flagged active after it lapses), so a booked trainer with a lapsed PA/PIP was never due one.
  const bookedNoRow = emps.filter((e) => !sentIds.has(e.id) && e.team === 'Trainer' && e.rc_fully_booked_week === thisWeek
    && (e.rc_fully_booked_sc_hours || 0) >= FULLY_BOOKED_SC_HOURS && e.tenure_days >= NJ_DAYS && (e.status === 'PA Issued' || e.status === 'PIP Issued'));
  const ongoingPaPip = new Set();
  if (bookedNoRow.length) {
    const marks = bookedNoRow.map(() => '?').join(',');
    const pips = (await db.execute({ sql: `SELECT employee_id, type, issued_on, review_by FROM pip_status WHERE employee_id IN (${marks})`, args: bookedNoRow.map((e) => e.id) })).rows;
    const nowMs = Date.now();
    for (const e of bookedNoRow) {
      const want = e.status === 'PIP Issued' ? 'PIP' : 'PA';
      if (pips.some((p) => p.employee_id === e.id && p.type === want && new Date(p.issued_on).getTime() <= nowMs && nowMs <= new Date(p.review_by).getTime() + DAY)) ongoingPaPip.add(e.id);
    }
  }

  const sections = Object.fromEntries(GROUPS.map((g) => [g.key, { responded: [], noResponse: [], skipped: [], notSent: [] }]));
  for (const e of emps) {
    const key = groupOf(e);
    const sec = sections[key];
    const r = get(e.id, thisWeek);
    const prev = get(e.id, lastWeek);
    if (received(r)) { sec.responded.push({ e, r, prev }); continue; }
    if (r) { sec.noResponse.push({ e, r, prev }); continue; }
    // No check-in was sent this week. A trainer on 40+ SC hours is skipped on purpose; for the team
    // sections everyone is expected, so a missing row is listed as "not sent". For NJ / PA-PIP a
    // missing row simply means that person was not due a check-in (no longer an NJ, PA/PIP window over).
    const booked = e.team === 'Trainer' && e.rc_fully_booked_week === thisWeek && (e.rc_fully_booked_sc_hours || 0) >= FULLY_BOOKED_SC_HOURS;
    const due = key === 'rohit' || key === 'raahil' || ((e.tenure_days ?? 0) - weeksAgo * 7 < NJ_DAYS) || ongoingPaPip.has(e.id);
    if (booked && due) sec.skipped.push(e);
    else if (key === 'rohit' || key === 'raahil') sec.notSent.push(e);
  }

  // Header windows: this week Monday to today (capped at Friday), last week Monday to Sunday.
  const fridayEnd = new Date(thisMon.getTime() + 4 * DAY);
  const thisEnd = today < thisMon ? thisMon : (today < fridayEnd ? today : fridayEnd);
  const lastEnd = new Date(lastMon.getTime() + 6 * DAY);
  const thisLabel = `${dayMonth(thisMon)} – ${dayMonthYear(thisEnd)}`;
  const lastLabel = `${dayMonth(lastMon)} – ${dayMonthYear(lastEnd)}`;
  const nextMon = new Date(thisMon.getTime() + 7 * DAY);
  const nextLabel = `${dayMonth(nextMon)} – ${dayMonth(new Date(nextMon.getTime() + 4 * DAY))}`;

  // Record of misses: check-ins actually sent over the last MISS_HISTORY_WEEKS, answered or not.
  const missRecord = (e) => {
    const history = historyWeeks.map((wk) => ({ wk, r: get(e.id, wk) })).filter((h) => h.r);
    const missed = history.filter((h) => !received(h.r));
    let streak = 0;
    for (const h of history) { if (received(h.r)) break; streak++; } // newest first
    const lastReply = history.find((h) => received(h.r));
    return { sent: history.length, missed: missed.length, weeks: missed.map((h) => h.wk.slice(5)).reverse(), streak, lastReply: lastReply ? istTimeLabel(lastReply.r.received_at) : '—' };
  };

  const tile = (big, small, color) => `<td style="padding:8px 16px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:20px;font-weight:700;color:${color || '#111827'};">${big}</div><div style="font-size:11.5px;color:#6b7280;">${small}</div></td>`;
  const names = (xs) => xs.map(escHtml).join(', ');
  const statsFor = (sec) => {
    const sent = sec.responded.length + sec.noResponse.length;
    const rated = sec.responded.filter((x) => Number(x.r.ai_rating) > 0);
    const avg = rated.length ? rated.reduce((s, x) => s + Number(x.r.ai_rating), 0) / rated.length : null;
    return { sent, responded: sec.responded.length, noResponse: sec.noResponse.length, avg, low: rated.filter((x) => Number(x.r.ai_rating) <= 2).length };
  };

  const sectionHtml = (g) => {
    const sec = sections[g.key];
    const st = statsFor(sec);
    if (!st.sent && !sec.skipped.length && !sec.notSent.length) return '';
    const teamSection = g.key === 'rohit' || g.key === 'raahil';
    const newlyReplied = sec.responded.filter((x) => !received(x.prev)).map((x) => x.e.name);
    const notFollowedUp = sec.noResponse.filter((x) => received(x.prev) && String(x.prev.a2 || '').trim());
    const table = [...sec.responded]
      .sort((a, b) => Number(b.r.ai_rating || 0) - Number(a.r.ai_rating || 0) || a.e.name.localeCompare(b.e.name))
      .map(({ e, r, prev }) => {
        const committed = received(prev) && String(prev.a2 || '').trim() ? nl2br(prev.a2) : `<span style="color:#9ca3af;">No reply last week (${lastLabel})</span>`;
        const exp = r.attachment_name ? `<br/><span style="color:#6b7280;">📎 Experiment sheet attached: ${escHtml(r.attachment_name)}</span>` : '';
        const exp3 = String(r.a3 || '').trim() && !r.attachment_name ? `<br/><span style="color:#6b7280;">Experiment sheet: ${escHtml(r.a3)}</span>` : '';
        const rating = Number(r.ai_rating) > 0 ? `<b>${Number(r.ai_rating)}/5</b><br/><span style="color:#6b7280;font-size:12px;">${escHtml(r.ai_rating_reason || '')}</span>` : '<span style="color:#9ca3af;">Not rated</span>';
        return `<tr>
          <td style="${TD}width:13%;"><b>${escHtml(e.name)}</b><br/><span style="color:#6b7280;font-size:11.5px;">${escHtml(e.team)} · replied ${istTimeLabel(r.received_at)}</span></td>
          <td style="${TD}width:22%;">${committed}</td>
          <td style="${TD}width:30%;">${nl2br(r.a1)}${exp}${exp3}</td>
          <td style="${TD}width:12%;">${rating}</td>
          <td style="${TD}width:23%;">${nl2br(r.a2)}</td>
        </tr>`;
      }).join('');
    return `
    <h3 style="margin:26px 0 6px;font-size:16px;border-bottom:2px solid #111827;padding-bottom:4px;">${escHtml(g.title)}</h3>
    <table style="border-collapse:collapse;margin:6px 0 10px;"><tr>
      ${tile(`${st.responded}/${st.sent}`, 'Responded')}
      ${tile(String(st.noResponse), 'No response', st.noResponse ? '#b91c1c' : undefined)}
      ${tile(st.avg != null ? st.avg.toFixed(1) : '—', 'Average rating')}
      ${tile(String(st.low), 'Rated 1–2', st.low ? '#b91c1c' : undefined)}
    </tr></table>
    ${teamSection && newlyReplied.length ? `<p style="margin:0 0 6px;"><b>Replied this week, but no reply last week (${lastLabel}):</b> ${names(newlyReplied)}</p>` : ''}
    ${teamSection && sec.noResponse.length ? `<p style="margin:0 0 6px;color:#b91c1c;"><b>No response:</b> ${names(sec.noResponse.map((x) => x.e.name))}</p>` : ''}
    ${sec.skipped.length ? `<p style="margin:0 0 6px;color:#92400e;"><b>Skipped (40+ SC hours this week, not sent a check-in):</b> ${names(sec.skipped.map((e) => e.name))}</p>` : ''}
    ${sec.notSent.length ? `<p style="margin:0 0 6px;color:#6b7280;"><b>Not sent a check-in this week:</b> ${names(sec.notSent.map((e) => e.name))}</p>` : ''}
    ${notFollowedUp.length ? `<p style="margin:10px 0 4px;"><b>Commitments not followed up (no reply this week):</b></p><ul style="margin:0 0 12px;padding-left:20px;">${notFollowedUp.map((x) => `<li>${escHtml(x.e.name)} – ${escHtml(String(x.prev.a2).replace(/\s*\n\s*/g, '; '))}</li>`).join('')}</ul>` : ''}
    <table style="${TABLE}">
      <thead><tr>
        <th style="${TH}">Name</th>
        <th style="${TH}">Committed last week<br/><span style="font-weight:400;color:#6b7280;">${lastLabel}</span></th>
        <th style="${TH}">Accomplished this week<br/><span style="font-weight:400;color:#6b7280;">${thisLabel}</span></th>
        <th style="${TH}">Rating</th>
        <th style="${TH}">Goal for next week<br/><span style="font-weight:400;color:#6b7280;">${nextLabel}</span></th>
      </tr></thead>
      <tbody>${table || `<tr><td colspan="5" style="${TD}color:#6b7280;">No responses received yet this week.</td></tr>`}</tbody>
    </table>`;
  };

  // One misses table for everyone who has not submitted, grouped by section.
  const missRows = [];
  for (const g of GROUPS) for (const x of sections[g.key].noResponse) missRows.push({ g, e: x.e, rec: missRecord(x.e) });
  const groupIdx = (k) => GROUPS.findIndex((g) => g.key === k);
  missRows.sort((a, b) => groupIdx(a.g.key) - groupIdx(b.g.key) || b.rec.missed - a.rec.missed || b.rec.streak - a.rec.streak || a.e.name.localeCompare(b.e.name));
  const missTable = missRows.length ? `
    <h3 style="margin:30px 0 4px;font-size:16px;border-bottom:2px solid #b91c1c;padding-bottom:4px;">Not submitted this week — record of misses</h3>
    <p style="margin:6px 0;color:#6b7280;font-size:12.5px;">${missRows.length} people. Misses are check-ins sent in the last ${MISS_HISTORY_WEEKS} weeks (up to and including this week) that were not answered.</p>
    <table style="${TABLE}">
      <thead><tr><th style="${TH}">Name</th><th style="${TH}">Check-in</th><th style="${TH}">Team</th><th style="${TH}">Manager</th><th style="${TH}text-align:center;">Missed</th><th style="${TH}">Weeks missed</th><th style="${TH}text-align:center;">In a row</th><th style="${TH}">Last reply</th></tr></thead>
      <tbody>${missRows.map((m) => `<tr>
        <td style="${TD}"><b>${escHtml(m.e.name)}</b></td>
        <td style="${TD}">${escHtml(m.g.title)}</td>
        <td style="${TD}">${escHtml(m.e.team)}</td>
        <td style="${TD}">${escHtml(m.e.manager || '—')}</td>
        <td style="${TD}text-align:center;${m.rec.missed >= 3 ? 'color:#b91c1c;font-weight:700;' : ''}">${m.rec.missed} of ${m.rec.sent}</td>
        <td style="${TD}">${m.rec.weeks.length ? m.rec.weeks.join(', ') : '—'}</td>
        <td style="${TD}text-align:center;${m.rec.streak >= 2 ? 'color:#b91c1c;font-weight:700;' : ''}">${m.rec.streak}</td>
        <td style="${TD}">${m.rec.lastReply}</td>
      </tr>`).join('')}</tbody>
    </table>` : '';

  // Overview across sections.
  const totals = GROUPS.map((g) => ({ g, st: statsFor(sections[g.key]), skipped: sections[g.key].skipped.length, notSent: sections[g.key].notSent.length }))
    .filter((x) => x.st.sent || x.skipped || x.notSent);
  const allResponded = totals.reduce((s, x) => s + x.st.responded, 0);
  const allSent = totals.reduce((s, x) => s + x.st.sent, 0);
  const allRated = GROUPS.flatMap((g) => sections[g.key].responded).filter((x) => Number(x.r.ai_rating) > 0);
  const allAvg = allRated.length ? allRated.reduce((s, x) => s + Number(x.r.ai_rating), 0) / allRated.length : null;
  const overview = `
    <table style="${TABLE}max-width:640px;">
      <thead><tr><th style="${TH}">Check-in</th><th style="${TH}text-align:center;">Responded</th><th style="${TH}text-align:center;">No response</th><th style="${TH}text-align:center;">Avg rating</th></tr></thead>
      <tbody>${totals.map((x) => `<tr><td style="${TD}">${escHtml(x.g.title)}</td><td style="${TD}text-align:center;">${x.st.responded} of ${x.st.sent}</td><td style="${TD}text-align:center;${x.st.noResponse ? 'color:#b91c1c;font-weight:700;' : ''}">${x.st.noResponse}</td><td style="${TD}text-align:center;">${x.st.avg != null ? x.st.avg.toFixed(1) : '—'}</td></tr>`).join('')}
      <tr><td style="${TD}background:#f9fafb;"><b>All check-ins</b></td><td style="${TD}background:#f9fafb;text-align:center;"><b>${allResponded} of ${allSent}</b></td><td style="${TD}background:#f9fafb;text-align:center;"><b>${allSent - allResponded}</b></td><td style="${TD}background:#f9fafb;text-align:center;"><b>${allAvg != null ? allAvg.toFixed(1) : '—'}</b></td></tr></tbody>
    </table>`;

  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.55;">
    <p>Dear HR Team,</p>
    <p>Here is the weekly goals report.</p>
    <table style="border-collapse:collapse;margin:6px 0 14px;"><tr>
      <td style="padding:8px 14px;border:1px solid #e5e7eb;background:#f9fafb;"><div style="font-size:11.5px;color:#6b7280;">Previous week (commitments made)</div><b>${lastLabel}</b></td>
      <td style="padding:8px 14px;border:1px solid #e5e7eb;background:#f9fafb;"><div style="font-size:11.5px;color:#6b7280;">This week (work reported)</div><b>${thisLabel}</b></td>
    </tr></table>
    <p style="margin:0 0 4px;">${allResponded} of ${allSent} people responded${allAvg != null ? `; the average follow-through rating is ${allAvg.toFixed(1)}/5` : ''}. The full report is also attached as an Excel sheet.</p>
    ${overview}
    ${GROUPS.map(sectionHtml).join('')}
    ${missTable}
    <p style="color:#6b7280;font-size:12px;margin-top:20px;">${SCALE_NOTE}</p>
    <p>Regards,<br/>EI Dashboard</p>
  </div>`;

  // The same data as one Excel sheet.
  const sheetRows = [];
  for (const g of GROUPS) {
    const sec = sections[g.key];
    const add = (e, status, r, prev) => {
      const rec = status === 'No response' ? missRecord(e) : null;
      sheetRows.push({
        group: g.title, name: e.name, team: e.team, manager: e.manager || '', status,
        committed: received(prev) ? String(prev.a2 || '') : '', accomplished: r && received(r) ? String(r.a1 || '') : '',
        rating: r && Number(r.ai_rating) > 0 ? Number(r.ai_rating) : '', reason: r && received(r) ? String(r.ai_rating_reason || '') : '',
        goal: r && received(r) ? String(r.a2 || '') : '', experiment: r && received(r) ? [r.a3, r.attachment_name].filter(Boolean).join(' · ') : '',
        repliedAt: r && received(r) ? istTimeLabel(r.received_at) : '',
        missed: rec ? `${rec.missed} of ${rec.sent}` : '', weeksMissed: rec ? rec.weeks.join(', ') : '', inARow: rec ? rec.streak : '',
      });
    };
    for (const x of sec.responded) add(x.e, 'Responded', x.r, x.prev);
    for (const x of sec.noResponse) add(x.e, 'No response', x.r, x.prev);
    for (const e of sec.skipped) add(e, 'Skipped (40+ SC hours)', null, null);
    for (const e of sec.notSent) add(e, 'Not sent a check-in', null, null);
  }

  const subject = `Weekly Goals Report – ${thisLabel} (vs ${lastLabel})`;
  const bySection = Object.fromEntries(GROUPS.map((g) => [g.key, statsFor(sections[g.key])]));
  const stats = { week: thisWeek, responded: allResponded, sent: allSent, noResponse: allSent - allResponded, avg: allAvg != null ? Number(allAvg.toFixed(2)) : null, sections: bySection, skipped: totals.reduce((s, x) => s + x.skipped, 0), notSent: totals.reduce((s, x) => s + x.notSent, 0) };
  return { subject, html, stats, rows: sheetRows };
}

async function reportWorkbook(week, rows) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Goals ${week}`);
  ws.columns = [
    { header: 'Check-in', key: 'group', width: 24 }, { header: 'Name', key: 'name', width: 24 }, { header: 'Team', key: 'team', width: 14 },
    { header: 'Manager', key: 'manager', width: 22 }, { header: 'Status', key: 'status', width: 22 },
    { header: 'Committed last week', key: 'committed', width: 44 }, { header: 'Accomplished this week', key: 'accomplished', width: 54 },
    { header: 'Rating', key: 'rating', width: 8 }, { header: 'Reason for rating', key: 'reason', width: 44 }, { header: 'Goal for next week', key: 'goal', width: 44 },
    { header: 'Experiment sheet', key: 'experiment', width: 30 }, { header: 'Replied', key: 'repliedAt', width: 16 },
    { header: 'Missed (last 8)', key: 'missed', width: 14 }, { header: 'Weeks missed', key: 'weeksMissed', width: 22 }, { header: 'In a row', key: 'inARow', width: 9 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const row = ws.addRow(r);
    row.alignment = { vertical: 'top', wrapText: true };
    if (r.status === 'No response') row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

export async function sendWeeklyGoalsReport(opts = {}) {
  const { sendMail } = await import('./graphMailer.js');
  const { subject, html, stats, rows } = await buildWeeklyGoalsReport(opts);
  const to = opts.to || GOALS_REPORT_RECIPIENT;
  await sendMail({
    to,
    subject: `${opts.subjectPrefix || ''}${subject}`,
    html,
    attachments: [{
      name: `Weekly_Goals_Report_${stats.week}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: await reportWorkbook(stats.week, rows),
    }],
  });
  const parts = Object.entries(stats.sections).filter(([, s]) => s.sent).map(([k, s]) => `${GROUPS.find((g) => g.key === k).title}: ${s.responded}/${s.sent}`);
  return { message: `Sent the Weekly Goals Report for ${stats.week} to ${to}: ${stats.responded} of ${stats.sent} responded (${parts.join('; ')})${stats.skipped ? `, ${stats.skipped} skipped (40+ SC hours)` : ''}${stats.notSent ? `, ${stats.notSent} not sent a check-in` : ''}.` };
}
