// One-off repair of video_meetings.camera_on. The old rule marked the camera ON
// whenever Teams listed a sent-video stream, but people who never turned the
// camera on still have an empty one (no frame rate, codec 'unknown'). The rule is
// now "video frames were actually sent" (see syncVideo); this re-reads the call
// records Microsoft still holds (~30 days) and updates ONLY rows whose flag
// changes. Older rows can't be re-read and are left as they are.
//   node scripts/fix-video-camera.mjs [--dry]
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });
const { getDb } = await import('../lib/db.js');
const { getCallRecordWithSegments } = await import('../lib/graphCallsApi.js');
const dry = process.argv.includes('--dry');
const db = getDb();

const since = new Date(Date.now() - 28 * 86400000).toISOString(); // a day inside Microsoft's retention
const rows = (await db.execute({ sql: 'SELECT id, call_record_id, user_id, camera_on FROM video_meetings WHERE started_at >= ?', args: [since] })).rows;
const byRec = new Map();
for (const r of rows) { if (!byRec.has(r.call_record_id)) byRec.set(r.call_record_id, []); byRec.get(r.call_record_id).push(r); }
const ids = [...byRec.keys()];
console.log(`${rows.length} stored rows in ${ids.length} call records (last 28 days)${dry ? ' — DRY RUN' : ''}`);

const updates = [];
let i = 0, done = 0, unreadable = 0;
const tally = { checked: 0, onToOff: 0, offToOn: 0 };
async function worker() {
  while (i < ids.length) {
    const id = ids[i++];
    let d = null;
    for (let attempt = 1; attempt <= 3 && !d; attempt++) {
      try { d = await getCallRecordWithSegments(id); } catch { await new Promise((r) => setTimeout(r, 1000 * attempt)); }
    }
    if (!d) { unreadable++; continue; } // expired or unreachable — left untouched
    for (const r of byRec.get(id)) {
      let sent = false;
      for (const s of d.sessions || []) {
        if (s.caller?.identity?.user?.id !== r.user_id) continue;
        for (const g of s.segments || []) for (const m of g.media || []) {
          if (!/^main-video/.test(m.label || '')) continue;
          for (const st of m.streams || []) if (/callerToCallee/.test(st.streamDirection || '') && Number(st.averageVideoFrameRate) > 0) sent = true;
        }
      }
      tally.checked++;
      const was = !!r.camera_on;
      if (was !== sent) { updates.push({ id: r.id, cam: sent ? 1 : 0 }); if (was) tally.onToOff++; else tally.offToOn++; }
    }
    if (++done % 500 === 0) console.log(`  ${done}/${ids.length} records read, ${updates.length} changes so far`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`checked ${tally.checked} rows | ON -> OFF ${tally.onToOff} | OFF -> ON ${tally.offToOn} | unreadable records ${unreadable}`);
if (!dry) {
  for (let k = 0; k < updates.length; k += 200) {
    await db.batch(updates.slice(k, k + 200).map((u) => ({ sql: 'UPDATE video_meetings SET camera_on = ? WHERE id = ?', args: [u.cam, u.id] })), 'write');
  }
  console.log(`updated ${updates.length} rows`);
} else console.log('Nothing written.');
