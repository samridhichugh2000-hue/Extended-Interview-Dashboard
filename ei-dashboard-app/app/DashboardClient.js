'use client';
import { useState } from 'react';
import {
  STATUS, decorate, NAV, TITLES, PATHS, METRIC_HEADS,
  WORRY_BANDS, POS_SIGNALS, NEG_SIGNALS, NJ_QUESTIONS, appliesToTeam, feedbackRating,
} from '../lib/data';

const card = { border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 16 };

export default function DashboardClient({ employees, responses, week, newJoiners, deptCounts }) {
  const [screen, setScreen] = useState('overview');
  const [dept, setDept] = useState('Sales');
  const [filter, setFilter] = useState(null);
  const [modal, setModal] = useState(null);

  const go = (s, d) => { setScreen(s); if (d) setDept(d); setFilter(null); };

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <Sidebar screen={screen} dept={dept} go={go} njCount={newJoiners.length} deptCounts={deptCounts} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar screen={screen} dept={dept} />
        <div style={{ padding: '26px 28px 60px', flex: 1 }}>
          {screen === 'overview' && <Overview employees={employees} newJoiners={newJoiners} deptCounts={deptCounts} go={go} setModal={setModal} />}
          {screen === 'dept' && <Dept key={dept} employees={employees} dept={dept} filter={filter} setFilter={setFilter} setModal={setModal} />}
          {screen === 'papip' && <PaPip employees={employees} filter={filter} setFilter={setFilter} setModal={setModal} />}
          {screen === 'worryindex' && <WorryIndex employees={employees} filter={filter} setFilter={setFilter} setModal={setModal} />}
          {screen === 'reports' && <Reports employees={employees} responses={responses} week={week} />}
        </div>
      </div>
      {modal && <EmployeeModal emp={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ---------- app chrome ---------- */

function Sidebar({ screen, dept, go, njCount, deptCounts }) {
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
          const count = n.screen === 'overview' ? njCount : n.dept && deptCounts[n.dept] !== undefined ? deptCounts[n.dept] : n.count;
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
        <div style={{ border: '1px solid rgba(245,158,11,0.25)', background: 'linear-gradient(150deg,rgba(245,158,11,0.13),rgba(245,158,11,0.02))', borderRadius: 16, padding: 20, animation: 'floatcard 6s ease-in-out infinite 1.2s' }}>
          <div style={{ fontSize: 12, color: '#A8AEC4' }}>Feedback Pending</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '8px 0 4px' }}><span className="disp" style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.03em' }}>9</span><span style={{ fontSize: 11.5, color: '#6E7488' }}>managers overdue</span></div>
          <div style={{ marginTop: 12, border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B', borderRadius: 8, padding: '7px 12px', fontSize: 12, textAlign: 'center', cursor: 'pointer' }}>Send reminder to all</div>
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
  const deptEmp = employees.filter((e) => e.team === dept);
  const pool = deptEmp.length ? deptEmp : employees;
  // Not to be Monitored / Under Watch is a status call, not a score call —
  // the weekly Worry Index score fluctuates, but an NJ stays under watch
  // until HR explicitly confirms them (status 'Confirmed', the "Mark
  // closed" action). Every other status (In Progress, PA Issued, PIP
  // Issued) counts as still under watch. Exited employees aren't monitored
  // either way, so both buckets — and Total — are active-only, and the two
  // buckets always add up to Total exactly.
  const activeDeptEmp = deptEmp.filter((e) => e.active !== false);
  const statusFiltered = filter === 'Confirmed' ? pool.filter((e) => e.active !== false && e.status === 'Confirmed')
    : filter === 'UnderWatch' ? pool.filter((e) => e.active !== false && e.status !== 'Confirmed')
    : pool;
  const q = search.trim().toLowerCase();
  const filtered = q ? statusFiltered.filter((e) => e.name.toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q)) : statusFiltered;
  const statusCards = [
    { label: 'Total', count: activeDeptEmp.length, color: '#A855F7', filterVal: null, isTotal: true },
    { label: 'Not to be Monitored', count: activeDeptEmp.filter((e) => e.status === 'Confirmed').length, color: '#14B8A6', filterVal: 'Confirmed' },
    { label: 'Under Watch', count: activeDeptEmp.filter((e) => e.status !== 'Confirmed').length, color: '#8B8CF6', filterVal: 'UnderWatch' },
  ].map((s) => ({ ...s, active: s.isTotal ? !filter : filter === s.filterVal }));
  const baseHeads = METRIC_HEADS[dept] || METRIC_HEADS.Sales;
  const mh = dept === 'Sales' ? [...baseHeads, 'Neg. Audits', 'SCs Raised', 'Tech Calls', 'Shoddy Log', 'Mgr Feedback', 'Polls']
    : dept === 'Trainer' ? [...baseHeads, 'Exams', 'Neg. Feedback', 'Assignments', 'Skills', 'In-House Skills', 'Tech Calls', 'TBTs', 'Shoddy Log', 'Mgr Feedback', 'Polls']
    : [...baseHeads, 'Shoddy Log', 'Mgr Feedback', 'Polls'];
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
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#8A90A8' }}>DOJ: 01 Feb 2026 → 27 Jul 2026</div>
        <div onClick={() => setFilter(null)} style={{ border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#A5A7FA', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>
          {filter ? `Filter: ${filter === 'Confirmed' ? 'Not to be Monitored' : filter === 'UnderWatch' ? 'Under Watch' : filter} ×` : 'No filter applied'}
        </div>
      </div>

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
              <span style={{ fontSize: 10.5, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 7, padding: '4px 8px' }}>{e.alert}</span>
              <span style={{ fontSize: 10.5, color: '#8A90A8', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '4px 8px' }}>Close</span>
            </div>
          </div>
        ))}
        {!rows.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No employees match this filter.</div>}
      </div>
      {auditModal && <AuditRemarksModal emp={auditModal} onClose={() => setAuditModal(null)} />}
      {scModal && <ScListModal emp={scModal} onClose={() => setScModal(null)} />}
      {techCallsModal && <TechCallsModal emp={techCallsModal} onClose={() => setTechCallsModal(null)} />}
      {techCallsConvModal && <TechCallsConvertedModal emp={techCallsConvModal} onClose={() => setTechCallsConvModal(null)} />}
      {tbtModal && <TbtModal emp={tbtModal} onClose={() => setTbtModal(null)} />}
      {shoddyModal && <ShoddyModal emp={shoddyModal} onClose={() => setShoddyModal(null)} />}
      {mgrFeedbackModal && <MgrFeedbackModal emp={mgrFeedbackModal} onClose={() => setMgrFeedbackModal(null)} />}
      {pollsModal && <PollsModal emp={pollsModal} onClose={() => setPollsModal(null)} />}
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
  const tabs = [['All Departments', 6, null], ['Sales', 3, 'Sales'], ['Trainer', 2, 'Trainer'], ['PT Team', 1, 'PT Team']].map(([label, count, d]) => ({
    label, count, val: d, active: filter === d || (!filter && !d),
  }));
  const rows = employees.filter((e) => e.status !== 'In Progress').filter((e) => !filter || e.team === filter).map(decorate);

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
      </div>
    </div>
  );
}

