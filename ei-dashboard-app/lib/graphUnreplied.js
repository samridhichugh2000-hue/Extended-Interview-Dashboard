import { graphFetch } from './graphAuth.js';
import { isExcludedMeeting } from './meetingFilters.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const UNREPLIED_LOOKBACK_DAYS = Number(process.env.UNREPLIED_LOOKBACK_DAYS || 14);
// A mail only counts as "not responded" once 7 full calendar days have passed
// without a reply (weekends included — plain elapsed time, no business-day
// math). The lookback must exceed this, so with 14 days the window is mail
// received 7-14 days ago that is now overdue.
export const UNREPLIED_GRACE_HOURS = Number(process.env.UNREPLIED_GRACE_HOURS || 168);

async function* pages(url) {
  while (url) {
    const res = await graphFetch(url);
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
const SYSTEM_SUBJECT_RE = /verification code|one[-\s]?time (pass)?code|\botp\b|^classroom:/i;
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

// Threads in `email`'s Inbox (last UNREPLIED_LOOKBACK_DAYS days, older than
// the grace period) that were addressed to them directly and that they have
// not replied to. A thread counts as replied once any item in their Sent
// Items shares its conversationId and was sent after the latest eligible
// inbound message. Nothing is stored — callers keep only the counts.
export async function getUnrepliedThreads(email, { days = UNREPLIED_LOOKBACK_DAYS, graceHours = UNREPLIED_GRACE_HOURS } = {}) {
  const me = email.toLowerCase();
  const from = new Date(Date.now() - days * 864e5).toISOString();
  const cutoff = Date.now() - graceHours * 36e5;
  const user = `${GRAPH_BASE}/users/${encodeURIComponent(email)}`;

  const sentByConversation = new Map();
  const sentUrl = `${user}/mailFolders/sentitems/messages?` + new URLSearchParams({
    $filter: `sentDateTime ge ${from}`, $select: 'conversationId,sentDateTime', $top: '100',
  });
  for await (const page of pages(sentUrl)) {
    for (const m of page) {
      if (!m.conversationId) continue;
      if (!sentByConversation.has(m.conversationId) || m.sentDateTime > sentByConversation.get(m.conversationId)) {
        sentByConversation.set(m.conversationId, m.sentDateTime);
      }
    }
  }

  // Some inboxes hold 5,000+ messages in the window (80+ sequential pages,
  // past Vercel's 60s limit), so the window is cut into slices read 4 at a
  // time — Graph allows 4 concurrent requests per mailbox.
  const select = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,bodyPreview,webLink,inferenceClassification,internetMessageHeaders';
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

  const latestByConversation = new Map();
  let eligibleMessages = 0;
  {
    for (const m of inboxMessages) {
      if (m.isDraft) continue;
      const sender = (m.from?.emailAddress?.address || '').toLowerCase();
      if (!sender || sender === me) continue;
      if (!(m.toRecipients || []).some((r) => (r.emailAddress?.address || '').toLowerCase() === me)) continue; // CC-only / list mail
      if (isAutomatedOrPromotional(m)) continue;
      eligibleMessages++;
      const key = m.conversationId || m.id;
      const prev = latestByConversation.get(key);
      if (!prev || m.receivedDateTime > prev.receivedDateTime) latestByConversation.set(key, m);
    }
  }

  // Notification streams that slip past the per-message checks. Judged per
  // sender over the whole window: (a) an internal address with no user account
  // behind it is a group/shared mailbox, never a person; (b) a sender with
  // many threads to this person, none ever answered, is a feed; (c) the same
  // template (sender + first three subject words) over and over, never
  // answered, is a notification, e.g. "New Lead from…", "Skill Level Update".
  const bySender = new Map();
  const byTemplate = new Map();
  for (const [key, m] of latestByConversation) {
    const sender = m.from.emailAddress.address.toLowerCase();
    const repliedTo = sentByConversation.has(key) && sentByConversation.get(key) > m.receivedDateTime;
    const s = bySender.get(sender) || { threads: 0, replied: 0 };
    s.threads++; if (repliedTo) s.replied++;
    bySender.set(sender, s);
    const tkey = `${sender}|${templateKey(m.subject)}`;
    const t = byTemplate.get(tkey) || { threads: 0, replied: 0 };
    t.threads++; if (repliedTo) t.replied++;
    byTemplate.set(tkey, t);
  }
  const dropped = new Set();
  for (const [key, m] of latestByConversation) {
    const sender = m.from.emailAddress.address.toLowerCase();
    const s = bySender.get(sender);
    const t = byTemplate.get(`${sender}|${templateKey(m.subject)}`);
    if ((s.threads >= FEED_SENDER_MIN_THREADS && s.replied === 0) || (t.threads >= TEMPLATE_MIN_THREADS && t.replied === 0) || !(await isRealPerson(sender))) dropped.add(key);
  }
  for (const key of dropped) latestByConversation.delete(key);

  const unreplied = [];
  for (const [key, m] of latestByConversation) {
    const replied = sentByConversation.get(key);
    if (replied && replied > m.receivedDateTime) continue;
    if (new Date(m.receivedDateTime).getTime() > cutoff) continue;
    unreplied.push({
      id: m.id,
      subject: m.subject || '(no subject)',
      fromName: m.from?.emailAddress?.name || null,
      fromAddress: m.from?.emailAddress?.address || null,
      to: (m.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean),
      cc: (m.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean),
      receivedDateTime: m.receivedDateTime,
      isRead: !!m.isRead,
      preview: m.bodyPreview || '',
      webLink: m.webLink || null,
    });
  }
  unreplied.sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
  return { threadsConsidered: latestByConversation.size, eligibleMessages, unreplied };
}
