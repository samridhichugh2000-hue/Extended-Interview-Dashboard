import { NextResponse } from 'next/server';
import { getEmployeeDetails } from '../../../../../lib/queries';

export const dynamic = 'force-dynamic';

// Full record lists for the popups that the home page only ships trimmed
// date stubs for (see slimEmployeesForClient in lib/queries.js). Behind the
// same Basic Auth gate as the rest of the dashboard (middleware.js).
export async function GET(_request, { params }) {
  const details = await getEmployeeDetails(params.id);
  if (!details) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(details);
}
