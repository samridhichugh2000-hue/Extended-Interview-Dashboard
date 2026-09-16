'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  STATUS, decorate, NAV, TITLES, PATHS, METRIC_HEADS,
  WORRY_BANDS, POS_SIGNALS, NEG_SIGNALS, NJ_QUESTIONS, appliesToTeam, feedbackRating,
} from '../lib/data';
import { JOB_LABELS } from '../lib/jobLabels';

const card = { border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 16 };

// "Without X" quick filters — every department table + Worry Index screen
// can multi-select these on top of the existing status/search filters. Not
// applied to fields that mean something different at zero (e.g. neg. audits
// or shoddy — zero there is good news, not a coverage gap worth searching
// for), only to the "did this NJ engage with X at all" signals.
const COMMON_MISSING_FILTERS = [
  { key: 'mgrFeedback', label: 'Without Mgr Feedback', test: (e) => !(e.mgrFeedbackCount > 0) },
  { key: 'polls', label: 'Without Polls', test: (e) => !(e.pollsParticipated > 0) },
  { key: 'kgt', label: 'Without KGT', test: (e) => !(e.kgtCount > 0) },
  { key: 'ideas', label: 'Without Ideas for Improvement', test: (e) => !(e.ideasCount > 0) },
  { key: 'withShoddy', label: 'With Shoddy Log', test: (e) => (e.shoddyNegCount > 0 || e.shoddyPosCount > 0) },
];
const DEPT_MISSING_FILTERS = {
  Sales: [
    { key: 'techCalls', label: 'Without Tech Calls', test: (e) => !(e.techCallsCount > 0) },
    { key: 'scRaised', label: 'Without SCs Raised', test: (e) => !(e.scRaised > 0) },
    { key: 'withNegAudits', label: 'With Neg. Audits', test: (e) => e.negAudits > 0 },
  ],
  Trainer: [
    { key: 'exams', label: 'Without Exams', test: (e) => !(e.examPass > 0) },
    { key: 'assignments', label: 'Without Assignments', test: (e) => !(e.assignmentsCount > 0) },
    { key: 'skills', label: 'Without Skills', test: (e) => !(e.skillsCount > 0) },
    { key: 'inHouseSkills', label: 'Without In-House Skills', test: (e) => !(e.inHouseSkillsCount > 0) },
    { key: 'techCallsConverted', label: 'Without Tech Calls Converted', test: (e) => !(e.techCallsConverted > 0) },
    { key: 'tbt', label: 'Without TBTs', test: (e) => !(e.tbtCount > 0) },
    { key: 'withNegFeedback', label: 'With Neg. Feedback', test: (e) => e.negFeedback > 0 },
  ],
  'PT Team': [],
};
function missingFiltersFor(dept) {
  return [...(dept ? DEPT_MISSING_FILTERS[dept] || [] : []), ...COMMON_MISSING_FILTERS];
}

