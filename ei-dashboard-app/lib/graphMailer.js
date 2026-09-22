import { graphFetch } from './graphAuth.js';

const SENDER_EMAIL = process.env.GRAPH_SENDER_EMAIL;
const INTERNAL_DOMAIN = 'koenig-solutions.com';

function isExternalAddress(address) {
  const at = address.lastIndexOf('@');
  return at !== -1 && address.slice(at + 1).toLowerCase() !== INTERNAL_DOMAIN;
}

// Walks `email`'s Sent Items between fromIso/toIso (either may be omitted —
// Graph accepts a $filter with just one bound), collecting every
// non-@koenig-solutions.com address across to/cc/bcc. Graph does return
// bccRecipients on the sender's own Sent Items copy, unlike a recipient's
// view of the same message, so it's safe to include here. Aggregates a
// count + last-sent date per external address rather than per message,
// since the same message can carry the same external address in both
// to and cc — that counts once. `daily` uses the same per-message-per-
// address dedup, keyed by the message's sent date (YYYY-MM-DD, UTC), so
// summing it over the whole window always equals the address totals.
export async function getSentExternalSummary(email, fromIso, toIso) {
  const filters = [];
  if (fromIso) filters.push(`sentDateTime ge ${fromIso}`);
  if (toIso) filters.push(`sentDateTime le ${toIso}`);

  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/mailFolders/sentitems/messages?` + new URLSearchParams({
    $select: 'toRecipients,ccRecipients,bccRecipients,sentDateTime',
    $top: '100',
    ...(filters.length ? { $filter: filters.join(' and ') } : {}),
  });

  const byAddress = new Map();
  const byDay = new Map();
  while (url) {
    const res = await graphFetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Graph sentItems fetch failed: ${res.status} ${text}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    for (const msg of json.value || []) {
      const recipients = [...(msg.toRecipients || []), ...(msg.ccRecipients || []), ...(msg.bccRecipients || [])];
      const seenInThisMessage = new Set();
      for (const r of recipients) {
        const address = r.emailAddress?.address?.toLowerCase();
        if (!address || !isExternalAddress(address) || seenInThisMessage.has(address)) continue;
        seenInThisMessage.add(address);
        const entry = byAddress.get(address) || { address, count: 0, lastSentAt: null };
        entry.count += 1;
        if (!entry.lastSentAt || msg.sentDateTime > entry.lastSentAt) entry.lastSentAt = msg.sentDateTime;
        byAddress.set(address, entry);
        const day = msg.sentDateTime.slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + 1);
      }
    }
    url = json['@odata.nextLink'] || null;
  }

  return { recipients: [...byAddress.values()].sort((a, b) => b.count - a.count), daily: byDay };
}

// Sends as SENDER_EMAIL's mailbox via application permissions (Mail.Send),
// unless `from` overrides it — the app-only Mail.Send grant covers every
// mailbox in the tenant, not just SENDER_EMAIL, so callers that need a
// specific "From" (e.g. PA/PIP alerts sent as HR@koenig-solutions.com
// rather than the default sender) can pass it per call.
// `to`/`cc` may be a single address or an array. `attachments`, if given, is
// [{ name, contentType, content }] with `content` already base64-encoded —
// Graph's fileAttachment shape wants base64 in contentBytes directly.
export async function sendMail({ to, cc, subject, html, attachments, from }) {
  const mailbox = from || SENDER_EMAIL;
  const toList = (Array.isArray(to) ? to : [to]).map((address) => ({ emailAddress: { address } }));
  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).map((address) => ({ emailAddress: { address } })) : [];
  const attachmentList = (attachments || []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: a.content,
  }));

  const res = await graphFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: toList,
        ccRecipients: ccList,
        attachments: attachmentList,
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}