function WorryIndex({ employees, filter, setFilter, setModal }) {
  const active = employees.map(decorate).filter((e) => !e.inactive);
  const tabs = [['All Departments', null], ['Sales', 'Sales'], ['Trainer', 'Trainer'], ['PT Team', 'PT Team']].map(([label, val]) => ({
    label, val, active: filter === val || (!filter && !val),
    count: val ? active.filter((e) => e.team === val).length : active.length,
  }));
  const ranked = active.filter((e) => !filter || e.team === filter).sort((a, b) => a.score - b.score);
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

function Reports({ employees, responses, week }) {
  const [expanded, setExpanded] = useState(null);
  const [emailPreview, setEmailPreview] = useState(false);
  const [toast, setToast] = useState(null);
  const [report15, setReport15] = useState(null); // dept name or null
  const [sending, setSending] = useState(false);

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
          <div style={{ fontSize: 13, color: '#8A90A8', marginTop: 6, lineHeight: 1.5 }}>Sends 2 progress questions to every active NJ who hasn't received one yet this week ({week}), with a link to submit answers. No automatic schedule yet — trigger manually below.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <span onClick={() => setEmailPreview(true)} className="hoverbtn" style={{ border: '1px solid rgba(99,102,241,0.45)', color: '#A5A7FA', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Preview email</span>
            <span onClick={sendNow} className="hoverbtn" style={{ border: '1px solid rgba(255,255,255,0.12)', color: '#C7CBDA', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send now'}</span>
          </div>
        </div>
        <div style={{ border: '1px solid rgba(20,184,166,0.25)', background: 'linear-gradient(150deg,rgba(20,184,166,0.1),transparent)', borderRadius: 16, padding: 22 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 600 }}>15-Day Report</div>
          <div style={{ fontSize: 13, color: '#8A90A8', marginTop: 6, lineHeight: 1.5 }}>On-demand snapshot per department: status movement, new PA/PIP cases, worry score deltas since last run.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {['Sales', 'Trainer', 'PT Team'].map((d) => (
              <span key={d} onClick={() => setReport15(d)} className="hoverbtn" style={{ border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Generate · {d}</span>
            ))}
          </div>
        </div>
      </div>

      {emailPreview && <EmailPreviewModal onClose={() => setEmailPreview(false)} week={week} />}
      {report15 && <Report15Modal employees={employees} dept={report15} onClose={() => setReport15(null)} />}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '15px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="disp" style={{ fontSize: 15, fontWeight: 600 }}>Weekly response tracker · {week}</span>
          <span className="mono" style={{ fontSize: 10.5, color: '#6E7488' }}>click a row to read the response →</span>
        </div>
        {!responses.length && <div style={{ padding: '18px', fontSize: 12.5, color: '#6E7488' }}>No weekly report sent yet for {week}.</div>}
        {responses.map((r) => {
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
            <p style={{ marginBottom: 12 }}>Thank you for your time and participation.</p>
            <p>Best regards,<br />EI Dashboard</p>
          </div>
          <div style={{ fontSize: 11.5, color: '#6E7488' }}>Sent per-employee with their own team's questions and a unique submission link. This is the {week} template — no automatic schedule yet, sent via "Send now" above.</div>
        </div>
      </div>
    </div>
  );
}

function Report15Modal({ employees, dept, onClose }) {
  // Reports are active-employee-only, and use the same Total / Not to be
  // Monitored / Under Watch definition as the department screens — an NJ is
  // under watch until their status is explicitly 'Confirmed', not based on
  // score. See Dept() in this file for the same rule.
  const emp = employees.filter((e) => e.team === dept && e.active !== false).map(decorate);
  const cards = [
    { label: 'Total', count: emp.length, color: '#A855F7' },
    { label: 'Not to be Monitored', count: emp.filter((e) => e.status === 'Confirmed').length, color: '#14B8A6' },
    { label: 'Under Watch', count: emp.filter((e) => e.status !== 'Confirmed').length, color: '#8B8CF6' },
  ];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 20, background: '#101422', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="disp" style={{ fontSize: 17, fontWeight: 600 }}>15-Day Report — {dept}</span>
          <div onClick={onClose} style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A90A8', fontSize: 15 }}>×</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 12.5, color: '#8A90A8' }}>Snapshot generated for 13 Jul 2026 → 27 Jul 2026.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {cards.map(({ label, count, color }) => (
              <div key={label} style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.025)', borderRadius: 12, padding: '12px 13px' }}>
                <div className="disp" style={{ fontSize: 22, fontWeight: 600, color, letterSpacing: '-0.02em' }}>{count}</div>
                <div style={{ fontSize: 10.5, color: '#A8AEC4', marginTop: 3, lineHeight: 1.3 }}>{label}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: '#5C6178', textTransform: 'uppercase', marginBottom: 10 }}>Worry score movement</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {emp.map((e) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
                  <span>{e.name}</span>
                  <span style={{ fontSize: 12, color: '#8A90A8', flex: 1, textAlign: 'right', marginRight: 12 }}>{e.status}</span>
                  <span className="mono" style={{ fontWeight: 600, color: e.bandColor, width: 50, textAlign: 'right' }}>{e.scoreStr}</span>
                </div>
              ))}
              {!emp.length && <div style={{ fontSize: 12.5, color: '#6E7488' }}>No active employees in this department.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- modal ---------- */

function EmployeeModal({ emp, onClose }) {
  const d = decorate(emp);
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
          <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 18, background: 'rgba(255,255,255,0.02)' }}>
            <div className="disp" style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>HR notes</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#A8AEC4', lineHeight: 1.55, background: 'rgba(0,0,0,0.2)' }}>{emp.hrNote}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={{ border: '1px solid rgba(245,158,11,0.45)', color: '#F59E0B', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Send feedback alert</span>
              <span style={{ border: '1px solid rgba(244,63,94,0.45)', color: '#F87171', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Issue PIP</span>
              <span style={{ border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, cursor: 'pointer' }}>Mark closed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