// Shared Close/Alert actions — used by the Dept table's row chips and by
// EmployeeModal, so both stay in sync with the same fetch/confirm/refresh
// behavior instead of duplicating it.
function useEmployeeActions() {
  const router = useRouter();
  const [pending, setPending] = useState(null); // `${action}:${id}` while a request is in flight

  const closeEmployee = async (emp, { onDone } = {}) => {
    if (pending) return;
    if (!window.confirm(`Mark ${emp.name} as closed (Not to be Monitored)?`)) return;
    setPending(`close:${emp.id}`);
    try {
      const res = await fetch(`/api/employees/${emp.id}/close`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) { window.alert(`Failed: ${json.error}`); return; }
      router.refresh();
      onDone?.();
    } catch (err) {
      window.alert(`Failed: ${err.message}`);
    } finally {
      setPending(null);
    }
  };

  // Clicking "Alert" opens a preview (below) where HR picks a PA or PIP, a
  // deadline, and which tracked parameters to cite, then "Save" is what
  // confirmSendAlert actually calls — it sends the email and flips the
  // employee's status to match (PA Issued / PIP Issued).
  const [alertTarget, setAlertTarget] = useState(null);
  const [alertOnDone, setAlertOnDone] = useState(null);

  const openAlertPreview = (emp, { onDone } = {}) => {
    if (!emp.email) { window.alert('No email on file for this employee.'); return; }
    setAlertTarget(emp);
    setAlertOnDone(() => onDone || null);
  };

  const confirmSendAlert = async ({ signals, metric, pipType, deadline }) => {
    const emp = alertTarget;
    if (!emp || pending) return;
    setPending(`alert:${emp.id}`);
    try {
      const res = await fetch(`/api/employees/${emp.id}/alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: emp.name, email: emp.email, score: emp.scoreStr, bandLabel: emp.bandLabel, signals, metric, pipType, deadline }),
      });
      const json = await res.json();
      window.alert(json.ok ? `${pipType} saved and alert email sent.` : `Failed: ${json.error}`);
      if (json.ok) {
        setAlertTarget(null);
        alertOnDone?.();
        router.refresh();
      }
    } catch (err) {
      window.alert(`Failed: ${err.message}`);
    } finally {
      setPending(null);
    }
  };

  const alertModal = alertTarget && (
    <AlertPreviewModal
      emp={alertTarget}
      pending={pending === `alert:${alertTarget.id}`}
      onClose={() => setAlertTarget(null)}
      onSend={confirmSendAlert}
    />
  );

  return { pending, closeEmployee, openAlertPreview, alertModal };
}

const PIP_TYPES = {
  PA: { code: 'PA', label: 'Performance Appraisal (PA)' },
  PIP: { code: 'PIP', label: 'Performance Improvement Plan (PIP)' },
};
// Must match PIP_SUBJECT in app/api/employees/[id]/alert/route.js.
const PIP_SUBJECTS = {
  PA: 'Performance Alert – Extended Interview',
  PIP: 'Performance Improvement Plan – Extended Interview',
};

function AlertPreviewModal({ emp, pending, onClose, onSend }) {
  // Every actually-tracked parameter for this employee's team, not just the
  // ones that fired — a Sales rep with zero SCs raised should still see "SCs
  // raised" in the list (status 'clear'). Signals with no synced data at all
  // ('no-data'/'not-tracked') are left out entirely rather than shown as a
  // greyed-out row — there's nothing real to report on those yet.
  const all = emp.signalReport.filter((s) => s.status === 'fired' || s.status === 'clear');
  // Real occurrence counts, not index/points deltas — HR wants "3 negative
  // audits" in the email, not "-15". Boolean-only signals (no count fn, e.g.
  // "Zero assignments since joining") fall back to Yes/No since there's no
  // number to show.
  const displayVal = (s) => (s.isMetric ? 'Table' : s.status === 'fired' ? (s.count != null ? String(s.count) : 'Yes') : '0');
  // Reflects the employee's actual monthly figures rather than a scored
  // pass/fail signal — treated as just another checkbox row (pre-checked) so
  // HR can drop it from the email like any other parameter, but rendered as
  // its own table in the email rather than folded into the bullet list.
  // Sales sees NR (currency), Trainer sees Utilization; PT/other teams get
  // nothing here since neither metric applies to them.
  const monthHeads = METRIC_HEADS[emp.team];
  const metric = (emp.team === 'Sales' || emp.team === 'Trainer') && monthHeads
    ? { label: emp.team === 'Sales' ? 'Month-wise NR' : 'Month-wise Utilization',
        isCurrency: emp.team === 'Sales',
        months: monthHeads.map((h, i) => ({ head: h, value: emp.v?.[i] ?? '—' })),
        isMetric: true }
    : null;
  const items = metric ? [...all, metric] : all;
  // Negative signals that actually fired are why this NJ is being alerted in
  // the first place — pre-checked, same as the month-wise metric.
  // Everything else is available to add for context, but off by default.
  const [selected, setSelected] = useState(() => {
    const s = new Set(all.filter((x) => x.status === 'fired' && x.pts < 0).map((x) => x.label));
    if (metric) s.add(metric.label);
    return s;
  });
  const toggle = (label) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });
  const chosenItems = items.filter((s) => selected.has(s.label));
  const chosenSignals = chosenItems.filter((s) => !s.isMetric).map((s) => ({ label: s.label, value: displayVal(s) }));
  const chosenMetric = chosenItems.find((s) => s.isMetric) || null;
  const fmtMonth = (v) => (metric?.isCurrency && v !== '—' && v != null ? `₹${v}` : String(v ?? '—'));

  // Issuing a PA or PIP is what actually triggers this alert — HR picks one,
  // then a deadline, before Save is enabled. Selecting either also flips the
  // employee's dashboard status to match (see confirmSendAlert in
  // useEmployeeActions). The PIP API call that will push this to RMS isn't
  // available yet — Save only sends the email + updates status for now.
  const [pipType, setPipType] = useState(null);
  const [deadline, setDeadline] = useState('');
  const deadlineStr = deadline ? new Date(deadline + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const canSave = !!pipType && !!deadline;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — alert preview</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>Worry Index {emp.scoreStr} · {emp.bandLabel} · to {emp.email}, Cc HR@koenig-solutions.com</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: '#5C6178', textTransform: 'uppercase', marginBottom: 10 }}>Select parameters to include</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((s) => (
                <label key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '9px 12px' }}>
                  <input type="checkbox" checked={selected.has(s.label)} onChange={() => toggle(s.label)} style={{ width: 15, height: 15, flex: 'none' }} />
                  <span style={{ flex: 1, fontSize: 13, color: '#C7CBDA' }}>{s.label}</span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: s.isMetric ? '#8A90A8' : s.status === 'fired' ? (s.pts < 0 ? '#F87171' : '#5EEAD4') : '#8A90A8' }}>{displayVal(s)}</span>
                </label>
              ))}
              {!items.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No tracked parameters for this team yet.</div>}
            </div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: '#5C6178', textTransform: 'uppercase', marginBottom: 10 }}>Issue as</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.values(PIP_TYPES).map((t) => (
                <div key={t.code} onClick={() => setPipType(t.code)} style={{ flex: 1, cursor: 'pointer', textAlign: 'center', border: `1px solid ${pipType === t.code ? 'rgba(244,63,94,0.5)' : 'rgba(255,255,255,0.1)'}`, background: pipType === t.code ? 'rgba(244,63,94,0.14)' : 'rgba(255,255,255,0.02)', color: pipType === t.code ? '#F87171' : '#9BA1B8', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: pipType === t.code ? 600 : 400 }}>
                  {t.label}
                </div>
              ))}
            </div>
          </div>
          {pipType && (
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: '#5C6178', textTransform: 'uppercase', marginBottom: 10 }}>Deadline date</div>
              <input
                type="date"
                value={deadline}
                onChange={(ev) => setDeadline(ev.target.value)}
                style={{ width: '100%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#E4E6F0', outline: 'none', colorScheme: 'dark' }}
              />
            </div>
          )}
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: '#5C6178', textTransform: 'uppercase', marginBottom: 10 }}>Email preview</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: 18, background: 'rgba(255,255,255,0.02)', fontSize: 13, color: '#C7CBDA', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 12px', fontSize: 11.5, color: '#5C6178' }}>Subject: {pipType ? PIP_SUBJECTS[pipType] : '[choose PA or PIP above]'}</p>
              <p>Hi {emp.name},</p>
              <p>This is to formally bring to your attention certain performance related concerns that require immediate attention.</p>
              <p style={{ marginBottom: 4 }}>The following concerns have been noted:</p>
              {chosenSignals.length
                ? <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>{chosenSignals.map((s) => <li key={s.label}>{s.label}: {s.value}</li>)}</ul>
                : <p style={{ margin: '0 0 12px', color: '#6E7488' }}>None selected.</p>}
              {chosenMetric && (
                <table style={{ borderCollapse: 'collapse', margin: '0 0 12px', fontSize: 12.5 }}>
                  <thead>
                    <tr>{chosenMetric.months.map((m) => <th key={m.head} style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '5px 9px', color: '#8A90A8', fontWeight: 600 }}>{m.head}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>{chosenMetric.months.map((m) => <td key={m.head} style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '5px 9px' }}>{fmtMonth(m.value)}</td>)}</tr>
                  </tbody>
                </table>
              )}
              <p>You are expected to demonstrate immediate and sustained improvement in the above areas.</p>
              <p>The required improvement is expected to be demonstrated by <b>{deadlineStr || '[Deadline Date]'}</b>.</p>
              <p>Your performance will be reviewed during this period, and further action may be taken based on the outcome of the review.</p>
              <p style={{ marginBottom: 0 }}>Regards,<br />Team HR</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <span onClick={onClose} className="hoverbtn" style={{ border: '1px solid rgba(255,255,255,0.12)', color: '#C7CBDA', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</span>
            <span
              onClick={() => canSave && !pending && onSend({ signals: chosenSignals, metric: chosenMetric ? { label: chosenMetric.label, months: chosenMetric.months, isCurrency: chosenMetric.isCurrency } : null, pipType, deadline })}
              className="hoverbtn"
              style={{ border: '1px solid rgba(244,63,94,0.45)', color: '#F87171', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: (pending || !canSave) ? 'default' : 'pointer', opacity: (pending || !canSave) ? 0.5 : 1 }}
            >
              {pending ? 'Saving…' : 'Save'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncludeInactiveToggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${value ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.1)'}`, background: value ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.03)', color: value ? '#FFFFFF' : '#9BA1B8', borderRadius: 10, padding: '10px 14px', fontSize: 13, flex: 'none' }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, border: `1px solid ${value ? '#A5A7FA' : 'rgba(255,255,255,0.25)'}`, background: value ? '#6366F1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff' }}>{value ? '✓' : ''}</span>
      Include inactives
    </div>
  );
}

function MissingFilterChips({ defs, active, onToggle }) {
  if (!defs.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {defs.map((d) => {
        const on = active.includes(d.key);
        return (
          <div key={d.key} onClick={() => onToggle(d.key)} style={{ cursor: 'pointer', border: `1px solid ${on ? 'rgba(244,63,94,0.45)' : 'rgba(255,255,255,0.1)'}`, background: on ? 'rgba(244,63,94,0.14)' : 'rgba(255,255,255,0.03)', color: on ? '#F87171' : '#9BA1B8', borderRadius: 999, padding: '7px 13px', fontSize: 12.5 }}>
            {d.label}{on ? ' ×' : ''}
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardClient({ employees, responses, week, newJoiners, deptCounts, failedJobs, graphMeetings }) {
  const [screen, setScreen] = useState('overview');
  const [dept, setDept] = useState('Sales');
  const [filter, setFilter] = useState(null);
  const [modal, setModal] = useState(null);

  const go = (s, d, f) => { setScreen(s); if (d) setDept(d); setFilter(f ?? null); };

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <Sidebar screen={screen} dept={dept} go={go} njCount={newJoiners.length} deptCounts={deptCounts} graphCallsCount={graphMeetings.length} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar screen={screen} dept={dept} />
        <JobFailureBanner failedJobs={failedJobs} />
        <div style={{ padding: '26px 28px 60px', flex: 1 }}>
          {screen === 'overview' && <Overview employees={employees} newJoiners={newJoiners} deptCounts={deptCounts} go={go} setModal={setModal} />}
          {screen === 'dept' && <Dept key={dept} employees={employees} dept={dept} filter={filter} setFilter={setFilter} setModal={setModal} />}
          {screen === 'papip' && <PaPip employees={employees} filter={filter} setFilter={setFilter} setModal={setModal} />}
          {screen === 'worryindex' && <WorryIndex employees={employees} filter={filter} setFilter={setFilter} setModal={setModal} />}
          {screen === 'graphcalls' && <GraphCalls meetings={graphMeetings} employees={employees} filter={filter} setFilter={setFilter} />}
          {screen === 'reports' && <Reports employees={employees} responses={responses} week={week} filter={filter} setFilter={setFilter} />}
        </div>
      </div>
      {modal && <EmployeeModal emp={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ---------- app chrome ---------- */

// Surfaces the last-known failure for weeklyreport / weeklyresponsereport /
// report15 (see lib/jobStatus.js) — one row per job, so at most 3 lines.
// Dismissing only hides it for this browser tab; it reappears on the next
// full page load until that job actually succeeds again, since the
// underlying failure is still true.
function JobFailureBanner({ failedJobs }) {
  const [dismissed, setDismissed] = useState(false);
  if (!failedJobs?.length || dismissed) return null;
  return (
    <div style={{ margin: '14px 28px 0', border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.1)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.1em', color: '#F87171', textTransform: 'uppercase' }}>Email trigger failed</div>
        <span onClick={() => setDismissed(true)} style={{ cursor: 'pointer', color: '#8A90A8', fontSize: 13, lineHeight: 1 }}>×</span>
      </div>
      {failedJobs.map((j) => (
        <div key={j.job} style={{ fontSize: 12.5, color: '#F0AFAF' }}>
          <b>{JOB_LABELS[j.job] || j.job}</b> — {j.message || 'Unknown error'}
          {j.ran_at && <span style={{ color: '#8A90A8' }}> · {new Date(j.ran_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST</span>}
        </div>
      ))}
    </div>
  );
}

function Sidebar({ screen, dept, go, njCount, deptCounts, graphCallsCount }) {
  return (
    <div style={{ width: 240, flex: 'none', background: 'linear-gradient(180deg,rgba(99,102,241,0.10),rgba(168,85,247,0.04))', borderRight: '1px solid rgba(255,255,255,0.07)', padding: '22px 14px', display: 'flex', flexDirection: 'column', gap: 26, position: 'sticky', top: 0, height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
        <div className="disp" style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366F1,#A855F7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#fff' }}>EI</div>
        <div><div className="disp" style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>EI Dashboard</div><div style={{ fontSize: 10.5, color: '#6E7488' }}>Extended Interview</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.16em', color: '#5C6178', padding: '0 10px 8px' }}>MONITOR</div>
        {NAV.map((n) => {
          const active = screen === n.screen && (!n.dept || n.dept === dept);
          const count = n.screen === 'overview' ? njCount : n.screen === 'graphcalls' ? graphCallsCount : n.dept && deptCounts[n.dept] !== undefined ? deptCounts[n.dept] : n.count;
          return (
            <div key={n.label} onClick={() => go(n.screen, n.dept)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 10px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, background: active ? 'rgba(99,102,241,0.22)' : 'transparent', color: active ? '#FFFFFF' : '#9BA1B8', fontWeight: active ? 600 : 400, borderLeft: `2px solid ${active ? '#6366F1' : 'transparent'}` }}>
              <span>{n.label}</span>
              <span className="mono" style={{ fontSize: 11, color: '#6E7488' }}>{count}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontSize: 11.5, color: '#8A90A8', lineHeight: 1.5 }}>Next weekly send</div>
        <div className="mono" style={{ fontSize: 13, color: '#14B8A6', marginTop: 4 }}>Mon 09:00 IST</div>
      </div>
    </div>
  );
}

function Topbar({ screen, dept }) {
  const t = TITLES[screen];
  const title = screen === 'dept' ? dept : t[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <div>
        <div className="disp" style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: '#6E7488', marginTop: 2 }}>{t[1]}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid rgba(20,184,166,0.3)', background: 'rgba(20,184,166,0.08)', padding: '6px 12px', borderRadius: 999 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#14B8A6', animation: 'livepulse 1.8s infinite' }} />
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.1em', color: '#14B8A6' }}>LIVE</span>
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: '#6E7488' }}>27 Jul 2026</div>
        <div className="hoverbtn" style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: '7px 14px', fontSize: 12.5, color: '#C7CBDA', cursor: 'pointer' }}>Refresh</div>
      </div>
    </div>
  );
}

/* ---------- screens ---------- */

function Overview({ employees, newJoiners, deptCounts, go, setModal }) {
  const activeEmployees = employees.filter((e) => e.active !== false);
  const counts = deptCounts;
  const pendingMailCount = activeEmployees.filter((e) => e.weeklyReportState === 'Pending').length;
  const chips = [
    { label: 'Sales', count: counts.Sales, bg: 'rgba(99,102,241,0.14)', border: 'rgba(99,102,241,0.35)', color: '#A5A7FA', dept: 'Sales' },
    { label: 'Trainer', count: counts.Trainer, bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.35)', color: '#D8B4FE', dept: 'Trainer' },
    { label: 'PT', count: counts['PT Team'], bg: 'rgba(20,184,166,0.14)', border: 'rgba(20,184,166,0.35)', color: '#5EEAD4', dept: 'PT Team' },
  ];
  // Worst-first — only NJs currently running a negative Worry Index score,
  // the ones that actually need review, not just the first 5 in DB order.
  const reviewQueue = activeEmployees.map(decorate).filter((e) => e.score < 0).sort((a, b) => a.score - b.score);
  const paPipList = activeEmployees.filter((e) => e.status !== 'In Progress').map((e) => ({ name: e.name, due: e.due, type: e.status === 'PIP Issued' ? 'PIP' : 'PA', active: e.active, ...STATUS[e.status] }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 1fr', gap: 16 }}>
        <div style={{ border: '1px solid rgba(99,102,241,0.28)', background: 'linear-gradient(150deg,rgba(99,102,241,0.16),rgba(99,102,241,0.03))', borderRadius: 16, padding: 20, animation: 'floatcard 6s ease-in-out infinite' }}>
          <div style={{ fontSize: 12, color: '#A8AEC4' }}>New Joiners Under Watch</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '8px 0 4px' }}><span className="disp" style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.03em' }}>{newJoiners.length}</span><span style={{ fontSize: 11.5, color: '#6E7488' }}>joined last 6 months</span></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {chips.map((c) => (
              <div key={c.label} onClick={() => go('dept', c.dept)} style={{ cursor: 'pointer', border: `1px solid ${c.border}`, background: c.bg, color: c.color, borderRadius: 8, padding: '6px 11px', fontSize: 12, display: 'flex', gap: 7, alignItems: 'center' }}>
                <span>{c.label}</span><span className="mono" style={{ fontWeight: 600 }}>{c.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div onClick={() => go('worryindex')} style={{ cursor: 'pointer', border: '1px solid rgba(244,63,94,0.25)', background: 'linear-gradient(150deg,rgba(244,63,94,0.13),rgba(244,63,94,0.02))', borderRadius: 16, padding: 20, animation: 'floatcard 6s ease-in-out infinite .6s' }}>
          <div style={{ fontSize: 12, color: '#A8AEC4' }}>Worry Index · Critical</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '8px 0 12px' }}><span className="disp" style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.03em' }}>7</span><span style={{ fontSize: 11.5, color: '#F43F5E' }}>▲ 2 this week</span></div>
          <div style={{ display: 'flex', gap: 4, height: 8 }}>
            <div style={{ flex: 7, background: '#F43F5E', borderRadius: 3 }} />
            <div style={{ flex: 11, background: '#F59E0B', borderRadius: 3 }} />
            <div style={{ flex: 13, background: '#6366F1', borderRadius: 3 }} />
            <div style={{ flex: 11, background: '#14B8A6', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#6E7488', marginTop: 7 }}><span>Critical 7</span><span>Low 11</span><span>Medium 13</span><span>Good 11</span></div>
        </div>
        <div onClick={() => go('reports', null, 'Pending')} style={{ cursor: 'pointer', border: '1px solid rgba(245,158,11,0.25)', background: 'linear-gradient(150deg,rgba(245,158,11,0.13),rgba(245,158,11,0.02))', borderRadius: 16, padding: 20, animation: 'floatcard 6s ease-in-out infinite 1.2s' }}>
          <div style={{ fontSize: 12, color: '#A8AEC4' }}>Weekly progress mail pending NJs</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '8px 0 4px' }}><span className="disp" style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.03em' }}>{pendingMailCount}</span><span style={{ fontSize: 11.5, color: '#6E7488' }}>haven't responded yet</span></div>
          <div style={{ marginTop: 12, border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B', borderRadius: 8, padding: '7px 12px', fontSize: 12, textAlign: 'center' }}>View pending NJs →</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><div className="disp" style={{ fontSize: 15, fontWeight: 600 }}>NJ Review Queue</div><div style={{ fontSize: 11.5, color: '#6E7488', marginTop: 2 }}>Every NJ with a negative Worry Index score, worst first</div></div>
            <span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>click a row →</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 1.1fr .9fr .7fr', padding: '10px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, letterSpacing: '.1em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span>Employee</span><span>Team</span><span>Manager</span><span>Status</span><span style={{ textAlign: 'right' }}>Score</span>
          </div>
          <div style={{ maxHeight: 296, overflow: 'auto' }}>
            {reviewQueue.map((e) => (
              <div key={e.id} className="hoverrow" onClick={() => setModal(e)} style={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 1.1fr .9fr .7fr', padding: '13px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: 13, ...e.rowStyle }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: 600 }}>{e.name}</span><span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>{e.id} · day {e.tenure}</span></div>
                <span style={{ color: '#A8AEC4', fontSize: 12.5 }}>{e.team}</span>
                <span style={{ color: '#A8AEC4', fontSize: 12.5 }}>{e.manager}</span>
                <span style={{ justifySelf: 'start', fontSize: 11, padding: '4px 9px', borderRadius: 999, background: e.statusBg, color: e.statusColor, border: `1px solid ${e.statusBorder}` }}>{e.inactive ? 'Inactive' : e.status}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontWeight: 600, color: e.bandColor }}>{e.scoreStr}</span>
              </div>
            ))}
            {!reviewQueue.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No NJ currently has a negative Worry Index score.</div>}
          </div>
        </div>

        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}><div className="disp" style={{ fontSize: 15, fontWeight: 600 }}>Employee Status</div><div style={{ fontSize: 11.5, color: '#6E7488', marginTop: 2 }}>PA / PIP cases · 6 open</div></div>
          <div style={{ maxHeight: 296, overflow: 'auto' }}>
            {paPipList.map((p) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: p.active === false ? 0.45 : 1, filter: p.active === false ? 'grayscale(0.6)' : undefined }}>
                <div><div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 11, color: '#6E7488', marginTop: 2 }}>due {p.due}</div></div>
                <span style={{ fontSize: 10.5, padding: '4px 9px', borderRadius: 999, background: p.bg, color: p.color, border: `1px solid ${p.border}` }}>{p.active === false ? 'Inactive' : p.type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dept({ employees, dept, filter, setFilter, setModal }) {
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [missing, setMissing] = useState([]);
  const toggleMissing = (key) => setMissing((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));
  const { pending, closeEmployee, openAlertPreview, alertModal } = useEmployeeActions();
  const [auditModal, setAuditModal] = useState(null);
  const [scModal, setScModal] = useState(null);
  const [examModal, setExamModal] = useState(null);
  const [negFbModal, setNegFbModal] = useState(null);
  const [assignmentsModal, setAssignmentsModal] = useState(null);
  const [skillsModal, setSkillsModal] = useState(null);
  const [inHouseSkillsModal, setInHouseSkillsModal] = useState(null);
  const [techCallsModal, setTechCallsModal] = useState(null);
  const [techCallsConvModal, setTechCallsConvModal] = useState(null);
  const [tbtModal, setTbtModal] = useState(null);
  const [shoddyModal, setShoddyModal] = useState(null);
  const [mgrFeedbackModal, setMgrFeedbackModal] = useState(null);
  const [pollsModal, setPollsModal] = useState(null);
  const [kgtModal, setKgtModal] = useState(null);
  const [ideasModal, setIdeasModal] = useState(null);
  const deptEmp = employees.filter((e) => e.team === dept);
  const pool = deptEmp.length ? deptEmp : employees;
  // Not to be Monitored / Under Watch is a status call, not a score call —
  // the weekly Worry Index score fluctuates, but an NJ stays under watch
  // until HR explicitly confirms them (status 'Confirmed', the "Mark
  // closed" action). Every other status (In Progress, PA Issued, PIP
  // Issued) counts as still under watch. Exited employees aren't monitored
  // either way, so both buckets — and Total — are active-only regardless of
  // the "Include inactives" toggle, and the two buckets always add up to
  // Total exactly.
  const activeDeptEmp = deptEmp.filter((e) => e.active !== false);
  // "Include inactives" only affects the row list below, not the status
  // cards above (those are a fixed "monitored population" concept).
  const visiblePool = includeInactive ? pool : pool.filter((e) => e.active !== false);
  const statusFiltered = filter === 'Confirmed' ? visiblePool.filter((e) => e.status === 'Confirmed')
    : filter === 'UnderWatch' ? visiblePool.filter((e) => e.status !== 'Confirmed')
    : visiblePool;
  const q = search.trim().toLowerCase();
  const searched = q ? statusFiltered.filter((e) => e.name.toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q)) : statusFiltered;
  const missingDefs = missingFiltersFor(dept);
  const filtered = missing.length ? searched.filter((e) => missing.every((k) => missingDefs.find((d) => d.key === k)?.test(e))) : searched;
  const statusCards = [
    { label: 'Total', count: activeDeptEmp.length, color: '#A855F7', filterVal: null, isTotal: true },
    { label: 'Not to be Monitored', count: activeDeptEmp.filter((e) => e.status === 'Confirmed').length, color: '#14B8A6', filterVal: 'Confirmed' },
    { label: 'Under Watch', count: activeDeptEmp.filter((e) => e.status !== 'Confirmed').length, color: '#8B8CF6', filterVal: 'UnderWatch' },
  ].map((s) => ({ ...s, active: s.isTotal ? !filter : filter === s.filterVal }));
  const baseHeads = METRIC_HEADS[dept] || METRIC_HEADS.Sales;
  const mh = dept === 'Sales' ? [...baseHeads, 'Neg. Audits', 'SCs Raised', 'Tech Calls', 'Shoddy Log', 'Mgr Feedback', 'Polls', 'KGT', 'Ideas']
    : dept === 'Trainer' ? [...baseHeads, 'Exams', 'Neg. Feedback', 'Assignments', 'Skills', 'In-House Skills', 'Tech Calls', 'TBTs', 'Shoddy Log', 'Mgr Feedback', 'Polls', 'KGT', 'Ideas']
    : [...baseHeads, 'Shoddy Log', 'Mgr Feedback', 'Polls', 'KGT', 'Ideas'];
  const rows = filtered.map((e) => {
    const d = decorate(e);
    const cells = baseHeads.map((_, i) => ({
      value: e.v[i],
      color: i === baseHeads.length - 1 ? (e.score < 0 ? '#F87171' : '#5EEAD4') : '#C7CBDA',
      onClick: null,
    }));
    if (dept === 'Sales') {
      cells.push({
        value: e.negAudits ?? '—',
        color: e.negAudits > 0 ? '#F87171' : e.negAudits === 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.negAudits > 0 ? () => setAuditModal(e) : null,
      });
      cells.push({
        value: e.scRaised ?? '—',
        color: e.scRaised > 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.scRaised > 0 ? () => setScModal(e) : null,
      });
      cells.push({
        value: e.techCallsCount ?? '—',
        color: e.techCallsCount > 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.techCallsCount > 0 ? () => setTechCallsModal(e) : null,
      });
      cells.push({
        value: e.active === false ? '—' : ((e.shoddyNegCount == null && e.shoddyPosCount == null) ? '—' : (e.shoddyNegCount ?? 0) + (e.shoddyPosCount ?? 0)),
        color: e.active === false ? '#6E7488' : (e.shoddyNegCount > 0 ? '#F87171' : e.shoddyPosCount > 0 ? '#5EEAD4' : '#6E7488'),
        onClick: e.active === false ? null : ((e.shoddyNegCount > 0 || e.shoddyPosCount > 0) ? () => setShoddyModal(e) : null),
      });
    }
    if (dept === 'Trainer') {
      const hasExamData = e.examPass !== null && e.examPass !== undefined;
      cells.push({
        value: hasExamData ? e.examPass : '—',
        color: hasExamData ? (e.examFail > 0 ? '#F87171' : '#5EEAD4') : '#6E7488',
        onClick: hasExamData ? () => setExamModal(e) : null,
      });
      cells.push({
        value: e.negFeedback ?? '—',
        color: e.negFeedback > 0 ? '#F87171' : e.negFeedback === 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.negFeedback > 0 ? () => setNegFbModal(e) : null,
      });
      cells.push({
        value: e.active === false ? '—' : (e.assignmentsCount ?? '—'),
        color: e.active === false ? '#6E7488' : (e.assignmentsCount > 0 ? '#5EEAD4' : '#6E7488'),
        onClick: e.active === false ? null : (e.assignmentsCount > 0 ? () => setAssignmentsModal(e) : null),
      });
      cells.push({
        value: e.skillsCount ?? '—',
        color: e.skillsCount > 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.skillsCount > 0 ? () => setSkillsModal(e) : null,
      });
      cells.push({
        value: e.inHouseSkillsCount ?? '—',
        color: e.inHouseSkillsCount > 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.inHouseSkillsCount > 0 ? () => setInHouseSkillsModal(e) : null,
      });
      cells.push({
        value: e.techCallsConverted ?? '—',
        color: e.techCallsConverted > 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.techCallsConverted !== null && e.techCallsConverted !== undefined ? () => setTechCallsConvModal(e) : null,
      });
      cells.push({
        value: e.tbtCount ?? '—',
        color: e.tbtCount > 0 ? '#5EEAD4' : '#6E7488',
        onClick: e.tbtCount > 0 ? () => setTbtModal(e) : null,
      });
      cells.push({
        value: e.active === false ? '—' : ((e.shoddyNegCount == null && e.shoddyPosCount == null) ? '—' : (e.shoddyNegCount ?? 0) + (e.shoddyPosCount ?? 0)),
        color: e.active === false ? '#6E7488' : (e.shoddyNegCount > 0 ? '#F87171' : e.shoddyPosCount > 0 ? '#5EEAD4' : '#6E7488'),
        onClick: e.active === false ? null : ((e.shoddyNegCount > 0 || e.shoddyPosCount > 0) ? () => setShoddyModal(e) : null),
      });
    }
    if (dept === 'PT Team') {
      cells.push({
        value: e.active === false ? '—' : ((e.shoddyNegCount == null && e.shoddyPosCount == null) ? '—' : (e.shoddyNegCount ?? 0) + (e.shoddyPosCount ?? 0)),
        color: e.active === false ? '#6E7488' : (e.shoddyNegCount > 0 ? '#F87171' : e.shoddyPosCount > 0 ? '#5EEAD4' : '#6E7488'),
        onClick: e.active === false ? null : ((e.shoddyNegCount > 0 || e.shoddyPosCount > 0) ? () => setShoddyModal(e) : null),
      });
    }
    cells.push({
      value: e.active === false ? '—' : (e.mgrFeedbackCount ?? '—'),
      color: e.active === false ? '#6E7488' : (e.mgrFeedbackCount > 0 ? '#5EEAD4' : '#6E7488'),
      onClick: e.active !== false && e.mgrFeedbackCount > 0 ? () => setMgrFeedbackModal(e) : null,
    });
    cells.push({
      value: e.active === false ? '—' : (e.pollsParticipated ?? '—'),
      color: e.active === false ? '#6E7488' : (e.pollsParticipated > 0 ? '#5EEAD4' : '#6E7488'),
      onClick: e.active !== false && e.pollsParticipated != null ? () => setPollsModal(e) : null,
    });
    cells.push({
      value: e.active === false ? '—' : (e.kgtCount ?? '—'),
      color: e.active === false ? '#6E7488' : (e.kgtCount > 0 ? '#5EEAD4' : '#6E7488'),
      onClick: e.active !== false && e.kgtCount > 0 ? () => setKgtModal(e) : null,
    });
    cells.push({
      value: e.active === false ? '—' : (e.ideasCount ?? '—'),
      color: e.active === false ? '#6E7488' : (e.ideasCount > 0 ? '#5EEAD4' : '#6E7488'),
      onClick: e.active !== false && e.ideasCount > 0 ? () => setIdeasModal(e) : null,
    });
    return { ...d, cells };
  });
  const gridCols = `1.5fr .75fr 1fr .55fr repeat(${mh.length},.7fr) .9fr 1fr`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {statusCards.map((s) => (
          <div key={s.label} onClick={() => setFilter(s.isTotal ? null : (filter === s.filterVal ? null : s.filterVal))}
            style={{ cursor: 'pointer', border: `1px solid ${s.active ? s.color : 'rgba(255,255,255,0.09)'}`, background: s.active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)', borderRadius: 12, padding: '13px 14px' }}>
            <div className="disp" style={{ fontSize: 24, fontWeight: 600, color: s.color, letterSpacing: '-0.02em' }}>{s.count}</div>
            <div style={{ fontSize: 11, color: '#A8AEC4', marginTop: 3, lineHeight: 1.3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search by name or employee ID…"
          style={{ flex: 1, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#E4E6F0', outline: 'none' }}
        />
        <IncludeInactiveToggle value={includeInactive} onChange={setIncludeInactive} />
        <div onClick={() => setFilter(null)} style={{ border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#A5A7FA', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer', flex: 'none' }}>
          {filter ? `Filter: ${filter === 'Confirmed' ? 'Not to be Monitored' : filter === 'UnderWatch' ? 'Under Watch' : filter} ×` : 'No filter applied'}
        </div>
      </div>

      <MissingFilterChips defs={missingDefs} active={missing} onToggle={toggleMissing} />

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '11px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span>Employee</span><span>DOJ</span><span>Manager</span><span>Day</span>
          {mh.map((h) => <span key={h} style={{ textAlign: 'right' }}>{h}</span>)}
          <span>Status</span><span style={{ textAlign: 'right' }}>Actions</span>
        </div>
        {rows.map((e) => (
          <div key={e.id} className="hoverrow" onClick={() => setModal(e)} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '13px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: 13, ...e.rowStyle }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: 600 }}>{e.name}</span><span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>{e.id}</span></div>
            <span style={{ color: '#A8AEC4', fontSize: 12 }}>{e.doj}</span>
            <span style={{ color: '#A8AEC4', fontSize: 12 }}>{e.manager}</span>
            <span className="mono" style={{ fontSize: 11, color: '#8A90A8' }}>{e.tenure}</span>
            {e.cells.map((c, i) => (
              <span
                key={i}
                onClick={c.onClick ? (ev) => { ev.stopPropagation(); c.onClick(); } : undefined}
                style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: c.color, cursor: c.onClick ? 'pointer' : undefined, textDecoration: c.onClick ? 'underline' : undefined, textUnderlineOffset: 3 }}
              >{c.value}</span>
            ))}
            <span style={{ justifySelf: 'start', fontSize: 10.5, padding: '4px 9px', borderRadius: 999, background: e.statusBg, color: e.statusColor, border: `1px solid ${e.statusBorder}` }}>{e.inactive ? 'Inactive' : e.status}</span>
            <div style={{ justifySelf: 'end', display: 'flex', gap: 6, alignItems: 'center' }} onClick={(ev) => ev.stopPropagation()}>
              {!e.inactive && e.bandLabel === 'Critical' && (
                <span onClick={() => openAlertPreview(e)} style={{ fontSize: 10.5, color: '#F87171', border: '1px solid rgba(244,63,94,0.4)', borderRadius: 7, padding: '4px 8px', cursor: 'pointer' }}>
                  Alert
                </span>
              )}
              {!e.inactive && (e.status === 'Confirmed'
                ? <span style={{ fontSize: 10.5, color: '#6E7488', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '4px 8px' }}>Closed</span>
                : <span onClick={() => closeEmployee(e)} style={{ fontSize: 10.5, color: '#8A90A8', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '4px 8px', cursor: pending === `close:${e.id}` ? 'default' : 'pointer', opacity: pending === `close:${e.id}` ? 0.6 : 1 }}>
                    {pending === `close:${e.id}` ? 'Closing…' : 'Close'}
                  </span>)}
            </div>
          </div>
        ))}
        {!rows.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No employees match this filter.</div>}
      </div>
      {alertModal}
      {auditModal && <AuditRemarksModal emp={auditModal} onClose={() => setAuditModal(null)} />}
      {scModal && <ScListModal emp={scModal} onClose={() => setScModal(null)} />}
      {techCallsModal && <TechCallsModal emp={techCallsModal} onClose={() => setTechCallsModal(null)} />}
      {techCallsConvModal && <TechCallsConvertedModal emp={techCallsConvModal} onClose={() => setTechCallsConvModal(null)} />}
      {tbtModal && <TbtModal emp={tbtModal} onClose={() => setTbtModal(null)} />}
      {shoddyModal && <ShoddyModal emp={shoddyModal} onClose={() => setShoddyModal(null)} />}
      {mgrFeedbackModal && <MgrFeedbackModal emp={mgrFeedbackModal} onClose={() => setMgrFeedbackModal(null)} />}
      {pollsModal && <PollsModal emp={pollsModal} onClose={() => setPollsModal(null)} />}
      {kgtModal && <KgtModal emp={kgtModal} onClose={() => setKgtModal(null)} />}
      {ideasModal && <IdeasModal emp={ideasModal} onClose={() => setIdeasModal(null)} />}
      {examModal && <ExamSummaryModal emp={examModal} onClose={() => setExamModal(null)} />}
      {negFbModal && <NegFeedbackModal emp={negFbModal} onClose={() => setNegFbModal(null)} />}
      {assignmentsModal && <AssignmentsModal emp={assignmentsModal} onClose={() => setAssignmentsModal(null)} />}
      {skillsModal && <SkillsModal emp={skillsModal} onClose={() => setSkillsModal(null)} />}
      {inHouseSkillsModal && <InHouseSkillsModal emp={inHouseSkillsModal} onClose={() => setInHouseSkillsModal(null)} />}
    </div>
  );
}

function AuditRemarksModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — negative audits</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.negAudits} below-satisfactory enquiry {emp.negAudits === 1 ? 'audit' : 'audits'}</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {emp.auditRemarks.map((a, i) => (
            <div key={i} style={{ border: '1px solid rgba(244,63,94,0.25)', background: 'rgba(244,63,94,0.05)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: '#F87171' }}>{a.createdOn}{a.enquiryId ? ` · Enquiry #${a.enquiryId}` : ''}</span>
                {a.clientEmail && <span className="mono" style={{ fontSize: 11, color: '#6E7488' }}>{a.clientEmail}</span>}
              </div>
              <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{a.remark}</div>
            </div>
          ))}
          {!emp.auditRemarks.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No remark text on file for these audits.</div>}
        </div>
      </div>
    </div>
  );
}

function ScListModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — SCs raised</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.scRaised} service {emp.scRaised === 1 ? 'contract' : 'contracts'} raised</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr .9fr .9fr', padding: '10px 0', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>SC ID</span><span>Created</span><span>Status</span><span>Quotation</span>
          </div>
          {emp.scDetails.map((s) => (
            <div key={s.scId} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr .9fr .9fr', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
              <span className="mono" style={{ color: '#C7CBDA' }}>{s.scId}</span>
              <span style={{ color: '#A8AEC4' }}>{s.createdOn ? s.createdOn.slice(0, 10) : '—'}</span>
              <span style={{ color: '#A8AEC4' }}>{s.status || '—'}</span>
              <span style={{ color: /cancel/i.test(s.quotationStatus || '') ? '#F87171' : '#5EEAD4' }}>{s.quotationStatus || '—'}</span>
            </div>
          ))}
          {!emp.scDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No SC records on file.</div>}
        </div>
      </div>
    </div>
  );
}

// Field names for a real tech-call record are unconfirmed (every live probe
// returned the API's "no matching record" placeholder rather than actual
// data), so each record renders as a generic key/value dump instead of
// named columns — whatever shape real data has will still display.
function TechCallsModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — tech calls</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.techCallsCount} tech {emp.techCallsCount === 1 ? 'call' : 'calls'} attended</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {emp.techCallsDetails.map((call, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(call).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
                  <span style={{ color: '#8A90A8' }}>{k}</span>
                  <span style={{ color: '#C7CBDA', textAlign: 'right' }}>{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
                </div>
              ))}
            </div>
          ))}
          {!emp.techCallsDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No tech call records on file.</div>}
        </div>
      </div>
    </div>
  );
}

// This feed only ever returns a single summary count — no per-call list
// exists to drill into, unlike the Sales tech-call feed.
function TechCallsConvertedModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — tech calls converted</div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '18px 20px', textAlign: 'center' }}>
            <div className="disp" style={{ fontSize: 34, fontWeight: 600, color: '#5EEAD4' }}>{emp.techCallsConverted}</div>
            <div style={{ fontSize: 11.5, color: '#A8AEC4', marginTop: 4 }}>Converted tech calls</div>
          </div>
          <div style={{ fontSize: 12, color: '#6E7488', lineHeight: 1.5 }}>
            The source API only reports a total converted count for this feed — no per-call date or detail is available to show.
          </div>
        </div>
      </div>
    </div>
  );
}

