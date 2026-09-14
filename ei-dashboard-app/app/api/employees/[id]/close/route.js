import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

// "Close" / "Mark closed" — HR confirms this NJ no longer needs monitoring.
// Sets status to 'Confirmed', the same status the Overview/Dept "Not to be
// Monitored" bucket already keys off of (see lib/data.js decorate() and the
// Dept screen's statusCards). Same-origin only, no secret gate — matches
// every other UI-facing route in this app (weekly-report/send, report15/send).
export async function POST(request, { params }) {
  const { id } = params;
  try {
    const db = getDb();
    const res = await db.execute({ sql: "UPDATE employees SET status = 'Confirmed' WHERE id = ?", args: [id] });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ ok: false, error: `No employee found with id ${id}.` }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
