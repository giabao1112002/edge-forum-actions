const test = require('node:test');
const assert = require('node:assert/strict');
const { caseSummary, caseTitle, caseStatus, caseCategory, caseStep, todayActivity, sortCases, calendarWeek } = require('../src/features/cases/dashboard');
const { planAction } = require('../src/core/engine');
const now = new Date('2026-09-30T12:00:00Z');

test('keeps only display metadata and source link in saved case summaries', () => {
  const summary = caseSummary({ id: '1', url: 'https://learn.microsoft.com/en-us/answers/questions/1/x', title: 'Case',
    entries: [{ excerpt: 'Sensitive content' }] }, { action: 'Post first strike comment', due: '2026-10-01', predictedClose: '2026-10-05', tone: 'upcoming' }, now.toISOString());
  assert.equal(summary.entries, undefined);
  assert.equal(summary.due, '2026-10-01');
  assert.equal(summary.predictedClose, '2026-10-05');
  assert.equal(summary.checkedAt, now.toISOString());
});
test('shows the saved Q&A number before the case title', () => {
  assert.equal(caseTitle({ id: '6019097', title: 'Not able to install VS 2026 profession in my machine.' }),
    '6019097 - Not able to install VS 2026 profession in my machine.');
});
test('recalculates due today and overdue as the day changes, and sorts urgent cases first', () => {
  const items = [
    { id: 'future', title: 'Future', due: '2026-10-01', tone: 'upcoming' },
    { id: 'done', title: 'Done', due: null, tone: 'completed' },
    { id: 'late', title: 'Late', due: '2026-09-29', tone: 'upcoming' },
    { id: 'today', title: 'Today', due: '2026-09-30', tone: 'upcoming' }
  ];
  assert.deepEqual(items.map((item) => caseStatus(item, now)), ['upcoming', 'completed', 'overdue', 'today']);
  assert.deepEqual(sortCases(items, now).map((item) => item.id), ['late', 'today', 'future', 'done']);
});
test('groups cases by next action without treating closure work as confirmed closure', () => {
  assert.equal(caseCategory({ action: 'Post first strike comment', tone: 'overdue' }), 'strike');
  assert.equal(caseCategory({ action: 'Post second strike comment', tone: 'upcoming' }), 'strike');
  assert.equal(caseCategory({ action: 'Send last quality response', tone: 'today' }), 'close');
  assert.equal(caseCategory({ action: 'Follow up with customer', tone: 'upcoming' }), 'followup');
  assert.equal(caseCategory({ action: 'Strike flow complete — verify CI closure', tone: 'completed' }), 'completed');
  assert.equal(caseCategory({ action: 'Your answer was accepted', tone: 'completed' }), 'completed');
  assert.equal(caseCategory({ action: 'Review needed', tone: 'neutral' }), 'review');
  assert.equal(caseCategory({ action: 'Unknown action', tone: 'upcoming' }), 'review');
});
test('today includes due and overdue cases before observed posts, without treating tomorrow as due', () => {
  const date = new Date(2026, 8, 30, 12);
  const posted = { timestamp: date.toISOString(), type: 'comment' };
  assert.equal(todayActivity({ due: '2026-09-30', lastSupportPost: posted }, date), 'today');
  assert.equal(todayActivity({ due: '2026-09-29', lastSupportPost: posted }, date), 'overdue');
  assert.equal(todayActivity({ due: '2026-10-01', lastSupportPost: posted }, date), 'posted');
  assert.equal(todayActivity({ due: '2026-10-01' }, date), null);
  assert.equal(todayActivity({ due: null, lastSupportPost: posted }, new Date(2026, 9, 1, 12)), null);
});
test('a customer reply needs attention immediately and turns urgent on the final deadline', () => {
  const wednesday = new Date(2026, 8, 30, 12);
  const thursday = new Date(2026, 9, 1, 12);
  const friday = new Date(2026, 9, 2, 12);
  const pending = { action: 'Follow up with customer', due: '2026-10-01',
    lastSupportPost: { timestamp: wednesday.toISOString(), type: 'answer' } };
  assert.equal(todayActivity(pending, wednesday), 'reply');
  assert.equal(todayActivity(pending, thursday), 'urgent');
  assert.equal(todayActivity(pending, friday), 'overdue');
  assert.equal(todayActivity({ ...pending, action: 'Post first strike comment', due: '2026-10-05' }, thursday), null);
});
test('observed posts only come from your conversation, not other answers or ignored comments', () => {
  const postedAt = new Date(2026, 8, 30, 12).toISOString();
  const thread = { id: '1', url: 'https://learn.microsoft.com/en-us/answers/questions/1/x', title: 'Case', entries: [
    { id: 'answer-1', type: 'answer', authorId: 'staff', timestamp: '2026-09-25T12:00:00Z' },
    { id: 'answer-2', type: 'answer', authorId: 'other', timestamp: '2026-09-25T13:00:00Z' },
    { id: 'comment-1', type: 'comment', authorId: 'staff', parentAnswerId: 'answer-2', timestamp: postedAt },
    { id: 'comment-2', type: 'comment', authorId: 'staff', parentAnswerId: 'answer-1', timestamp: postedAt }
  ] };
  const result = { action: 'Post first strike comment', due: '2026-10-01', tone: 'upcoming' };
  const ignored = caseSummary(thread, result, postedAt, 'staff', { 'comment-2': 'ignore' });
  assert.equal(todayActivity(ignored, new Date(2026, 8, 30, 12)), null);
  const observed = caseSummary(thread, result, postedAt, 'staff');
  assert.deepEqual(observed.lastSupportPost, { timestamp: postedAt, type: 'comment', step: null });
  assert.equal(observed.entries, undefined);
  assert.equal(todayActivity(observed, new Date(2026, 8, 30, 12)), 'posted');
});
test('labels observed strike and close steps from evidence without assuming a comment is a strike', () => {
  const timestamp = new Date(2026, 8, 30, 12).toISOString();
  const example = { id: '1', url: 'https://learn.microsoft.com/en-us/answers/questions/1/x', title: 'Case', entries: [
    { id: 'answer-1', type: 'answer', authorId: 'staff', timestamp: '2026-09-25T12:00:00Z' },
    { id: 'comment-1', type: 'comment', authorId: 'staff', parentAnswerId: 'answer-1', timestamp }
  ] };
  const strike = caseSummary(example, { action: 'Send last quality response', due: '2026-10-02',
    postedStrikes: ['2026-09-30'], evidence: [{ entryId: 'comment-1', label: 'Most recent strike' }] }, timestamp, 'staff');
  assert.equal(strike.lastSupportPost.step, 'Strike 1');
  const close = caseSummary(example, { action: 'Strike flow complete - verify CI closure',
    evidence: [{ entryId: 'comment-1', label: 'Final follow-up' }] }, timestamp, 'staff');
  assert.equal(close.lastSupportPost.step, 'Close step (final response)');
  assert.equal(caseStep('Post first strike comment'), 'Strike 1');
  assert.equal(caseStep('Post second strike comment'), 'Strike 2');
  assert.equal(caseStep('Send last quality response'), 'Close step (final response)');
});
test('weekly calendar separates due, observed, and predicted dates without calendar permissions', () => {
  const cases = [{ id: '1', title: 'Case', action: 'Post first strike comment', due: '2026-09-30',
    predictedClose: '2026-10-02', lastSupportPost: { timestamp: '2026-09-29T12:00:00Z', step: 'First answer' } }];
  const days = calendarWeek(cases, new Date(2026, 8, 30, 12), new Date(2026, 8, 30, 12));
  assert.equal(days[0].key, '2026-09-28');
  assert.deepEqual(days[1].events.map((event) => event.kind), ['observed']);
  assert.deepEqual(days[2].events.map((event) => event.kind), ['due']);
  assert.deepEqual(days[4].events.map((event) => event.kind), ['prediction']);
  const nextWeek = calendarWeek(cases, new Date(2026, 9, 5, 12), new Date(2026, 8, 30, 12));
  assert.equal(nextWeek[0].key, '2026-10-05');
  assert.equal(nextWeek.flatMap((day) => day.events).length, 0);
});
test('calendar shows customer replies immediately and overdue work on the current day', () => {
  const cases = [
    { id: '1', title: 'Reply', action: 'Follow up with customer', due: '2026-10-01' },
    { id: '2', title: 'Late', action: 'Send last quality response', due: '2026-09-25' }
  ];
  const days = calendarWeek(cases, new Date(2026, 8, 30, 12), new Date(2026, 8, 30, 12));
  assert.deepEqual(days[2].events.map((event) => event.kind), ['overdue', 'reply']);
  assert.deepEqual(days[3].events.map((event) => event.kind), ['due']);
  assert.equal(days[2].events[0].item.id, '2');
});
test('a refreshed customer reply removes the previous strike and close forecast from the calendar', () => {
  const original = { id: '1', url: 'https://learn.microsoft.com/en-us/answers/questions/1/x', title: 'Case', entries: [
    { id: 'question-1', type: 'question', authorId: 'customer', timestamp: '2026-09-25T11:00:00Z' },
    { id: 'answer-1', type: 'answer', authorId: 'staff', timestamp: '2026-09-25T12:00:00Z' }
  ] };
  const settings = { supportAuthorId: 'staff', actions: {} };
  const before = caseSummary(original, planAction(original, settings, now), now.toISOString(), 'staff');
  assert.equal(before.predictedClose, '2026-10-02');
  const refreshed = { ...original, entries: [...original.entries,
    { id: 'comment-1', type: 'comment', authorId: 'customer', parentAnswerId: 'answer-1',
      timestamp: '2026-09-30T10:00:00Z' }] };
  const after = caseSummary(refreshed, planAction(refreshed, settings, now), now.toISOString(), 'staff');
  assert.equal(after.predictedClose, null);
  const days = calendarWeek([after], new Date(2026, 8, 30, 12), new Date(2026, 8, 30, 12));
  assert.deepEqual(days[2].events.map((event) => event.kind), ['reply']);
  assert.deepEqual(days[3].events.map((event) => event.kind), ['due']);
  assert.equal(days.flatMap((day) => day.events).some((event) => event.kind === 'prediction'), false);
});