// The polls dashboard only reports a total participation count — no
// per-poll date or topic list is available to show, same as converted tech
// calls.
function PollsModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — polls</div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '18px 20px', textAlign: 'center' }}>
            <div className="disp" style={{ fontSize: 34, fontWeight: 600, color: '#5EEAD4' }}>{emp.pollsParticipated}</div>
            <div style={{ fontSize: 11.5, color: '#A8AEC4', marginTop: 4 }}>Polls participated</div>
          </div>
          <div style={{ fontSize: 12, color: '#6E7488', lineHeight: 1.5 }}>
            The polls dashboard only reports a total participation count for this feed — no per-poll date or topic is available to show.
          </div>
        </div>
      </div>
    </div>
  );
}

// KGT = ownership-transfer request. Unlike Polls, this feed does return a
// per-request breakdown (topic, department, dates), so this shows a list
// like TechCallsModal rather than just a total count.
function KgtModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — KGT</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.kgtCount} KGT{emp.kgtCount === 1 ? '' : 's'} applied for</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {emp.kgtDetails.map((kgt, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[['topic', kgt.topic], ['submitted_at', kgt.submitted_at]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
                  <span style={{ color: '#8A90A8' }}>{k}</span>
                  <span style={{ color: '#C7CBDA', textAlign: 'right' }}>{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
                </div>
              ))}
            </div>
          ))}
          {!emp.kgtDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No KGT records on file.</div>}
        </div>
      </div>
    </div>
  );
}

