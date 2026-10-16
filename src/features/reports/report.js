function buildHandoverCase(thread, result, profileId, scope, ownerFallback = '') {
  const scoped = scope(thread, profileId);
  const question = scoped.entries.find((entry) => entry.type === 'question');
  const owner = thread.entries.find((entry) => entry.authorId === profileId && entry.author && entry.author !== 'Unknown');
  const brief = (value, limit = 160) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
      .replace(/^(?:hi|hello|dear)\s+@?[^.!?]{1,60}[,.!?]\s*/i, '')
      .replace(/^thank you for (?:sharing|your response)[^.!?]{0,100}[.!?]\s*/i, '');
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit + 1).lastIndexOf(' ');
    return `${text.slice(0, cut > limit / 2 ? cut : limit).trimEnd()}...`;
  };
  const ownerEntries = scoped.entries.filter((entry) => entry.authorId === profileId && entry.type !== 'question');
  const isRoutineFollowUp = (entry) => /haven.t heard back|just wanted to check|checking in|following up|follow.up reminder|feel free to reach out/i
    .test(entry.content || entry.excerpt || '');
  const ownerUpdate = [...ownerEntries].reverse().find((entry) => !isRoutineFollowUp(entry)) || ownerEntries[0];
  const customerUpdate = [...scoped.entries].reverse().find((entry) => entry.type !== 'question' &&
    (entry.customerReply || entry.authorId === question?.authorId));
  const questionText = question?.content || question?.excerpt || '';
  const customerNeed = questionText.length >= 25 || questionText.includes(' ') ? questionText : thread.title;
  const action = result.action;
  const status = action === 'Follow up with customer' ? 'Customer replied; owner response pending'
    : action === 'Post first strike comment' ? 'Waiting for customer response; first strike scheduled'
    : action === 'Post second strike comment' ? 'First strike posted; waiting for customer response'
    : action === 'Send last quality response' ? 'Strike posted; final response pending'
    : 'Needs review';
  const nextStep = action === 'Follow up with customer'
    ? `Respond to the customer now; final deadline ${result.due}.`
    : action === 'Post first strike comment' ? `If there is no customer reply, post the first strike by ${result.due}.`
    : action === 'Post second strike comment' ? `If there is no customer reply, post the second strike by ${result.due}.`
    : action === 'Send last quality response' ? `If there is no customer reply, send the final quality response by ${result.due}.`
    : 'Open the thread and review the next action.';
  return { id: thread.id, url: thread.url, title: thread.title, site: thread.site || 'learn',
    ownerName: owner?.author || ownerFallback || 'Name unavailable',
    action, due: result.due || null, status, nextStep,
    detail: { customerNeed: brief(customerNeed), ownerUpdate: brief(ownerUpdate?.content || ownerUpdate?.excerpt),
      customerUpdate: brief(customerUpdate?.content || customerUpdate?.excerpt), incomplete: !!thread.hasMorePages } };
}

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
  const safeLink = (item) => {
    try {
      const url = new URL(item.url);
      const learnId = url.hostname === 'learn.microsoft.com' &&
        url.pathname.match(/^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/(\d+)(?:\/|$)/i)?.[1];
      const communityId = url.hostname === 'developercommunity.visualstudio.com' &&
        url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/i)?.[1];
      if (url.protocol === 'https:' && (learnId || communityId) === String(item.id))
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(url.href)}</a>`;
    } catch {}
    return 'Link unavailable';
  };
  const pending = cases.filter((item) => item.due && item.due >= start && item.due <= end &&
    ['Follow up with customer', 'Post first strike comment', 'Post second strike comment',
      'Send last quality response'].includes(item.action))
    .sort((left, right) => left.due.localeCompare(right.due) || String(left.id).localeCompare(String(right.id)));
  const cards = pending.map((item) => {
    const detail = item.detail || {};
    const summary = [
      ['Customer request', detail.customerNeed],
      ['Owner response', detail.ownerUpdate],
      ['Latest customer update', detail.customerUpdate]
    ].filter(([, value]) => value).map(([label, value]) => `<p><strong>${label}:</strong> ${escape(value)}</p>`).join('');
    const note = item.sourceError ? `<p class="warning">Could not refresh this thread: ${escape(item.sourceError)}. Open the link before acting.</p>` :
      detail.incomplete ? '<p class="warning">This thread has more pages. Open the full thread before acting.</p>' : '';
    return `<article class="case"><h2>Thread ${escape(item.id)} · ${escape(item.title || '')}</h2>
<dl><dt>Thread ID</dt><dd>${escape(item.id)}</dd><dt>Source</dt><dd>${item.site === 'devcommunity' ? 'Developer Community' : 'Microsoft Learn'}</dd><dt>Thread Link</dt><dd>${safeLink(item)}</dd>
<dt>Owner name</dt><dd>${escape(item.ownerName || 'Name unavailable')}</dd>
<dt>Current status</dt><dd>${escape(item.status || 'Needs review')}</dd>
<dt>Detail</dt><dd>${summary || '<p>Brief summary unavailable; open the thread.</p>'}${note}</dd>
<dt>Suggested Nextstep</dt><dd>${escape(item.nextStep || item.action)}${item.due ? ` <strong>Due ${escape(item.due)}</strong>` : ''}</dd>
<dt>Date Assign</dt><dd>${escape(start)}</dd></dl></article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Leave handover ${start} to ${end}</title>
<style>body{margin:0;color:#172332;background:#f1f5f9;font:14px/1.5 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:24px}header,.case{background:white;border:1px solid #c4ceda;border-radius:8px;padding:20px;margin:16px 0}h1{margin:0;font-size:24px}h2{margin:0 0 16px;font-size:18px}dl{display:grid;grid-template-columns:170px 1fr;gap:10px 18px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}dd p{margin:0 0 4px}dd p:last-child{margin-bottom:0}.warning{color:#9b3329;font-weight:700}a{color:#155bb6}small{color:#566376}@media(max-width:650px){dl{display:block}dt{margin-top:12px}}@media print{body{background:white}main{padding:0}header,.case{break-inside:avoid;border:0;border-bottom:1px solid #c4ceda;border-radius:0}}</style></head><body><main>
<header><h1>Leave handover</h1><p>Leave: <strong>${escape(start)} → ${escape(end)}</strong> (inclusive)<br>Assigned from: <strong>${escape(start)}</strong><br>Support profile(s): ${escape(profileId)}<br>Generated: ${escape(now.toISOString())}<br>Cases requiring action during leave: <strong>${pending.length}</strong></p>
<p>Only calculated actions due during leave are listed. Check each live thread before acting; new customer replies can change the next step or deadline. This report does not confirm CI closure.</p></header>
${cards || '<section class="case"><p>No saved cases have a calculated action due during this leave period.</p></section>'}
<footer><small>Generated locally by Forum Action Planner. No email sent; no case modified.</small></footer></main></body></html>`;
}

if (typeof module !== 'undefined') module.exports = { buildHandoverCase, buildLeaveReport };
