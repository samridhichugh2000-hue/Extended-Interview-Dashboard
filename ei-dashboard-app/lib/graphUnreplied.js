import { graphFetch } from './graphAuth.js';
import { isExcludedMeeting } from './meetingFilters.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const UNREPLIED_LOOKBACK_DAYS = Number(process.env.UNREPLIED_LOOKBACK_DAYS || 21);
// A mail only counts as "not responded" once 7 full calendar days have passed
// without a reply (weekends included — plain elapsed time, no business-day
// math). The lookback must exceed this, so the window is the 14 days of mail
// that is now overdue.
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

  const inboxUrl = `${user}/mailFolders/inbox/messages?` + new URLSearchParams({
    $filter: `receivedDateTime ge ${from}`,
    $select: 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,bodyPreview,webLink,inferenceClassification,internetMessageHeaders',
    $top: '100',
  });
  const latestByConversation = new Map();
  let eligibleMessages = 0;
  for await (const page of pages(inboxUrl)) {
    for (const m of page) {
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