// Non-RMS Tasks By EmpID — "Ideas for improvement" signal. Each task is a
// full record (executor, raiser, source, status, description, timestamps),
// so this shows a list like TechCallsModal rather than just a total count.
function IdeasModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — ideas for improvement</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.ideasCount} {emp.ideasCount === 1 ? 'task' : 'tasks'} on file</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {emp.ideasDetails.map((task, i) => {
            // Koenig's own feed leaves TaskStatus blank rather than sending
            // an explicit "Pending" — anything not (yet) marked Complete
            // reads as Pending here so every task gets an unambiguous state.
            const statusLabel = task.taskStatus && task.taskStatus.trim() ? task.taskStatus.trim() : 'Pending';
            const isComplete = /complete|closed|done|resolved/i.test(statusLabel);
            const statusColor = isComplete ? '#5EEAD4' : '#F59E0B';
            return (
              <div key={task.autoTaskId ?? i} style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
                  <span className="mono" style={{ color: '#8A90A8' }}>{task.createdDateTime ? String(task.createdDateTime).slice(0, 10) : '—'}{task.sourceName ? ` · ${task.sourceName}` : ''}</span>
                  <span style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: statusColor, border: `1px solid ${statusColor}55`, background: `${statusColor}1F`, borderRadius: 999, padding: '2px 9px', flex: 'none' }}>{statusLabel}</span>
                </div>
                <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{task.taskDescription || '—'}</div>
                <div style={{ fontSize: 11.5, color: '#6E7488' }}>Raised by {task.raisedByName || '—'}</div>
              </div>
            );
          })}
          {!emp.ideasDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No Non-RMS tasks on file.</div>}
        </div>
      </div>
    </div>
  );
}

function MgrFeedbackModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — manager feedback</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.mgrFeedbackCount} {emp.mgrFeedbackCount === 1 ? 'entry' : 'entries'} on file</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {emp.mgrFeedbackDetails.map((f, i) => {
            const rating = feedbackRating(f);
            const ratingStyle = rating === 'below'
              ? { border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.06)' }
              : rating === 'good'
              ? { border: '1px solid rgba(20,184,166,0.3)', background: 'rgba(20,184,166,0.05)' }
              : { border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)' };
            return (
            <div key={i} style={{ ...ratingStyle, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                <span className="mono" style={{ color: '#8A90A8' }}>{f.date || '—'}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {rating && <span className="mono" style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, color: rating === 'below' ? '#F87171' : '#5EEAD4', border: `1px solid ${rating === 'below' ? 'rgba(244,63,94,0.4)' : 'rgba(20,184,166,0.4)'}` }}>{rating === 'below' ? 'Below satisfactory' : 'Satisfactory'}</span>}
                  <span className="mono" style={{ color: '#6E7488' }}>{f.managerName || '—'}</span>
                </div>
              </div>
              {f.strength && <div style={{ fontSize: 13, color: '#5EEAD4', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}><b style={{ color: '#A8AEC4', fontWeight: 600 }}>Strength: </b>{f.strength}</div>}
              {f.improvement && <div style={{ fontSize: 13, color: '#F59E0B', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}><b style={{ color: '#A8AEC4', fontWeight: 600 }}>Improvement: </b>{f.improvement}</div>}
              {f.other && <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}><b style={{ color: '#A8AEC4', fontWeight: 600 }}>Other: </b>{f.other}</div>}
              {!f.strength && !f.improvement && !f.other && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No text recorded for this entry.</div>}
            </div>
            );
          })}
          {!emp.mgrFeedbackDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No manager feedback on file.</div>}
        </div>
      </div>
    </div>
  );
}

function TbtModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — TBTs</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.tbtCount} {emp.tbtCount === 1 ? 'TBT' : 'TBTs'} requested</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', padding: '10px 0', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>Topic</span><span>Requested</span><span>TBT Date</span>
          </div>
          {emp.tbtDetails.map((t, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
              <span style={{ color: '#C7CBDA' }}>{t.topic || '—'}</span>
              <span style={{ color: '#A8AEC4' }}>{t.requestedOn || '—'}</span>
              <span style={{ color: '#5EEAD4' }}>{t.tbtDate || '—'}</span>
            </div>
          ))}
          {!emp.tbtDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No TBT records on file.</div>}
        </div>
      </div>
    </div>
  );
}

function ShoddyModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — Shoddy Log</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.shoddyNegCount ?? 0} negative · {emp.shoddyPosCount ?? 0} positive</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.09em', color: '#F87171', textTransform: 'uppercase', marginBottom: 10 }}>Negative Shoddies</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(emp.shoddyNegDetails || []).map((s, i) => (
                <div key={i} style={{ border: '1px solid rgba(244,63,94,0.25)', background: 'rgba(244,63,94,0.05)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                    <span className="mono" style={{ color: '#F87171' }}>{s.reportedDate || '—'}</span>
                    {s.incidentType && <span className="mono" style={{ color: '#F87171', background: 'rgba(244,63,94,0.12)', borderRadius: 6, padding: '2px 8px' }}>{s.incidentType}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{s.reason || '—'}</div>
                  <div style={{ fontSize: 11.5, color: '#8A90A8' }}>Manager: {s.repMngr || '—'}</div>
                </div>
              ))}
              {!(emp.shoddyNegDetails || []).length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No negative shoddy records on file.</div>}
            </div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.09em', color: '#5EEAD4', textTransform: 'uppercase', marginBottom: 10 }}>Positive Incidents</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(emp.shoddyPosDetails || []).map((s, i) => (
                <div key={i} style={{ border: '1px solid rgba(94,234,212,0.25)', background: 'rgba(94,234,212,0.05)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                    <span className="mono" style={{ color: '#5EEAD4' }}>{s.reportedDate || '—'}</span>
                    {s.incidentType && <span className="mono" style={{ color: '#5EEAD4', background: 'rgba(94,234,212,0.12)', borderRadius: 6, padding: '2px 8px' }}>{s.incidentType}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{s.reason || '—'}</div>
                  <div style={{ fontSize: 11.5, color: '#8A90A8' }}>Manager: {s.repMngr || '—'}</div>
                </div>
              ))}
              {!(emp.shoddyPosDetails || []).length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No positive incidents on file.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExamSummaryModal({ emp, onClose }) {
  const stats = [
    { label: 'Total Exams', value: emp.examTotal ?? emp.examPass + emp.examFail, color: '#A5A7FA' },
    { label: 'Passed', value: emp.examPass, color: '#5EEAD4' },
    { label: 'Failed', value: emp.examFail, color: '#F87171' },
    { label: 'Not Updated', value: emp.examNotUpdated ?? 0, color: '#F59E0B' },
  ];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — exam summary</div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '14px 16px' }}>
              <div className="disp" style={{ fontSize: 26, fontWeight: 600, color: s.color, letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: 11.5, color: '#A8AEC4', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NegFeedbackModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 600, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — negative feedback</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.negFeedback} negative {emp.negFeedback === 1 ? 'report' : 'reports'}</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {emp.negFeedbackDetails.map((f, i) => (
            <div key={i} style={{ border: '1px solid rgba(244,63,94,0.25)', background: 'rgba(244,63,94,0.05)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: '#F87171' }}>Assignment #{f.assignmentId} · {f.feedbackDate}</span>
                {f.clientName && <span className="mono" style={{ fontSize: 11, color: '#6E7488' }}>{f.clientName}</span>}
              </div>
              {f.question && <div style={{ fontSize: 11, color: '#8A90A8', marginBottom: 4 }}>{f.question}</div>}
              <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{f.answer}</div>
            </div>
          ))}
          {!emp.negFeedbackDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No detail on file for these reports.</div>}
        </div>
      </div>
    </div>
  );
}

function AssignmentsModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — assignments</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.assignmentsCount} {emp.assignmentsCount === 1 ? 'assignment' : 'assignments'} delivered</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr .6fr .8fr', padding: '10px 0', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>Course</span><span>Start</span><span>End</span><span>Pax</span><span>Mode</span>
          </div>
          {emp.assignmentsDetails.map((a) => (
            <div key={a.assignmentId} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr .6fr .8fr', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
              <span style={{ color: '#C7CBDA' }}>{a.courseName}</span>
              <span style={{ color: '#A8AEC4' }}>{a.startDate || '—'}</span>
              <span style={{ color: '#A8AEC4' }}>{a.endDate || '—'}</span>
              <span className="mono" style={{ color: '#A8AEC4' }}>{a.totalPax ?? '—'}</span>
              <span style={{ color: '#5EEAD4' }}>{a.deliveryMode || '—'}</span>
            </div>
          ))}
          {!emp.assignmentsDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No assignment records on file.</div>}
        </div>
      </div>
    </div>
  );
}

function SkillsModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — skills</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.skillsCount} {emp.skillsCount === 1 ? 'course' : 'courses'} marked</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          {emp.skillsDetails.map((s) => (
            <div key={s.courseId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
              <span style={{ color: '#C7CBDA' }}>{s.courseName}</span>
              <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                {s.isDuplicate && <span style={{ fontSize: 10.5, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, padding: '3px 7px' }}>Duplicate</span>}
                {s.isDiscontinued && <span style={{ fontSize: 10.5, color: '#F87171', border: '1px solid rgba(244,63,94,0.35)', borderRadius: 6, padding: '3px 7px' }}>Discontinued</span>}
              </div>
            </div>
          ))}
          {!emp.skillsDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No skill records on file.</div>}
        </div>
      </div>
    </div>
  );
}

function InHouseSkillsModal({ emp, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.name} — in-house skills</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{emp.inHouseSkillsCount} {emp.inHouseSkillsCount === 1 ? 'course' : 'courses'} marked in-house</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr .9fr', padding: '10px 0', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>Course</span><span>Trainer</span><span>Marked on</span>
          </div>
          {emp.inHouseSkillsDetails.map((s) => (
            <div key={s.courseId} style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr .9fr', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
              <span style={{ color: '#C7CBDA' }}>{s.courseName}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: '#A8AEC4' }}>{s.trainerName || '—'}</span>
                {!s.trainerActive && <span style={{ fontSize: 10.5, color: '#F59E0B', width: 'fit-content', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, padding: '2px 6px' }}>Trainer inactive</span>}
              </div>
              <span className="mono" style={{ color: '#A8AEC4' }}>{s.markDate || '—'}</span>
            </div>
          ))}
          {!emp.inHouseSkillsDetails.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No in-house skill records on file.</div>}
        </div>
      </div>
    </div>
  );
}

