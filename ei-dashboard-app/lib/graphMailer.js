import { graphFetch } from './graphAuth.js';

const SENDER_EMAIL = process.env.GRAPH_SENDER_EMAIL;

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
