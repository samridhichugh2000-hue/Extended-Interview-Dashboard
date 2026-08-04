import { buildReport15Html } from '../../../../lib/report15Runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Renders the exact same HTML the real send would email — single source of
// truth with sendReport15(), unlike the Weekly Report's EmailPreviewModal
// which hand-copies its JSX separately from initialEmailHtml() and can drift.
export async function GET() {
  const { getEmployees } = await import('../../../../lib/queries');
  const employees = await getEmployees();
  const html = await buildReport15Html(employees);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