function PaPip({ employees, filter, setFilter, setModal }) {
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [missing, setMissing] = useState([]);
  const toggleMissing = (key) => setMissing((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));
  const tabs = [['All Departments', 6, null], ['Sales', 3, 'Sales'], ['Trainer', 2, 'Trainer'], ['PT Team', 1, 'PT Team']].map(([label, count, d]) => ({
    label, count, val: d, active: filter === d || (!filter && !d),
  }));
  const q = search.trim().toLowerCase();
  const missingDefs = missingFiltersFor(filter);
  const rows = employees
    .filter((e) => (includeInactive || e.active !== false) && e.status !== 'In Progress')
    .filter((e) => !filter || e.team === filter)
    .filter((e) => !q || e.name.toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q))
    .map(decorate)
    .filter((e) => !missing.length || missing.every((k) => missingDefs.find((d) => d.key === k)?.test(e)))
    .sort((a, b) => a.score - b.score);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        <div style={{ border: '1px solid rgba(168,85,247,0.28)', background: 'linear-gradient(150deg,rgba(168,85,247,0.14),rgba(168,85,247,0.02))', borderRadius: 16, padding: 20 }}><div style={{ fontSize: 12, color: '#A8AEC4' }}>Total PA / PIP cases</div><div className="disp" style={{ fontSize: 36, fontWeight: 600, marginTop: 6 }}>6</div></div>
        <div style={{ border: '1px solid rgba(245,158,11,0.28)', background: 'linear-gradient(150deg,rgba(245,158,11,0.13),rgba(245,158,11,0.02))', borderRadius: 16, padding: 20 }}><div style={{ fontSize: 12, color: '#A8AEC4' }}>PA Issued</div><div className="disp" style={{ fontSize: 36, fontWeight: 600, marginTop: 6, color: '#F59E0B' }}>4</div></div>
        <div style={{ border: '1px solid rgba(244,63,94,0.28)', background: 'linear-gradient(150deg,rgba(244,63,94,0.13),rgba(244,63,94,0.02))', borderRadius: 16, padding: 20 }}><div style={{ fontSize: 12, color: '#A8AEC4' }}>PIP Issued</div><div className="disp" style={{ fontSize: 36, fontWeight: 600, marginTop: 6, color: '#F43F5E' }}>2</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <div key={t.label} onClick={() => setFilter(t.val)} style={{ cursor: 'pointer', border: `1px solid ${t.active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.1)'}`, background: t.active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)', color: t.active ? '#FFFFFF' : '#9BA1B8', borderRadius: 999, padding: '8px 16px', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{t.label}</span><span className="mono" style={{ fontSize: 11, opacity: 0.75 }}>{t.count}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search by name or employee ID…"
          style={{ flex: 1, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#E4E6F0', outline: 'none' }}
        />
        <IncludeInactiveToggle value={includeInactive} onChange={setIncludeInactive} />
      </div>
      <MissingFilterChips defs={missingDefs} active={missing} onToggle={toggleMissing} />
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr .7fr .8fr .8fr 1.9fr .7fr', padding: '11px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span>Employee</span><span>Type</span><span>Issued</span><span>Review by</span><span>Worry parameters breached</span><span style={{ textAlign: 'right' }}>Score</span>
        </div>
        {rows.map((e) => (
          <div key={e.id} className="hoverrow" onClick={() => setModal(e)} style={{ display: 'grid', gridTemplateColumns: '1.4fr .7fr .8fr .8fr 1.9fr .7fr', padding: '14px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: 13, ...e.rowStyle }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: 600 }}>{e.name}</span><span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>{e.id} · {e.team}</span></div>
            <span style={{ justifySelf: 'start', fontSize: 10.5, padding: '4px 9px', borderRadius: 999, background: e.statusBg, color: e.statusColor, border: `1px solid ${e.statusBorder}` }}>{e.inactive ? 'Inactive' : e.short}</span>
            <span style={{ fontSize: 12, color: '#A8AEC4' }}>{e.issued}</span>
            <span style={{ fontSize: 12, color: '#A8AEC4' }}>{e.due}</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {e.breaches.map((b) => <span key={b} style={{ fontSize: 10.5, color: '#F87171', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 6, padding: '3px 7px' }}>{b}</span>)}
            </div>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontWeight: 600, color: e.bandColor }}>{e.scoreStr}</span>
          </div>
        ))}
        {!rows.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No PA/PIP cases match this filter.</div>}
      </div>
    </div>
  );
}

function WorryIndex({ employees, filter, setFilter, setModal }) {
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [missing, setMissing] = useState([]);
  const toggleMissing = (key) => setMissing((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));
  const active = employees.map(decorate).filter((e) => includeInactive || !e.inactive);
  const tabs = [['All Departments', null], ['Sales', 'Sales'], ['Trainer', 'Trainer'], ['PT Team', 'PT Team']].map(([label, val]) => ({
    label, val, active: filter === val || (!filter && !val),
    count: val ? active.filter((e) => e.team === val).length : active.length,
  }));
  const q = search.trim().toLowerCase();
  const missingDefs = missingFiltersFor(filter);
  const ranked = active
    .filter((e) => !filter || e.team === filter)
    .filter((e) => !q || e.name.toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q))
    .filter((e) => !missing.length || missing.every((k) => missingDefs.find((d) => d.key === k)?.test(e)))
    .sort((a, b) => a.score - b.score);
  const bandCounts = ranked.reduce((acc, e) => {
    acc[e.bandLabel] = (acc[e.bandLabel] || 0) + 1;
    return acc;
  }, {});
  // Reference tables scope to whichever department tab is selected, and each
  // row shows real coverage for that scope instead of just the static weight.
  const coverageFor = (s) => {
    const eligible = ranked.filter((e) => appliesToTeam(s.teams, e.team));
    const fired = eligible.filter((e) => e.signals.some((sig) => sig.label === s.label)).length;
    const noData = eligible.filter((e) => e.signalReport.find((r) => r.label === s.label)?.status === 'no-data').length;
    return { eligible: eligible.length, fired, noData };
  };
  const posSignals = POS_SIGNALS.filter((s) => !filter || appliesToTeam(s.teams, filter));
  const negSignals = NEG_SIGNALS.filter((s) => !filter || appliesToTeam(s.teams, filter));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <div key={t.label} onClick={() => setFilter(t.val)} style={{ cursor: 'pointer', border: `1px solid ${t.active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.1)'}`, background: t.active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)', color: t.active ? '#FFFFFF' : '#9BA1B8', borderRadius: 999, padding: '8px 16px', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{t.label}</span><span className="mono" style={{ fontSize: 11, opacity: 0.75 }}>{t.count}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search by name or employee ID…"
          style={{ flex: 1, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#E4E6F0', outline: 'none' }}
        />
        <IncludeInactiveToggle value={includeInactive} onChange={setIncludeInactive} />
      </div>
      <MissingFilterChips defs={missingDefs} active={missing} onToggle={toggleMissing} />
      <div>
        <div className="disp" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Bands</div>
        <div style={{ fontSize: 12.5, color: '#8A90A8', marginBottom: 14 }}>Every signal carries a credit weight — minor ±0.5, average ±1, major ±2. The running total places the NJ in one of four bands.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {WORRY_BANDS.map((b) => (
            <div key={b.label} style={{ border: `1px solid ${b.color}4D`, background: `${b.color}12`, borderRadius: 14, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div className="disp" style={{ fontSize: 17, fontWeight: 600, color: b.color }}>{b.label}</div>
                <div className="disp" style={{ fontSize: 20, fontWeight: 600, color: b.color }}>{bandCounts[b.label] || 0}</div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: '#8A90A8', marginTop: 4 }}>{b.range}</div>
              <div style={{ fontSize: 12.5, color: '#8A90A8', marginTop: 8, lineHeight: 1.5 }}>{b.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="disp" style={{ fontSize: 15, fontWeight: 600 }}>Every NJ, ranked worst to best</div>
          <div style={{ fontSize: 11.5, color: '#6E7488', marginTop: 2 }}>2026-W30 · click a row for the full signal breakdown</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr .9fr .7fr .8fr 2fr', padding: '10px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, letterSpacing: '.1em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span>Employee</span><span>Team</span><span style={{ textAlign: 'right' }}>Score</span><span>Band</span><span>Trend</span>
        </div>
        {ranked.map((e) => (
          <div key={e.id} className="hoverrow" onClick={() => setModal(e)} style={{ display: 'grid', gridTemplateColumns: '1.5fr .9fr .7fr .8fr 2fr', padding: '13px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: 13, ...e.rowStyle }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: 600 }}>{e.name}</span><span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>{e.id}</span></div>
            <span style={{ color: '#A8AEC4', fontSize: 12.5 }}>{e.team}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontWeight: 600, color: e.bandColor }}>{e.scoreStr}</span>
            <span style={{ justifySelf: 'start', fontSize: 11, padding: '4px 9px', borderRadius: 999, background: `${e.bandColor}1F`, color: e.bandColor, border: `1px solid ${e.bandColor}55` }}>{e.bandLabel}</span>
            <span style={{ fontSize: 12, color: '#8A90A8' }}>{e.trendNote}</span>
          </div>
        ))}
        {!ranked.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No NJ matches this filter.</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, background: 'rgba(20,184,166,0.03)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }} className="mono">
            <span style={{ fontSize: 10.5, letterSpacing: '.14em', color: '#14B8A6', textTransform: 'uppercase' }}>Positive signals</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr .8fr .5fr .9fr', padding: '9px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.08em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span>Signal</span><span>Applies to</span><span style={{ textAlign: 'right' }}>Weight</span><span style={{ textAlign: 'right' }}>Coverage</span>
          </div>
          {posSignals.map((s) => {
            const cov = coverageFor(s);
            return (
              <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '1fr .8fr .5fr .9fr', padding: '10px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: s.live ? 1 : 0.45 }}>
                <span style={{ fontSize: 13, color: '#C7CBDA', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.label}
                  {!s.live && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.06em', color: '#6E7488', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 6px', textTransform: 'uppercase' }}>not tracked</span>}
                </span>
                <span style={{ fontSize: 11, color: '#6E7488' }}>{s.teams}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12.5, color: '#14B8A6' }}>{s.w}</span>
                <span style={{ textAlign: 'right', fontSize: 11, color: '#6E7488' }}>
                  {s.live ? `fired ${cov.fired}/${cov.eligible}${cov.noData ? ` · ${cov.noData} no data` : ''}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, background: 'rgba(244,63,94,0.03)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }} className="mono">
            <span style={{ fontSize: 10.5, letterSpacing: '.14em', color: '#F43F5E', textTransform: 'uppercase' }}>Negative signals</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr .8fr .5fr .9fr', padding: '9px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.08em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span>Signal</span><span>Applies to</span><span style={{ textAlign: 'right' }}>Weight</span><span style={{ textAlign: 'right' }}>Coverage</span>
          </div>
          {negSignals.map((s) => {
            const cov = coverageFor(s);
            return (
              <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '1fr .8fr .5fr .9fr', padding: '10px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: s.live ? 1 : 0.45 }}>
                <span style={{ fontSize: 13, color: '#C7CBDA', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.label}
                  {!s.live && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.06em', color: '#6E7488', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 6px', textTransform: 'uppercase' }}>not tracked</span>}
                </span>
                <span style={{ fontSize: 11, color: '#6E7488' }}>{s.teams}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12.5, color: '#F87171' }}>{s.w}</span>
                <span style={{ textAlign: 'right', fontSize: 11, color: '#6E7488' }}>
                  {s.live ? `fired ${cov.fired}/${cov.eligible}${cov.noData ? ` · ${cov.noData} no data` : ''}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtIst(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST';
}
function fmtDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function fmtDelay(seconds) {
  if (seconds == null) return '—';
  if (seconds <= 0) return `${fmtDuration(-seconds)} early`;
  return `${fmtDuration(seconds)} late`;
}
const TIMING_COLORS = {
  'On Time': '#5EEAD4',
  Late: '#F59E0B',
  'Did Not Join': '#F87171',
  'No Data': '#6E7488',
};

// Graph API Calls — Sales' Teams meetings pulled from each rep's Outlook
// calendar (join timing) plus, once a callRecords webhook notification has
// matched a meeting, whether audio/video quality was flagged. Purely
// informational for now — not wired into the Worry Index yet (see the "not
// tracked" badges still on those two signals in Worry Index) until this
// data's been reviewed.
function GraphCalls({ meetings, employees, filter, setFilter }) {
  const [search, setSearch] = useState('');
  const [empDetail, setEmpDetail] = useState(null);
  const [meetingDetail, setMeetingDetail] = useState(null);
  const [rosterDetail, setRosterDetail] = useState(null);

  const rosterByEmployee = new Map((employees || []).map((e) => [e.id, e]));

  const total = meetings.length;
  const onTime = meetings.filter((m) => m.timingStatus === 'On Time').length;
  const late = meetings.filter((m) => m.timingStatus === 'Late').length;
  const didNotJoin = meetings.filter((m) => m.timingStatus === 'Did Not Join').length;
  const avIssues = meetings.filter((m) => m.avIssue === true).length;

  const cards = [
    { label: 'Meetings Tracked', count: total, color: '#A5A7FA', filterVal: null },
    { label: 'On Time', count: onTime, color: '#5EEAD4', filterVal: 'OnTime' },
    { label: 'Late', count: late, color: '#F59E0B', filterVal: 'Late' },
    { label: 'Did Not Join', count: didNotJoin, color: '#F87171', filterVal: 'DidNotJoin' },
    { label: 'A/V Issues', count: avIssues, color: '#F87171', filterVal: 'AvIssue' },
  ].map((c) => ({ ...c, active: filter === c.filterVal || (!filter && c.filterVal === null) }));

  const matchesFilter = (m) => {
    if (filter === 'OnTime') return m.timingStatus === 'On Time';
    if (filter === 'Late') return m.timingStatus === 'Late';
    if (filter === 'DidNotJoin') return m.timingStatus === 'Did Not Join';
    if (filter === 'AvIssue') return m.avIssue === true;
    return true;
  };

  // One row per employee — meeting-level detail (start time, joined time,
  // timing, quality) lives behind "Click to see meeting details" so this
  // list stays scannable even for reps with dozens of tracked meetings.
  const byEmployee = new Map();
  for (const m of meetings) {
    if (!byEmployee.has(m.employeeId)) byEmployee.set(m.employeeId, { employeeId: m.employeeId, employeeName: m.employeeName, team: m.team, meetings: [] });
    byEmployee.get(m.employeeId).meetings.push(m);
  }
  const q = search.trim().toLowerCase();
  const employeeRows = [...byEmployee.values()]
    .filter((e) => !q || e.employeeName.toLowerCase().includes(q))
    .filter((e) => !filter || e.meetings.some(matchesFilter))
    .map((e) => ({
      ...e,
      total: e.meetings.length,
      onTime: e.meetings.filter((m) => m.timingStatus === 'On Time').length,
      late: e.meetings.filter((m) => m.timingStatus === 'Late').length,
      didNotJoin: e.meetings.filter((m) => m.timingStatus === 'Did Not Join').length,
      avIssues: e.meetings.filter((m) => m.avIssue === true).length,
      rosterCount: rosterByEmployee.get(e.employeeId)?.rosterCount ?? null,
      rosterDetails: rosterByEmployee.get(e.employeeId)?.rosterDetails ?? [],
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const gridCols = '1.4fr .8fr .8fr .8fr .8fr .8fr 1fr 1.3fr';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.06)', borderRadius: 12, padding: '12px 16px', fontSize: 12.5, color: '#A8AEC4', lineHeight: 1.5 }}>
        Sourced from each Sales rep's Outlook calendar and Teams attendance reports via Microsoft Graph. Audio/video quality only appears once a callRecords webhook notification arrives for that meeting — "No Data" there just means none has landed yet, not a clean call. Roster is a separate feed (Koenig's Get CSM Roster) — click it to see that rep's on-file shift history. This screen doesn't feed the Worry Index score yet.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
        {cards.map((c) => (
          <div key={c.label} onClick={() => setFilter(c.active && c.filterVal !== null ? null : c.filterVal)}
            style={{ cursor: 'pointer', border: `1px solid ${c.active ? c.color : 'rgba(255,255,255,0.09)'}`, background: c.active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)', borderRadius: 12, padding: '13px 14px' }}>
            <div className="disp" style={{ fontSize: 24, fontWeight: 600, color: c.color, letterSpacing: '-0.02em' }}>{c.count}</div>
            <div style={{ fontSize: 11, color: '#A8AEC4', marginTop: 3, lineHeight: 1.3 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search by employee name…"
          style={{ flex: 1, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#E4E6F0', outline: 'none' }}
        />
        <div onClick={() => setFilter(null)} style={{ border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#A5A7FA', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer', flex: 'none' }}>
          {filter ? `Filter: ${cards.find((c) => c.filterVal === filter)?.label} ×` : 'No filter applied'}
        </div>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '11px 18px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span>Employee</span><span style={{ textAlign: 'right' }}>Meetings</span><span style={{ textAlign: 'right' }}>On Time</span><span style={{ textAlign: 'right' }}>Late</span><span style={{ textAlign: 'right' }}>Did Not Join</span><span style={{ textAlign: 'right' }}>A/V Issues</span><span style={{ textAlign: 'right' }}>Roster</span><span style={{ textAlign: 'right' }}>Details</span>
        </div>
        {employeeRows.map((e) => (
          <div key={e.employeeId} className="hoverrow" style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '13px 18px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{e.employeeName}</span>
              <span style={{ fontSize: 11, color: '#6E7488' }}>{e.team}</span>
            </div>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: '#C7CBDA' }}>{e.total}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: '#5EEAD4' }}>{e.onTime}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: e.late > 0 ? '#F59E0B' : '#6E7488' }}>{e.late}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: e.didNotJoin > 0 ? '#F87171' : '#6E7488' }}>{e.didNotJoin}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: e.avIssues > 0 ? '#F87171' : '#6E7488' }}>{e.avIssues}</span>
            {e.rosterCount ? (
              <span onClick={() => setRosterDetail(e)} style={{ textAlign: 'right', fontSize: 12.5, color: '#A5A7FA', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>{e.rosterCount} shift{e.rosterCount === 1 ? '' : 's'}</span>
            ) : (
              <span style={{ textAlign: 'right', fontSize: 12, color: '#6E7488' }}>No data</span>
            )}
            <span onClick={() => setEmpDetail(e)} style={{ textAlign: 'right', fontSize: 12.5, color: '#A5A7FA', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>Click to see meeting details</span>
          </div>
        ))}
        {!employeeRows.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>{total === 0 ? 'No Teams meetings synced yet — run the graphmeetings sync feed.' : 'No employees match this filter.'}</div>}
      </div>

      {empDetail && <EmployeeMeetingsModal emp={empDetail} onClose={() => setEmpDetail(null)} onSelectMeeting={setMeetingDetail} />}
      {meetingDetail && <GraphMeetingModal meeting={meetingDetail} onClose={() => setMeetingDetail(null)} />}
      {rosterDetail && <EmployeeRosterModal emp={rosterDetail} onClose={() => setRosterDetail(null)} />}
    </div>
  );
}

// DD-MMM-YYYY, e.g. 19-Aug-2026.
function fmtRosterDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

// Koenig sends times as "HH:mm:ss" — parsed manually (not via Date) since
// a bare time string has no reliable cross-browser Date parse.
function fmtRosterTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return timeStr;
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${m} ${period}`;
}

// Duty roster from the Koenig "Get CSM Roster" feed — one row per shift day
// on file, newest first (see lib/syncRunners.js's syncCsmRoster).
function EmployeeRosterModal({ emp, onClose }) {
  const shifts = emp.rosterDetails || [];
  const gridCols = '1.1fr 1.5fr';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.employeeName} — roster status</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{shifts.length} shift{shifts.length === 1 ? '' : 's'} on file</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '10px 0', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>Date</span><span>Timing</span>
          </div>
          {shifts.map((s, i) => {
            const dateLabel = s.startDate === s.endDate || !s.endDate
              ? fmtRosterDate(s.startDate)
              : `${fmtRosterDate(s.startDate)} → ${fmtRosterDate(s.endDate)}`;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '11px 0', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
                <span className="mono" style={{ color: '#C7CBDA' }}>{dateLabel}</span>
                <span className="mono" style={{ color: '#8A90A8' }}>{fmtRosterTime(s.startTime)} to {fmtRosterTime(s.endTime)}</span>
              </div>
            );
          })}
          {!shifts.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No roster data on file.</div>}
        </div>
      </div>
    </div>
  );
}

function EmployeeMeetingsModal({ emp, onClose, onSelectMeeting }) {
  const meetings = [...emp.meetings].sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart));
  const gridCols = '1.8fr 1.1fr 1.1fr .9fr .8fr .9fr';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 800, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{emp.employeeName} — meeting details</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{meetings.length} Teams {meetings.length === 1 ? 'meeting' : 'meetings'} tracked</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '10px 0', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, letterSpacing: '.09em', color: '#5C6178', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>Meeting</span><span>Start Time</span><span>Joined Time</span><span>Timing</span><span style={{ textAlign: 'right' }}>Duration</span><span style={{ textAlign: 'right' }}>A/V Quality</span>
          </div>
          {meetings.map((m) => (
            <div key={m.id} className="hoverrow" onClick={() => onSelectMeeting(m)} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 10, padding: '11px 0', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5, cursor: 'pointer' }}>
              <span style={{ color: '#C7CBDA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</span>
              <span className="mono" style={{ fontSize: 11.5, color: '#8A90A8' }}>{fmtIst(m.scheduledStart)}</span>
              <span className="mono" style={{ fontSize: 11.5, color: '#8A90A8' }}>{fmtIst(m.joinedAt)}</span>
              <span style={{ justifySelf: 'start', fontSize: 10.5, padding: '4px 9px', borderRadius: 999, background: `${TIMING_COLORS[m.timingStatus]}1F`, color: TIMING_COLORS[m.timingStatus], border: `1px solid ${TIMING_COLORS[m.timingStatus]}55` }}>{m.timingStatus}</span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: '#C7CBDA' }}>{fmtDuration(m.attendanceSeconds)}</span>
              <span style={{ textAlign: 'right', fontSize: 10.5, padding: '4px 9px', borderRadius: 999, justifySelf: 'end', background: m.avIssue == null ? 'rgba(255,255,255,0.05)' : m.avIssue ? 'rgba(244,63,94,0.14)' : 'rgba(20,184,166,0.14)', color: m.avIssue == null ? '#6E7488' : m.avIssue ? '#F87171' : '#5EEAD4', border: `1px solid ${m.avIssue == null ? 'rgba(255,255,255,0.12)' : m.avIssue ? 'rgba(244,63,94,0.35)' : 'rgba(20,184,166,0.35)'}` }}>
                {m.avIssue == null ? 'No Data' : m.avIssue ? 'Issue' : 'Clean'}
              </span>
            </div>
          ))}
          {!meetings.length && <div style={{ fontSize: 12.5, color: '#6E7488', paddingTop: 12 }}>No meetings on file.</div>}
          <div style={{ fontSize: 11.5, color: '#6E7488', marginTop: 14 }}>Click a meeting for full detail, including any audio/video quality breakdown.</div>
        </div>
      </div>
    </div>
  );
}

function GraphMeetingModal({ meeting: m, onClose }) {
  const rows = [
    ['Employee', m.employeeName],
    ['Team', m.team],
    ['Organizer', m.organizerEmail || '—'],
    ['Scheduled start', fmtIst(m.scheduledStart)],
    ['Scheduled end', fmtIst(m.scheduledEnd)],
    ['Joined at', fmtIst(m.joinedAt)],
    ['Left at', fmtIst(m.leftAt)],
    ['Delay vs. scheduled start', m.timingStatus === 'Did Not Join' ? '—' : fmtDelay(m.delaySeconds)],
    ['Attendance duration', fmtDuration(m.attendanceSeconds)],
    ['Call record matched', m.callRecordId || 'Not yet — no callRecords notification received for this meeting'],
  ];
  const problems = [...(m.avIssueDetails?.audioProblems || []).map((p) => ({ ...p, kind: 'Audio' })), ...(m.avIssueDetails?.videoProblems || []).map((p) => ({ ...p, kind: 'Video' }))];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{m.subject}</div>
            <div style={{ fontSize: 12, color: '#6E7488', marginTop: 3 }}>{m.employeeName} · {m.timingStatus}</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
                <span style={{ color: '#8A90A8' }}>{k}</span>
                <span style={{ color: '#C7CBDA', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#8A90A8', marginBottom: 8 }}>Audio / video quality</div>
            {m.avIssue == null && (
              <div style={{ fontSize: 12.5, color: '#6E7488', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: 14 }}>No callRecords data matched to this meeting yet.</div>
            )}
            {m.avIssue === false && (
              <div style={{ fontSize: 12.5, color: '#5EEAD4', border: '1px solid rgba(20,184,166,0.3)', background: 'rgba(20,184,166,0.06)', borderRadius: 10, padding: 14 }}>No quality issues detected on this call.</div>
            )}
            {m.avIssue === true && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {problems.map((p, i) => (
                  <div key={i} style={{ border: '1px solid rgba(244,63,94,0.25)', background: 'rgba(244,63,94,0.05)', borderRadius: 10, padding: 12, fontSize: 12 }}>
                    <span style={{ color: '#F87171', fontWeight: 600 }}>{p.kind} issue</span>
                    <span style={{ color: '#A8AEC4' }}> — packet loss {(p.packetLoss * 100).toFixed(1)}%, jitter {p.jitterMs}ms, RTT {p.rttMs}ms</span>
                  </div>
                ))}
                {!problems.length && <div style={{ fontSize: 12.5, color: '#F87171' }}>Flagged, but no per-stream detail was recorded.</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Reports({ employees, responses, week, filter, setFilter }) {
  const [expanded, setExpanded] = useState(null);
  const [emailPreview, setEmailPreview] = useState(false);
  const [toast, setToast] = useState(null);
  const [report15Preview, setReport15Preview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sending15, setSending15] = useState(false);
  const [search, setSearch] = useState('');
  // `filter` here doubles as the Pending/Received/Overdue state tab, set by
  // DashboardClient's go() so Overview's "Weekly progress mail pending NJs"
  // card can land here pre-filtered to Pending.
  const stateFilter = filter;
  const setStateFilter = setFilter;

  const q = search.trim().toLowerCase();
  // Inactive NJs no longer receive the weekly check-in email at all (see
  // syncKoenig/weeklyReportRunner, both already active-only), so they're
  // excluded here unconditionally — no "Include inactives" toggle, unlike
  // every other screen — a Pending/Overdue row for someone who was never
  // even sent an email this week would be misleading, not just noise.
  const filteredResponses = responses
    .filter((r) => r.active !== false)
    .filter((r) => !stateFilter || r.state === stateFilter)
    .filter((r) => !q || r.name.toLowerCase().includes(q));
  const stateTabs = ['Pending', 'Received', 'Overdue'];

  const flashToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const sendNow = async () => {
    if (sending) return;
    if (!window.confirm('Send this week\'s check-in email to every active NJ who hasn\'t received one yet? This sends real email.')) return;
    setSending(true);
    try {
      const res = await fetch('/api/weekly-report/send', { method: 'POST' });
      const json = await res.json();
      flashToast(json.ok ? json.message : `Send failed: ${json.error}`);
    } catch (err) {
      flashToast(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const send15Now = async () => {
    if (sending15) return;
    if (!window.confirm('Send the 15-Day Report (Sales, Trainer, PT Team) now? This sends real email.')) return;
    setSending15(true);
    try {
      const res = await fetch('/api/report15/send', { method: 'POST' });
      const json = await res.json();
      flashToast(json.ok ? json.message : `Send failed: ${json.error}`);
    } catch (err) {
      flashToast(`Send failed: ${err.message}`);
    } finally {
      setSending15(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'relative' }}>
      {toast && (
        <div style={{ position: 'fixed', top: 24, right: 28, zIndex: 60, border: '1px solid rgba(20,184,166,0.4)', background: '#0F2320', color: '#5EEAD4', borderRadius: 10, padding: '10px 16px', fontSize: 13, boxShadow: '0 12px 30px -10px rgba(0,0,0,0.6)' }}>
          {toast}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ border: '1px solid rgba(99,102,241,0.25)', background: 'linear-gradient(150deg,rgba(99,102,241,0.12),transparent)', borderRadius: 16, padding: 22 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 600 }}>Weekly Report</div>
          <div style={{ fontSize: 13, color: '#8A90A8', marginTop: 6, lineHeight: 1.5 }}>Sends 2 progress questions to every active NJ who hasn't received one yet this week ({week}), with a link to submit answers, Cc'd to their manager. Runs automatically daily at 9AM IST, or trigger manually below.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <span onClick={() => setEmailPreview(true)} className="hoverbtn" style={{ border: '1px solid rgba(99,102,241,0.45)', color: '#A5A7FA', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Preview email</span>
            <span onClick={sendNow} className="hoverbtn" style={{ border: '1px solid rgba(255,255,255,0.12)', color: '#C7CBDA', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send now'}</span>
          </div>
        </div>
        <div style={{ border: '1px solid rgba(20,184,166,0.25)', background: 'linear-gradient(150deg,rgba(20,184,166,0.1),transparent)', borderRadius: 16, padding: 22 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 600 }}>15-Day Report</div>
          <div style={{ fontSize: 13, color: '#8A90A8', marginTop: 6, lineHeight: 1.5 }}>Live Worry Index snapshot across Sales, Trainer and PT Team — every active NJ, full parameter breakdown, sent as one email.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <span onClick={() => setReport15Preview(true)} className="hoverbtn" style={{ border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Preview report</span>
            <span onClick={send15Now} className="hoverbtn" style={{ border: '1px solid rgba(255,255,255,0.12)', color: '#C7CBDA', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: sending15 ? 'default' : 'pointer', opacity: sending15 ? 0.6 : 1 }}>{sending15 ? 'Sending…' : 'Send now'}</span>
          </div>
        </div>
      </div>

      {emailPreview && <EmailPreviewModal onClose={() => setEmailPreview(false)} week={week} />}
      {report15Preview && <Report15PreviewModal onClose={() => setReport15Preview(false)} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search by name…"
          style={{ flex: 1, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#E4E6F0', outline: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {stateTabs.map((s) => {
          const on = stateFilter === s;
          return (
            <div key={s} onClick={() => setStateFilter(on ? null : s)} style={{ cursor: 'pointer', border: `1px solid ${on ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.1)'}`, background: on ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)', color: on ? '#FFFFFF' : '#9BA1B8', borderRadius: 999, padding: '8px 16px', fontSize: 13 }}>
              {s}
            </div>
          );
        })}
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '15px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="disp" style={{ fontSize: 15, fontWeight: 600 }}>Weekly response tracker · {week}</span>
          <span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>click a row to read the response →</span>
        </div>
        {!responses.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No weekly report sent yet for {week}.</div>}
        {!!responses.length && !filteredResponses.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No responses match this filter.</div>}
        {filteredResponses.map((r) => {
          const canExpand = r.state === 'Received';
          const open = expanded === r.name;
          const st = r.state === 'Overdue' ? STATUS['PIP Issued'] : r.state === 'Received' ? STATUS['Confirmed'] : STATUS['In Progress'];
          return (
            <div key={r.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className={canExpand ? 'hoverrow' : ''} onClick={() => canExpand && setExpanded(open ? null : r.name)} style={{ display: 'grid', gridTemplateColumns: '1.3fr .8fr .8fr 1fr 1fr', padding: '13px 18px', alignItems: 'center', fontSize: 13, cursor: canExpand ? 'pointer' : 'default' }}>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: '#8A90A8', fontSize: 12 }}>sent {r.sent}</span>
                <span style={{ color: '#8A90A8', fontSize: 12 }}>{r.received}</span>
                <span style={{ justifySelf: 'start', fontSize: 10.5, padding: '4px 9px', borderRadius: 999, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{r.state}</span>
                <span style={{ textAlign: 'right', fontSize: 12, color: '#A8AEC4' }}>AI rating: <span style={{ color: st.color }}>{r.ai}</span>{canExpand && <span style={{ marginLeft: 8, color: '#6E7488' }}>{open ? '▲' : '▼'}</span>}</span>
              </div>
              {open && canExpand && (
                <div style={{ padding: '4px 18px 16px 18px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 10.5, color: '#6366F1', marginBottom: 3 }}>{r.q1}</div>
                    <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.5 }}>{r.a1}</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 10.5, color: '#6366F1', marginBottom: 3 }}>{r.q2}</div>
                    <div style={{ fontSize: 13, color: '#C7CBDA', lineHeight: 1.5 }}>{r.a2}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmailPreviewModal({ onClose, week }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="disp" style={{ fontSize: 17, fontWeight: 600 }}>Weekly report — email preview</span>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15 }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, color: '#6E7488' }}>
            <div><span className="mono">From:</span> samridhi.chugh@koenig-solutions.com</div>
            <div><span className="mono">Cc:</span> [Manager email]</div>
            <div><span className="mono">Subject:</span> Weekly NJ Check-In - [Name]</div>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: 18, background: 'rgba(255,255,255,0.02)', fontSize: 13.5, color: '#C7CBDA', lineHeight: 1.6 }}>
            <p style={{ marginBottom: 12 }}>Hi [Name],</p>
            <p style={{ marginBottom: 12 }}>As part of our regular Check-In, we would like to understand your progress and focus areas for the week.</p>
            <p style={{ marginBottom: 12 }}>Please take a minute to respond to the following two questions. Please click the button below to submit your responses:</p>
            {NJ_QUESTIONS.map((q) => (
              <div key={q.team} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: q.color, marginBottom: 3 }}>{q.team} track</div>
                <div>1. {q.q1}</div>
                <div>2. {q.q2}</div>
              </div>
            ))}
            <p style={{ marginBottom: 12 }}>Your responses will help HR track your progress, understand your current priorities, and identify any support required during your initial months with the organization.</p>
            <p style={{ marginBottom: 12, color: '#F87171', fontWeight: 600 }}>Please note: non-response to this email will lead to a Shoddy by HR.</p>
            <p style={{ marginBottom: 12 }}>Thank you for your time and participation.</p>
            <p>Best regards,<br />EI Dashboard</p>
          </div>
          <div style={{ fontSize: 11.5, color: '#6E7488' }}>Sent per-employee with their own team's questions and a unique submission link, Cc'd to their manager. Runs automatically daily at 9AM IST, or via "Send now" above.</div>
        </div>
      </div>
    </div>
  );
}

function Report15PreviewModal({ onClose }) {
  // Renders /api/report15/preview in an iframe — the exact HTML the real
  // send would email, from the same buildReport15Html() call, so this can
  // never drift from what actually gets sent.
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1220, height: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 'none' }}>
          <span className="disp" style={{ fontSize: 16, fontWeight: 600 }}>15-Day Report — preview</span>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15 }}>×</div>
        </div>
        <iframe src="/api/report15/preview" style={{ flex: 1, border: 'none', background: '#fff' }} title="15-Day Report preview" />
      </div>
    </div>
  );
}

/* ---------- modal ---------- */

function EmployeeModal({ emp, onClose }) {
  const d = decorate(emp);
  const { pending, closeEmployee, openAlertPreview, alertModal } = useEmployeeActions();
  const bandPct = Math.round(Math.max(0, Math.min(1, (emp.score + 12) / 24)) * 100) + '%';
  const weeks = emp.weeks.map((w) => ({ ...w, color: w.state === 'Overdue' ? '#F87171' : w.state === 'Received' ? '#5EEAD4' : '#A5A7FA' }));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '24px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="disp" style={{ fontSize: 23, fontWeight: 600, letterSpacing: '-0.02em' }}>{d.name}</span>
              <span style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 999, background: d.statusBg, color: d.statusColor, border: `1px solid ${d.statusBorder}` }}>{d.status}</span>
            </div>
            <div className="mono" style={{ fontSize: 12, color: '#6E7488', marginTop: 6 }}>{d.id} · {d.team} · manager {d.manager} · day {d.tenure} of 180</div>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15, flex: 'none' }}>×</div>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 22, alignItems: 'start' }}>
            <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 20, background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: 11.5, color: '#8A90A8' }}>Worry Index</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '6px 0 14px' }}><span className="disp" style={{ fontSize: 42, fontWeight: 600, color: d.bandColor, letterSpacing: '-0.03em' }}>{d.scoreStr}</span><span style={{ fontSize: 12.5, color: d.bandColor }}>{d.bandLabel}</span></div>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}><div style={{ height: '100%', width: bandPct, background: d.bandColor, borderRadius: 4 }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5C6178', marginTop: 6 }}><span>−12</span><span>0</span><span>+12</span></div>
              <div style={{ marginTop: 16, fontSize: 12.5, color: '#8A90A8', lineHeight: 1.55 }}>{emp.trendNote}</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: '#5C6178', textTransform: 'uppercase', marginBottom: 10 }}>Signal breakdown — every parameter for {emp.team}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {emp.signalReport.map((s) => {
                  const notSynced = s.status === 'no-data' || s.status === 'not-tracked';
                  return (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: notSynced ? 0.55 : 1 }}>
                      <span style={{ flex: 1, fontSize: 13, color: notSynced ? '#6E7488' : '#FFFFFF', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {s.label}
                        {s.status === 'fired' && s.count > 1 && (
                          <span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>×{s.count}</span>
                        )}
                        {s.status !== 'fired' && (
                          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.06em', color: '#6E7488', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 6px', textTransform: 'uppercase', flex: 'none' }}>
                            {s.status === 'not-tracked' ? 'not tracked' : s.status === 'no-data' ? 'no data traced' : 'no incident'}
                          </span>
                        )}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: '#5C6178' }}>{s.weight}</span>
                      <span style={{ width: 56, textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12.5, fontWeight: 600, color: s.status === 'fired' ? (s.pts < 0 ? '#F87171' : '#5EEAD4') : notSynced ? '#5C6178' : '#FFFFFF' }}>{s.status === 'fired' ? s.ptsStr : s.status === 'clear' ? '0' : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 18, background: 'rgba(255,255,255,0.02)' }}>
              <div className="disp" style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Weekly progress emails</div>
              {weeks.map((w) => (
                <div key={w.week} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
                  <span className="mono" style={{ color: '#8A90A8' }}>{w.week}</span>
                  <span style={{ color: w.color }}>{w.state}</span>
                </div>
              ))}
            </div>
            <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 18, background: 'rgba(255,255,255,0.02)', maxHeight: 260, overflow: 'auto' }}>
              <div className="disp" style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Manager feedback</div>
              {(emp.mgrFeedbackDetails || []).map((f, i) => {
                const rating = feedbackRating(f);
                const ratingColor = rating === 'below' ? '#F87171' : rating === 'good' ? '#5EEAD4' : '#6E7488';
                return (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', borderLeft: rating ? `2px solid ${ratingColor}` : undefined, paddingLeft: rating ? 8 : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span className="mono" style={{ color: '#8A90A8' }}>{f.date || '—'}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {rating && <span className="mono" style={{ fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', color: ratingColor }}>{rating === 'below' ? 'Below satisfactory' : 'Satisfactory'}</span>}
                      <span style={{ color: '#6E7488' }}>{f.managerName || '—'}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#8A90A8', marginTop: 4, lineHeight: 1.45 }}>{f.strength || f.improvement || f.other || 'No text recorded for this entry.'}</div>
                </div>
                );
              })}
              {!(emp.mgrFeedbackDetails || []).length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No manager feedback on file.</div>}
            </div>
          </div>
          {d.team === 'Sales' && (
            <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 18, background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="disp" style={{ fontSize: 14, fontWeight: 600 }}>Emails sent outside Koenig domain</div>
                <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: '#A5A7FA' }}>{emp.externalEmailCount ?? '—'}</span>
              </div>
              {(emp.externalEmailDetails || []).length ? (
                <div style={{ maxHeight: 220, overflow: 'auto' }}>
                  {emp.externalEmailDetails.map((r) => (
                    <div key={r.address} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
                      <span style={{ color: '#A8AEC4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</span>
                      <span className="mono" style={{ color: '#6E7488', flex: 'none' }}>{r.count}× · last {new Date(r.lastSentAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: '#6E7488' }}>{emp.externalEmailCount == null ? 'Not synced yet.' : 'No external emails in this window.'}</div>
              )}
            </div>
          )}
          <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 18, background: 'rgba(255,255,255,0.02)' }}>
            <div className="disp" style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>HR notes</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#A8AEC4', lineHeight: 1.55, background: 'rgba(0,0,0,0.2)' }}>{emp.hrNote}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              {d.bandLabel === 'Critical' && !d.inactive && (
                <span onClick={() => openAlertPreview(d, { onDone: onClose })} style={{ border: '1px solid rgba(245,158,11,0.45)', color: '#F59E0B', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>
                  Send feedback alert
                </span>
              )}
              <span style={{ border: '1px solid rgba(244,63,94,0.45)', color: '#F87171', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Issue PIP</span>
              {!d.inactive && (d.status === 'Confirmed'
                ? <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#6E7488', borderRadius: 8, padding: '7px 13px', fontSize: 12.5 }}>Closed</span>
                : <span onClick={() => closeEmployee(d, { onDone: onClose })} style={{ border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: pending === `close:${d.id}` ? 'default' : 'pointer', opacity: pending === `close:${d.id}` ? 0.6 : 1 }}>
                    {pending === `close:${d.id}` ? 'Closing…' : 'Mark closed'}
                  </span>)}
            </div>
          </div>
        </div>
      </div>
      {alertModal}
    </div>
  );
}
