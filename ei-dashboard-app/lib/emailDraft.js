// Renders the free-text PA/PIP draft (AlertPreviewModal's editable
// textarea) into professional HTML — the same function powers both the
// client-side live preview and the actual email sent
// (app/api/employees/[id]/alert/route.js), so what HR previews is exactly
// what the recipient gets. Deliberately structural, not a full markdown
// parser: blocks are separated by a blank line.
//   - A block where every line starts with "- " becomes a bullet list.
//   - A block shaped like "Label:" followed by 2+ "Key: Value" lines
//     becomes an actual HTML table (columns = keys, one data row = values)
//     — this is how the Month-wise NR/Utilization section renders, instead
//     of just listing "M1 Util: 144%" line by line.
//   - Anything else becomes a plain paragraph, its own lines preserved as
//     <br/> within it.
// If HR restructures the draft enough that a block no longer matches one of
// these shapes, it just falls back to a plain paragraph — never broken,
// just loses that one block's special styling.
export function escHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function draftToHtml(draft) {
  const blocks = String(draft || '').split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return '';

      const [first, ...rest] = lines;
      // Bullet list — either every line in the block starts with "- ", or
      // every line AFTER the first does (the first being a plain header
      // line like "The following concerns have been noted:"). Checked
      // before the table shape below, since a "- Label: value" bullet line
      // also contains a ':' and would otherwise be misread as a table row.
      const allBullets = lines.every((l) => l.startsWith('- '));
      const restAreBullets = rest.length > 0 && rest.every((l) => l.startsWith('- '));
      if (allBullets || restAreBullets) {
        const header = allBullets ? '' : `<p style="margin:0 0 6px;">${escHtml(first)}</p>`;
        const bulletLines = allBullets ? lines : rest;
        const items = bulletLines.map((l) => `<li>${escHtml(l.slice(2))}</li>`).join('');
        return `${header}<ul style="margin:0 0 14px;padding-left:20px;">${items}</ul>`;
      }

      // Table — "Label:" header followed by 2+ "Key: value" lines, none of
      // which are bullets (already ruled out above).
      const looksLikeTable = first.endsWith(':') && rest.length >= 2 && rest.every((l) => l.includes(':'));
      if (looksLikeTable) {
        const label = first.slice(0, -1);
        const cells = rest.map((l) => {
          const idx = l.indexOf(':');
          return { head: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() };
        });
        const headRow = cells.map((c) => `<th style="border:1px solid #ddd;padding:6px 10px;background:#f5f5f5;font-size:12.5px;text-align:left;">${escHtml(c.head)}</th>`).join('');
        const valRow = cells.map((c) => `<td style="border:1px solid #ddd;padding:6px 10px;font-size:12.5px;">${escHtml(c.value)}</td>`).join('');
        return `<p style="margin:0 0 6px;font-weight:600;">${escHtml(label)}</p><table style="border-collapse:collapse;margin:0 0 14px;"><thead><tr>${headRow}</tr></thead><tbody><tr>${valRow}</tr></tbody></table>`;
      }

      return `<p style="margin:0 0 14px;">${lines.map(escHtml).join('<br/>')}</p>`;
    })
    .join('');
}
