import { graphFetch } from './graphAuth.js';
import { isExcludedMeeting } from './meetingFilters.js';
import { judgeEmailThread, getCachedVerdicts } from './judgeEmailThread.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const UNREPLIED_LOOKBACK_DAYS = Number(process.env.UNREPLIED_LOOKBACK_DAYS || 30);
// A request only counts as "not responded" once 7 full calendar days have
// passed since it was received/assigned without a meaningful response from the
// employee (weekends included — plain elapsed time, no business-day math). The
// 7 days run from the FIRST request the employee has not answered, so a
// reminder or follow-up never resets them. The lookback must exceed this, so
// with 30 days the window is requests received 7-30 days ago.
export const UNREPLIED_GRACE_HOURS = Number(process.env.UNREPLIED_GRACE_HOURS || 168);

async function* pages(url) {
  while (url) {
    // Graph answers 429/502/503/504 when a big mailbox is slow or the tenant is
    // busy (e.g. during the nightly sync) — a short wait and retry usually clears it.
    let res = await graphFetch(url);
    for (let attempt = 1; attempt <= 3 && [429, 502, 503, 504].includes(res.status); attempt++) {
      const wait = Number(res.headers?.get?.('retry-after')) * 1000 || attempt * 1500;
      await new Promise((r) => setTimeout(r, Math.min(wait, 6000)));
      res = await graphFetch(url);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Graph mail fetch failed: ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    yield json.value || [];
    url = json['@odata.nextLink'] || null;
  }
}

// Sender addresses that are systems, not people.
const AUTOMATED_SENDER_RE = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|microsoftexchange|notifications?|alerts?|newsletters?|marketing|bounces?|automated?|mailer|news|updates?|digest)\b/i;
// Shared/role mailboxes that only broadcast or notify (seen in real inboxes),
// plus this dashboard's own sender (its check-in mails are answered through a
// link, not a reply). Extend with UNREPLIED_EXCLUDED_SENDERS (comma list).
const EXCLUDED_SENDERS = new Set([
  'internal@koenig-solutions.com', 'career@koenig-solutions.com', 'careers@koenig-solutions.com', 'qubits@koenig-solutions.com',
  (process.env.GRAPH_SENDER_EMAIL || '').toLowerCase(),
  ...(process.env.UNREPLIED_EXCLUDED_SENDERS || '').toLowerCase().split(',').map((x) => x.trim()),
].filter(Boolean));
// System notices that carry no ask: OTP codes and the ILO / Classroom / Course
// Advice / tech call assignment mails (same exclusions as the meetings view).
const SYSTEM_SUBJECT_RE = /verification code|one[-\s]?time (pass)?code|\botp\b|^classroom:|\bRMS\b|employee identification|health declaration|action required/i;
// To+Cc this large is a broadcast, not a message to answer.
const MASS_RECIPIENT_THRESHOLD = 10;

// Subjects that are delivery/calendar plumbing, not something to answer.
const AUTOMATED_SUBJECT_RE = /^(undeliverable|delivery status notification|automatic reply|out of office|read:|accepted:|declined:|tentative:|canceled:|cancelled:|invitation:|updated invitation:|new time proposed:)/i;

function header(msg, name) {
  const h = (msg.internetMessageHeaders || []).find((x) => x.name?.toLowerCase() === name);
  return h ? String(h.value || '') : null;
}

