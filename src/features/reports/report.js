function buildLeaveReport(cases, profileId, start, end, now = new Date()) {
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  };
  if (!validDate(start) || !validDate(end) || start > end)
    throw new Error('Choose a valid leave date range; the end must not precede the start.');
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const link = (item) => {
    const label = escape(`${item.id} - ${item.title}`);
    try {
      const url = new URL(item.url);
      if (url.protocol === 'https:' && url.hostname === 'learn.microsoft.com' &&
          /^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/\d+(?:\/|$)/i.test(url.pathname))
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    } catch {}
    return label;
  };
  const sections = [
    { title: 'Before leave — prepare or handle outstanding work', rows: [] },
    { title: 'During leave — arrange coverage', rows: [] },
    { title: 'After leave — next scheduled work', rows: [] },
    { title: 'Review needed / no calculated deadline', rows: [] },
    { title: 'Flow complete / accepted — verify CI separately', rows: [] }
  ];
  const forecasts = [];
  for (const item of [...cases].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') ||
    String(a.id).localeCompare(String(b.id)))) {
    const notes = [];
    if (item.action === 'Follow up with customer') notes.push('Customer response pending: respond now; the date is the final deadline.');
    if (item.error) notes.push(`LAST KNOWN — refresh failed: ${item.error}`);
    if (!item.checkedAt) notes.push('Never successfully checked. Refresh before handover.');
    const checked = item.checkedAt || 'Never';
    const row = `<tr><td>${link(item)}</td><td>${escape(item.action)}</td><td>${escape(item.due || 'Not calculated')}</td><td>${escape(checked)}</td><td>${escape(notes.join(' '))}</td></tr>`;
    const group = item.due ? item.due < start ? 0 : item.due <= end ? 1 : 2 : item.tone === 'completed' ? 4 : 3;
    sections[group].rows.push(row);
    if (item.predictedClose && ['Post first strike comment', 'Post second strike comment'].includes(item.action)) {
      const period = item.predictedClose < start ? 'Before leave' : item.predictedClose <= end ? 'During leave' : 'After leave';
      forecasts.push(`<tr><td>${link(item)}</td><td>${escape(item.predictedClose)}</td><td>${period}</td><td>Conditional forecast only: no customer reply and intervening steps posted on schedule. Not proof of CI closure.${item.error ? ' Based on last-known data after a refresh failure.' : ''}</td></tr>`);
    }
  }
  const table = (rows, headings) => `<div class="table-wrap"><table><thead><tr>${headings.map((heading) => `<th scope="col">${heading}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Leave work report ${start} to ${end}</title>
<style>body{margin:0;color:#172332;background:#f1f5f9;font:14px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}section,header{background:white;border:1px solid #c4ceda;border-radius:8px;padding:18px;margin:16px 0}h1{margin:0;font-size:24px}h2{font-size:18px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d6e0eb;padding:10px;overflow-wrap:anywhere}th{background:#f1f5f9}a{color:#155bb6}small{color:#566376}@media print{body{background:white}main{padding:0}section,header{border:0;padding:8px 0}tr{break-inside:avoid}.table-wrap{overflow:visible}}</style></head><body><main>
<header><h1>Leave work report</h1><p>Leave: <strong>${start} → ${end}</strong> (inclusive)</p><p>Support profile: ${escape(profileId)}<br>Generated: ${escape(now.toISOString())}<br>Saved cases: ${cases.length}</p><p>Snapshot of saved data, not a live feed. Refresh My Cases before export and verify the full threads. New replies can change the schedule. Dates use local business rules; leave does not move deadlines or pause monitoring. Forum completion does not confirm CI closure. Check timestamps and errors before handing over.</p></header>
${sections.map((section) => `<section><h2>${section.title} (${section.rows.length})</h2>${section.rows.length ? table(section.rows, ['Case / thread', 'Next action', 'Calculated due', 'Last successful check (UTC)', 'Handover notes']) : '<p>No saved cases in this group.</p>'}</section>`).join('\n')}
<section><h2>Conditional close-step forecasts (${forecasts.length})</h2>${forecasts.length ? table(forecasts, ['Case / thread', 'Predicted date', 'Leave period', 'Conditions']) : '<p>No close-step forecasts available.</p>'}</section>
<footer><small>Generated locally by Forum Action Planner. No email sent; no case modified.</small></footer></main></body></html>`;
}
if (typeof module !== 'undefined') module.exports = { buildLeaveReport };
