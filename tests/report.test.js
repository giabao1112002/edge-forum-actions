const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLeaveReport } = require('../src/features/reports/report');

const now = new Date('2026-10-13T09:00:00Z');
function item(id, due, extra = {}) {
  return { id, title: `Case ${id}`, url: `https://learn.microsoft.com/en-us/answers/questions/${id}/test`,
    action: 'Post first strike comment', tone: 'upcoming', due, checkedAt: '2026-10-13T08:00:00Z', ...extra };
}

test('leave report groups inclusive deadlines, pending replies, review and completed cases without modifying data', () => {
  const cases = [item('1', '2026-10-14'), item('2', '2026-10-15'), item('3', '2026-10-16'), item('4', '2026-10-17'),
    item('5', null, { action: 'Review needed', tone: 'neutral', checkedAt: null }),
    item('6', null, { action: 'Your answer was accepted', tone: 'completed' }),
    item('7', '2026-10-16', { action: 'Follow up with customer', error: 'Network unavailable' })];
  const original = structuredClone(cases);
  const html = buildLeaveReport(cases, 'profile-a', '2026-10-15', '2026-10-16', now);
  const section = (heading) => html.split(`<h2>${heading}`)[1].split('</section>')[0];
  assert.match(section('Before leave'), /Case 1/);
  assert.doesNotMatch(section('Before leave'), /Case 2/);
  assert.match(section('During leave'), /Case 2/);
  assert.match(section('During leave'), /Case 3/);
  assert.match(section('During leave'), /Customer response pending/);
  assert.match(section('During leave'), /LAST KNOWN — refresh failed: Network unavailable/);
  assert.match(section('After leave'), /Case 4/);
  assert.match(section('Review needed'), /Case 5/);
  assert.match(section('Review needed'), /Never successfully checked/);
  assert.match(section('Flow complete'), /Case 6/);
  assert.match(html, /profile-a/);
  assert.match(html, /2026-10-13T09:00:00.000Z/);
  assert.deepEqual(cases, original);
});

test('forecasts are separate from calculated work and preserve their conditions', () => {
  const html = buildLeaveReport([item('1', '2026-10-14', { predictedClose: '2026-10-16' }),
    item('2', null, { tone: 'completed', action: 'Your answer was accepted', predictedClose: '2026-10-16' })],
  'profile', '2026-10-15', '2026-10-16', now);
  const forecast = html.split('<h2>Conditional close-step forecasts')[1];
  assert.match(forecast, /\(1\)/);
  assert.match(forecast, /During leave/);
  assert.match(forecast, /no customer reply and intervening steps posted on schedule/);
  assert.doesNotMatch(forecast, /Case 2/);
});

test('report escapes remote content and refuses unsafe links', () => {
  const html = buildLeaveReport([item('1', '2026-10-15', { title: '<script>alert(1)</script>',
    url: 'javascript:alert(1)', error: '<img src=x onerror=alert(1)>' }),
  item('2', '2026-10-15', { url: 'https://learn.microsoft.com/en-us/answers/questions/2/test?x="&y=1' })],
  '<profile>', '2026-10-15', '2026-10-16', now);
  assert.doesNotMatch(html, /<script|<img|javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;profile&gt;/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /&amp;y=1/);
});

test('rejects invalid or reversed date ranges and accepts a single-day leave', () => {
  for (const [start, end] of [['', '2026-10-15'], ['2026-02-30', '2026-03-01'], ['2026-10-17', '2026-10-15']])
    assert.throws(() => buildLeaveReport([], 'profile', start, end, now), /valid leave date range/);
  assert.match(buildLeaveReport([], 'profile', '2026-10-15', '2026-10-15', now), /Saved cases: 0/);
});