// Advertising, newsletters and system mail: bulk-mail headers (what every
// mailing-list/marketing platform sets), a "noreply"-style sender, delivery
// or calendar-response subjects, or Outlook's own "Other" (non-Focused) tab.
export function isAutomatedOrPromotional(msg) {
  // Meeting invitations, updates, cancellations and accept/decline replies are
  // calendar traffic (answered with Accept/Decline, not an email reply).
  if (msg.meetingMessageType && msg.meetingMessageType !== 'none') return true;
  if (header(msg, 'list-unsubscribe') !== null || header(msg, 'list-id') !== null) return true;
  if (/^(bulk|list|junk)$/i.test((header(msg, 'precedence') || '').trim())) return true;
  const autoSubmitted = header(msg, 'auto-submitted');
  if (autoSubmitted !== null && autoSubmitted.trim().toLowerCase() !== 'no') return true;
  if (header(msg, 'x-auto-response-suppress') !== null) return true;
  const sender = msg.from?.emailAddress?.address || '';
  if (EXCLUDED_SENDERS.has(sender.toLowerCase())) return true;
  if (SYSTEM_SUBJECT_RE.test(msg.subject || '') || isExcludedMeeting(msg.subject)) return true;
  if ((msg.toRecipients || []).length + (msg.ccRecipients || []).length >= MASS_RECIPIENT_THRESHOLD) return true;
  if (AUTOMATED_SENDER_RE.test(sender.split('@')[0])) return true;
  if (AUTOMATED_SUBJECT_RE.test((msg.subject || '').trim())) return true;
  if (msg.inferenceClassification === 'other') return true;
  return false;
}

const INBOX_SLICES = 8;
const INBOX_PARALLEL = 4;
const FEED_SENDER_MIN_THREADS = 6;
const TEMPLATE_MIN_THREADS = 4;

