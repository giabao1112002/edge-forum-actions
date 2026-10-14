const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHandoverCase, buildLeaveReport } = require('../src/features/reports/report');
const { scopeThread } = require('../src/core/engine');

const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
const now = new Date('2026-10-13T09:00:00Z');
const url = 'https://learn.microsoft.com/en-us/answers/questions/6027209/test';
const thread = { id: '6027209', url, title: 'Database connection error', entries: [
  { id: 'question-6027209', type: 'question', authorId: 'customer', timestamp: '2026-10-08T09:00:00Z',
    content: 'The database connection fails after an update.' },
  { id: 'answer-1', type: 'answer', authorId: profileId, author: 'Brian Pham',
    timestamp: '2026-10-09T09:00:00Z', content: 'I asked the customer to check the connection string.' },
  { id: 'comment-1', type: 'comment', parentAnswerId: 'answer-1', authorId: 'customer',
    timestamp: '2026-10-10T09:00:00Z', content: 'The connection string was correct; the error continues.' },
  { id: 'comment-2', type: 'comment', parentAnswerId: 'answer-1', authorId: profileId,
    timestamp: '2026-10-13T09:00:00Z', content: 'I suggested checking the installed driver version.' },
  { id: 'comment-other', type: 'comment', parentAnswerId: 'answer-other', authorId: 'customer',
    timestamp: '2026-10-13T10:00:00Z', content: 'Comment below another answer.' }
] };
const result = { action: 'Send last quality response', due: '2026-10-15' };

test('handover detail identifies the owner and briefly summarizes their conversation', () => {
  const item = buildHandoverCase(thread, result, profileId, scopeThread);
  assert.equal(item.id, '6027209');
  assert.equal(item.ownerName, 'Brian Pham');
  assert.equal(item.status, 'Strike posted; final response pending');
  assert.match(item.nextStep, /final quality response by 2026-10-15/);
  assert.match(item.detail.customerNeed, /database connection fails/);
  assert.match(item.detail.ownerUpdate, /installed driver version/);
  assert.match(item.detail.customerUpdate, /connection string was correct/);
  assert.equal(Object.keys(item.detail).length, 4);
  assert.doesNotMatch(JSON.stringify(item.detail), /another answer/);
});

test('handover summary skips routine follow-ups and long conversation history', () => {
  const longThread = structuredClone(thread);
  longThread.title = 'VBA progress bar issue';
  longThread.entries[0].content = 'TarunVBA2026PB20';
  longThread.entries[1].content = 'Hi @Tarun Kumar, Thank you for sharing the code sample. After reviewing the VBA code, the UserForm progress bar logic appears correct. Please check the installed Office version and run the sample again.';
  longThread.entries = longThread.entries.filter((entry) => entry.id !== 'comment-2');
  longThread.entries.push({ id: 'comment-3', type: 'comment', parentAnswerId: 'answer-1',
    authorId: profileId, timestamp: '2026-10-14T09:00:00Z',
    content: 'Hi @Tarun Kumar, I haven’t heard back from you. Just wanted to check whether you saw my previous response. Feel free to reach out.' });
  const item = buildHandoverCase(longThread, result, profileId, scopeThread);
  const html = buildLeaveReport([item], profileId, '2026-10-15', '2026-10-15', now);
  assert.equal(item.detail.customerNeed, 'VBA progress bar issue');
  assert.match(item.detail.ownerUpdate, /^After reviewing the VBA code/);
  assert.ok(item.detail.ownerUpdate.length <= 163);
  assert.doesNotMatch(html, /haven.t heard back|Just wanted to check|<ol>/i);
  assert.match(html, /Customer request:|Owner response:/);
});

test('handover status and next step describe customer waiting, strikes and follow-up', () => {
  const first = buildHandoverCase(thread, { action: 'Post first strike comment', due: '2026-10-15' },
    profileId, scopeThread);
  const second = buildHandoverCase(thread, { action: 'Post second strike comment', due: '2026-10-16' },
    profileId, scopeThread);
  const followup = buildHandoverCase(thread, { action: 'Follow up with customer', due: '2026-10-14' },
    profileId, scopeThread);
  assert.match(first.status, /Waiting for customer response/);
  assert.match(first.nextStep, /first strike by 2026-10-15/);
  assert.match(second.status, /First strike posted/);
  assert.match(second.nextStep, /second strike by 2026-10-16/);
  assert.match(followup.status, /Customer replied/);
  assert.match(followup.nextStep, /Respond to the customer now/);
});

test('report includes only pending actions due during leave with the seven handover fields', () => {
  const due = buildHandoverCase(thread, result, profileId, scopeThread);
  const later = { ...due, id: '6034562', title: 'Later case', due: '2026-10-16' };
  const resolved = { ...due, id: '6032576', title: 'Resolved case', due: null,
    action: 'Your answer was accepted' };
  const before = structuredClone([due, later, resolved]);
  const html = buildLeaveReport([due, later, resolved], profileId, '2026-10-14', '2026-10-15', now);
  for (const label of ['Thread ID', 'Thread Link', 'Owner name', 'Current status', 'Detail',
    'Suggested Nextstep', 'Date Assign']) assert.match(html, new RegExp(label));
  assert.match(html, /6027209/);
  assert.match(html, /Brian Pham/);
  assert.match(html, /The connection string was correct/);
  assert.match(html, /Assigned from: <strong>2026-10-14<\/strong>/);
  assert.doesNotMatch(html, /Later case|Resolved case|Before leave|After leave/);
  assert.deepEqual([due, later, resolved], before);
});

test('report escapes thread content, refuses unsafe links and marks unreadable threads', () => {
  const item = buildHandoverCase(thread, result, profileId, scopeThread);
  item.title = '<script>alert(1)</script>';
  item.url = 'javascript:alert(1)';
  item.detail.customerNeed = '<img src=x onerror=alert(1)>';
  item.detail.ownerUpdate = '<script>alert(2)</script>';
  item.detail.customerUpdate = '<img src=x onerror=alert(3)>';
  item.sourceError = 'Network unavailable';
  const html = buildLeaveReport([item], profileId, '2026-10-15', '2026-10-15', now);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;|&lt;img/);
  assert.match(html, /Link unavailable/);
  assert.match(html, /Could not refresh this thread: Network unavailable/);
});

test('report validates dates and produces an empty handover when no work is due', () => {
  for (const [start, end] of [['', '2026-10-15'], ['2026-02-30', '2026-03-01'], ['2026-10-17', '2026-10-15']])
    assert.throws(() => buildLeaveReport([], profileId, start, end, now), /valid leave date range/);
  assert.match(buildLeaveReport([], profileId, '2026-10-15', '2026-10-15', now), /Cases requiring action during leave: <strong>0/);
});
