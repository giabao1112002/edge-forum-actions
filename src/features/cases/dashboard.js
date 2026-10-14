function detectThreadSite(url = '', fallback = 'learn') {
  const value = String(url || '').trim().toLowerCase();
  if (!value) return fallback;
  if (value.includes('developercommunity.visualstudio.com') || value.includes('devcommunity')) return 'devcommunity';
  return 'learn';
}

function caseSummary(thread, result, checkedAt, supportAuthorId, actions = {}) {
  const ownAnswers = new Set(thread.entries.filter((entry) => entry.type === 'answer' && entry.authorId === supportAuthorId)
    .map((entry) => entry.id));
  const lastPost = thread.entries.filter((entry) => entry.authorId === supportAuthorId &&
    (entry.type === 'answer' || entry.type === 'comment') &&
    (!entry.parentAnswerId || ownAnswers.has(entry.parentAnswerId)) && actions[entry.id] !== 'ignore')
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const evidence = result.evidence?.find((source) => source.entryId === lastPost?.id)?.label;
  const step = evidence === 'Final follow-up' ? 'Close step (final response)'
    : evidence === 'Accepted answer' ? 'Answer accepted'
    : evidence?.toLowerCase().includes('strike') ? `Strike ${result.postedStrikes?.length || 1}`
    : evidence === 'Your latest response' ? 'Customer follow-up response'
    : evidence === 'Your first answer' ? 'First answer' : null;
  return { id: thread.id, url: thread.url, title: thread.title, action: result.action,
    due: result.due || null, predictedClose: result.predictedClose || null, tone: result.tone, checkedAt,
    site: detectThreadSite(thread.url, thread.site || 'learn'),
    lastSupportPost: lastPost ? { timestamp: lastPost.timestamp, type: lastPost.type, step } : null };
}

function caseTitle(item) {
  return `${item.id} - ${item.title}`;
}

function caseStatus(item, now = new Date()) {
  if (!item.due) return item.tone;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return item.due < today ? 'overdue' : item.due === today ? 'today' : 'upcoming';
}

function caseCategory(item) {
  if (item.action === 'Post first strike comment' || item.action === 'Post second strike comment') return 'strike';
  if (item.action === 'Send last quality response') return 'close';
  if (item.action === 'Follow up with customer') return 'followup';
  if (item.tone === 'completed') return 'completed';
  return 'review';
}

function caseStep(action) {
  return { 'Post first strike comment': 'Strike 1', 'Post second strike comment': 'Strike 2',
    'Send last quality response': 'Close step (final response)',
    'Follow up with customer': 'Customer follow-up' }[action] || action;
}

function postedToday(item, now = new Date()) {
  const posted = item.lastSupportPost && new Date(item.lastSupportPost.timestamp);
  return !!(posted && Number.isFinite(posted.getTime()) && posted.getFullYear() === now.getFullYear() &&
    posted.getMonth() === now.getMonth() && posted.getDate() === now.getDate());
}

function todayActivity(item, now = new Date()) {
  const status = caseStatus(item, now);
  if (item.action === 'Follow up with customer' && item.due)
    return status === 'today' ? 'urgent' : status === 'overdue' ? 'overdue' : 'reply';
  if (status === 'today' || status === 'overdue') return status;
  if (postedToday(item, now)) return 'posted';
  return null;
}

function sortCases(cases, now = new Date()) {
  const order = { overdue: 0, today: 1, upcoming: 2, neutral: 3, completed: 4 };
  return [...cases].sort((left, right) =>
    (order[caseStatus(left, now)] ?? 3) - (order[caseStatus(right, now)] ?? 3) ||
    (left.due || '').localeCompare(right.due || '') || left.title.localeCompare(right.title));
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarWeek(cases, weekOf = new Date(), now = new Date()) {
  const first = new Date(weekOf.getFullYear(), weekOf.getMonth(), weekOf.getDate());
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    return { date, key: localDateKey(date), events: [] };
  });
  const byDate = new Map(days.map((day) => [day.key, day.events]));
  const todayKey = localDateKey(now);
  const add = (key, kind, item) => byDate.get(key)?.push({ kind, item });
  for (const item of cases) {
    if (item.due) {
      add(item.due, 'due', item);
      if (item.due < todayKey) add(todayKey, 'overdue', item);
      else if (item.action === 'Follow up with customer' && item.due > todayKey) add(todayKey, 'reply', item);
    }
    const postDate = item.lastSupportPost && new Date(item.lastSupportPost.timestamp);
    if (postDate && Number.isFinite(postDate.getTime())) add(localDateKey(postDate), 'observed', item);
    if (item.predictedClose && caseCategory(item) === 'strike') add(item.predictedClose, 'prediction', item);
  }
  const order = { overdue: 0, reply: 1, due: 2, observed: 3, prediction: 4 };
  for (const day of days) day.events.sort((left, right) => order[left.kind] - order[right.kind] ||
    caseTitle(left.item).localeCompare(caseTitle(right.item)));
  return days;
}
if (typeof module !== 'undefined') module.exports = { caseSummary, caseTitle, caseStatus, caseCategory, caseStep, postedToday, todayActivity, sortCases, localDateKey, calendarWeek };