// First three words of the subject, reply/forward prefixes and digits
// stripped — "New Lead from Kashi- India- 10/3" and "New Lead from Shrey…"
// share one key.
function templateKey(subject) {
  return (subject || '').toLowerCase().replace(/^((re|fw|fwd):\s*)+/, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
}

// A koenig-solutions.com address with no Entra user behind it (404) is a
// group, alias or shared mailbox (leadallocation@, sms@, ap@, rms@…), not a
// person writing to you. External senders and lookup errors count as people
// so a throttled lookup never hides real mail. Cached for the process.
const personCache = new Map();
function isRealPerson(address) {
  if (!address.endsWith('@koenig-solutions.com')) return Promise.resolve(true);
  if (!personCache.has(address)) {
    personCache.set(address, graphFetch(`${GRAPH_BASE}/users/${encodeURIComponent(address)}?$select=id`)
      .then((res) => res.status !== 404)
      .catch(() => true));
  }
  return personCache.get(address);
}


const JUDGE_PARALLEL = 3;
const MAX_THREAD_MESSAGES = 10;

// Newest part of a message only: the plain-text body cut at the first quoted
// reply header ("From: … Sent: …", "On … wrote:", "-----Original Message-----").
function latestPart(body, max) {
  const text = body || '';
  const cut = text.search(/\r?\n\s*(From:\s.+|On .{5,120} wrote:|-{3,}\s*Original Message\s*-{3,})/i);
  return (cut > 40 ? text.slice(0, cut) : text).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Every message of one conversation in this mailbox (Inbox, Sent Items and any
// other folder), oldest first, as a plain-text transcript for the judge.
async function buildTranscript(user, me, conversationId, clockMessageId) {
  const url = `${user}/messages?` + new URLSearchParams({
    $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
    $select: 'id,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,isDraft,body,subject',
    $top: '50',
  });
  const headers = { Prefer: 'outlook.body-content-type="text"' };
  const msgs = [];
  let res = await graphFetch(url, { headers });
  for (let attempt = 1; attempt <= 3 && [429, 502, 503, 504].includes(res.status); attempt++) {
    await new Promise((r) => setTimeout(r, attempt * 1500));
    res = await graphFetch(url, { headers });
  }
  if (!res.ok) { const err = new Error(`thread fetch failed: ${res.status}`); err.status = res.status; throw err; }
  let json = await res.json();
  msgs.push(...(json.value || []));
  while (json['@odata.nextLink'] && msgs.length < 100) {
    const r = await graphFetch(json['@odata.nextLink'], { headers });
    if (!r.ok) break;
    json = await r.json();
    msgs.push(...(json.value || []));
  }
  const live = msgs.filter((m) => !m.isDraft).sort((a, b) => (a.sentDateTime || a.receivedDateTime || '').localeCompare(b.sentDateTime || b.receivedDateTime || ''));
  // Keep the newest messages, but never drop the request that starts the clock.
  let kept = live.slice(-MAX_THREAD_MESSAGES);
  const clockMsg = live.find((m) => m.id === clockMessageId);
  if (clockMsg && !kept.includes(clockMsg)) kept = [clockMsg, ...kept.slice(1)];
  return kept.map((m) => {
    const sender = (m.from?.emailAddress?.address || '').toLowerCase();
    const dir = sender === me ? 'SENT BY EMPLOYEE' : 'RECEIVED';
    const addrs = (list) => (list || []).map((r) => r.emailAddress?.address).filter(Boolean).join(', ') || '-';
    const mark = m.id === clockMessageId ? '  [REQUEST CLOCK STARTS HERE]' : '';
    return `--- ${dir} | ${(m.sentDateTime || m.receivedDateTime || '').slice(0, 16).replace('T', ' ')} UTC | From: ${m.from?.emailAddress?.name || sender} <${sender}> | To: ${addrs(m.toRecipients)} | Cc: ${addrs(m.ccRecipients)}${mark}\n${latestPart(m.body?.content, m.id === clockMessageId ? 1800 : 1100)}`;
  }).join('\n\n');
}

// Request-level check of `email`'s mailbox (last UNREPLIED_LOOKBACK_DAYS days).
//   1. Candidates: mail addressed to them directly (To, not Cc / not a list they
//      merely belong to — so hunt-group mail is never assigned to a person
//      automatically), minus automated / promotional / system mail.
//   2. Per conversation, the 7-day clock starts at the FIRST such request after
//      their last sent message in that conversation. Reminders don't reset it,
//      and a conversation they have since replied to has no open request.
//   3. Each conversation whose open request is more than 7 days old is judged
//      on its WHOLE thread (received + sent) by judgeEmailThread: unanswered /
//      answered / not_actionable / needs_review. Only "unanswered" is counted;
//      "needs_review" is listed separately and never counted. Nothing is stored
//      except subject/sender/date/verdict — callers keep only the counts.
export async function getUnrepliedThreads(email, { days = UNREPLIED_LOOKBACK_DAYS, graceHours = UNREPLIED_GRACE_HOURS, employee = null } = {}) {
  const me = email.toLowerCase();
  const from = new Date(Date.now() - days * 864e5).toISOString();
  const cutoff = Date.now() - graceHours * 36e5;
  const user = `${GRAPH_BASE}/users/${encodeURIComponent(email)}`;
  const emp = employee || { id: me, name: email.split('@')[0], email };

  const sentByConversation = new Map();
  const sentUrl = `${user}/mailFolders/sentitems/messages?` + new URLSearchParams({
    $filter: `sentDateTime ge ${from}`, $select: 'conversationId,sentDateTime,subject,toRecipients,ccRecipients', $top: '100',
  });
  // Every sent item (when, subject, who to): a reply written as a NEW email to
  // the same person — not in the original conversation — still counts as a
  // response, so the judge is shown those too.
  const sentItems = [];
  for await (const page of pages(sentUrl)) {
    for (const m of page) {
      sentItems.push({
        conv: m.conversationId, at: m.sentDateTime, subject: m.subject || '(no subject)',
        to: new Set([...(m.toRecipients || []), ...(m.ccRecipients || [])].map((r) => (r.emailAddress?.address || '').toLowerCase())),
      });
      if (!m.conversationId) continue;
      if (!sentByConversation.has(m.conversationId) || m.sentDateTime > sentByConversation.get(m.conversationId)) {
        sentByConversation.set(m.conversationId, m.sentDateTime);
      }
    }
  }

  // Some inboxes hold 5,000+ messages in the window (80+ sequential pages,
  // past Vercel's 60s limit), so the window is cut into slices read 4 at a
  // time — Graph allows 4 concurrent requests per mailbox.
  const select = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,bodyPreview,webLink,inferenceClassification,internetMessageHeaders,microsoft.graph.eventMessage/meetingMessageType';
  const startMs = Date.parse(from), endMs = Date.now() + 1000;
  const slices = Array.from({ length: INBOX_SLICES }, (_, i) => [
    new Date(startMs + ((endMs - startMs) * i) / INBOX_SLICES).toISOString(),
    new Date(startMs + ((endMs - startMs) * (i + 1)) / INBOX_SLICES).toISOString(),
  ]);
  const inboxMessages = [];
  let nextSlice = 0;
  await Promise.all(Array.from({ length: INBOX_PARALLEL }, async () => {
    while (nextSlice < slices.length) {
      const [a, b] = slices[nextSlice++];
      const url = `${user}/mailFolders/inbox/messages?` + new URLSearchParams({
        $filter: `receivedDateTime ge ${a} and receivedDateTime lt ${b}`, $select: select, $top: '100',
      });
      for await (const page of pages(url)) inboxMessages.push(...page);
    }
  }));

  // Eligible inbound requests per conversation, oldest first.
  const inboundByConversation = new Map();
  let eligibleMessages = 0;
  for (const m of inboxMessages) {
    if (m.isDraft) continue;
    const sender = (m.from?.emailAddress?.address || '').toLowerCase();
    if (!sender || sender === me) continue;
    if (!(m.toRecipients || []).some((r) => (r.emailAddress?.address || '').toLowerCase() === me)) continue; // CC-only / list mail
    if (isAutomatedOrPromotional(m)) continue;
    eligibleMessages++;
    const key = m.conversationId || m.id;
    if (!inboundByConversation.has(key)) inboundByConversation.set(key, []);
    inboundByConversation.get(key).push(m);
  }

  // One entry per conversation: its open request (the first message after the
  // employee's last sent one), or none if they have answered everything.
  const conversations = [];
  for (const [key, msgs] of inboundByConversation) {
    msgs.sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
    const lastSent = sentByConversation.get(key) || null;
    const open = msgs.filter((m) => !lastSent || m.receivedDateTime > lastSent);
    conversations.push({
      key, lastSent, latest: msgs[msgs.length - 1], request: open[0] || null,
      sender: (open[0] || msgs[0]).from.emailAddress.address.toLowerCase(),
    });
  }

  // Notification streams that slip past the per-message checks: a sender with
  // many threads to this person, none ever answered, or the same template
  // (sender + first three subject words) over and over, never answered. These
  // are not dropped blindly — a manager could send six unanswered tasks too —
  // one representative is judged and the verdict decides for the whole stream.
  const bySender = new Map();
  const byTemplate = new Map();
  for (const c of conversations) {
    const answered = !c.request;
    const s = bySender.get(c.sender) || { threads: 0, replied: 0 }; s.threads++; if (answered) s.replied++; bySender.set(c.sender, s);
    const tkey = `${c.sender}|${templateKey(c.request?.subject || c.latest.subject)}`;
    const t = byTemplate.get(tkey) || { threads: 0, replied: 0 }; t.threads++; if (answered) t.replied++; byTemplate.set(tkey, t);
    c.tkey = tkey;
  }
  for (const c of conversations) {
    const s = bySender.get(c.sender), t = byTemplate.get(c.tkey);
    c.streamKey = (t.threads >= TEMPLATE_MIN_THREADS && t.replied === 0) ? c.tkey : (s.threads >= FEED_SENDER_MIN_THREADS && s.replied === 0) ? `sender|${c.sender}` : null;
  }

  const due = conversations.filter((c) => c.request && new Date(c.request.receivedDateTime).getTime() <= cutoff);
  const cached = await getCachedVerdicts(emp.id);
  // Mail the employee sent to the request's sender after it arrived, outside
  // this conversation (a reply typed as a fresh email).
  const otherSentTo = (c) => sentItems.filter((s) => s.conv !== c.key && s.at > c.request.receivedDateTime && s.to.has(c.sender)).sort((a, b) => a.at.localeCompare(b.at)).slice(-6);
  const threadKey = (c) => `${c.latest.id}|${c.lastSent || ''}|${otherSentTo(c).length}`;
  const unreadable = { verdict: 'needs_review', reason: 'Conversation could not be read — check manually', failed: true };

  async function judge(c) {
    const hit = cached.get(c.key);
    if (hit && hit.lastMessageId === threadKey(c)) return { verdict: hit.verdict, reason: hit.reason };
    let thread;
    try { thread = await buildTranscript(user, me, c.key, c.request.id); } catch { return unreadable; }
    if (!thread) return unreadable;
    const requestFrom = c.request.from.emailAddress.name ? `${c.request.from.emailAddress.name} <${c.sender}>` : c.sender;
    const sharedSender = !(await isRealPerson(c.sender));
    // Reminder / notification mail from a group or system mailbox (e.g. "Reminder:
    // interview starts in 15 minutes") announces an event, it does not ask for a reply.
    if (sharedSender && /^(reminder|notification|alert|notice)\b/i.test((c.request.subject || '').trim())) return { verdict: 'not_actionable', reason: 'System reminder / notification from a group mailbox' };
    const otherSent = otherSentTo(c).map((s) => `${s.at.slice(0, 16).replace('T', ' ')} UTC — "${s.subject}"`).join('\n');
    return judgeEmailThread({ employee: emp, conversationId: c.key, lastMessageId: threadKey(c), requestFrom, sharedSender, thread, otherSent });
  }
  const runPool = async (items, fn) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(JUDGE_PARALLEL, items.length) }, async () => { while (next < items.length) { await fn(items[next++]); } }));
  };

  // Streams: judge the newest member; carry on with the rest only if it is real.
  const streams = new Map();
  for (const c of due) if (c.streamKey) { if (!streams.has(c.streamKey)) streams.set(c.streamKey, []); streams.get(c.streamKey).push(c); }
  await runPool([...streams.values()], async (members) => {
    members.sort((a, b) => b.request.receivedDateTime.localeCompare(a.request.receivedDateTime));
    const rep = members[0];
    rep.result = await judge(rep);
    if (rep.result.verdict === 'not_actionable' || rep.result.verdict === 'answered') {
      for (const c of members.slice(1)) c.result = { verdict: 'not_actionable', reason: `Notification stream — ${rep.result.reason}` };
    }
  });
  await runPool(due.filter((c) => !c.result), async (c) => { c.result = await judge(c); });

  const toItem = (c) => ({
    id: c.request.id,
    subject: c.request.subject || '(no subject)',
    fromName: c.request.from?.emailAddress?.name || null,
    fromAddress: c.request.from?.emailAddress?.address || null,
    to: (c.request.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean),
    cc: (c.request.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean),
    receivedDateTime: c.request.receivedDateTime, // when the open request arrived — the 7-day clock
    isRead: !!c.request.isRead,
    preview: c.request.bodyPreview || '',
    webLink: c.request.webLink || null,
    category: c.result.verdict,
    categoryReason: c.result.reason,
  });
  const items = due.filter((c) => c.result).map(toItem).sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
  return {
    threadsConsidered: conversations.length,
    eligibleMessages,
    judgeFailures: due.filter((c) => c.result?.failed).length,
    unreplied: items.filter((m) => m.category === 'unanswered'),
    needsReview: items.filter((m) => m.category === 'needs_review'),
    notNeeded: items.filter((m) => m.category === 'answered' || m.category === 'not_actionable'),
  };
}
