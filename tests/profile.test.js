const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSupportProfile, resolveSupportProfile, resolveSupportProfileDetails,
  profileStorageKey, normalizeSupportSite } = require('../src/features/profile/profile');
const { activityThreadLinks } = require('../src/features/profile/activity');
const { caseSummary } = require('../src/features/cases/dashboard');

const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
test('teammates can set their own profile by ID or Microsoft Learn link', () => {
  assert.equal(parseSupportProfile(` ${profileId.toUpperCase()} `), profileId);
  assert.equal(parseSupportProfile(`https://learn.microsoft.com/en-us/users/na/?userid=${profileId}`), profileId);
  assert.equal(parseSupportProfile(`https://learn.microsoft.com/users/na/?userid=${profileId}&foo=bar`), profileId);
});
test('rejects thread URLs and non-Microsoft links as support profiles', () => {
  assert.throws(() => parseSupportProfile('hello'), /profile link/);
  assert.throws(() => parseSupportProfile(`https://example.com/users/na/?userid=${profileId}`), /Microsoft Learn/);
  assert.throws(() => parseSupportProfile(`https://learn.microsoft.com/en-us/answers/questions/1?userid=${profileId}`), /Microsoft Learn/);
});

test('supports Developer Community profile links without colliding with Learn IDs', () => {
  const devId = '1730167';
  assert.equal(normalizeSupportSite('devcommunity'), 'devcommunity');
  assert.equal(parseSupportProfile(`https://developercommunity.visualstudio.com/user/${devId}`), devId);
  assert.equal(profileStorageKey(devId, 'devcommunity', 'cases'), `cases-devcommunity-${devId}`);
  assert.equal(profileStorageKey(profileId, 'learn', 'cases'), `cases-${profileId}`);
});

test('saved cases carry their source site so Learn and Dev Community stay distinguishable', () => {
  const summary = caseSummary({ id: '99', url: 'https://developercommunity.visualstudio.com/t/123456', title: 'DevCom case',
    entries: [{ id: 'answer-1', type: 'answer', authorId: 'support', timestamp: '2026-10-01T10:00:00Z' }] },
    { action: 'Follow up with customer', due: '2026-10-05', tone: 'today', evidence: [] },
    '2026-10-01T12:00:00Z', 'support', {});
  assert.equal(summary.site, 'devcommunity');
  const learnSummary = caseSummary({ id: '98', url: 'https://learn.microsoft.com/en-us/answers/questions/1234/example', title: 'Learn case',
    entries: [{ id: 'answer-2', type: 'answer', authorId: 'support', timestamp: '2026-10-01T10:00:00Z' }] },
    { action: 'Follow up with customer', due: '2026-10-06', tone: 'today', evidence: [] },
    '2026-10-01T12:00:00Z', 'support', {});
  assert.equal(learnSummary.site, 'learn');
});

test('profile links without userid resolve through Microsoft Learn while existing inputs stay offline', async () => {
  const link = 'https://learn.microsoft.com/en-us/users/brianphamwicloudcorporation-2796/';
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, 'https://learn.microsoft.com/api/profiles/brianphamwicloudcorporation-2796');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ userId: profileId.toUpperCase() }) };
  };
  assert.equal(await resolveSupportProfile(link, request), profileId);
  assert.equal(calls, 1);
  assert.equal(await resolveSupportProfile(profileId, request), profileId);
  assert.equal(await resolveSupportProfile(`${link}?userid=${profileId}`, request), profileId);
  assert.equal(calls, 1);
  assert.deepEqual(await resolveSupportProfileDetails(`${link}?userid=${profileId}`, request),
    { id: profileId, username: 'brianphamwicloudcorporation-2796' });
});

test('failed or invalid profile lookups are rejected', async () => {
  const link = 'https://learn.microsoft.com/users/unknown/';
  await assert.rejects(resolveSupportProfile(link, async () => ({ ok: false, status: 404 })), /HTTP 404/);
  await assert.rejects(resolveSupportProfile(link, async () => ({ ok: true,
    json: async () => ({ userId: 'not-a-user-id' }) })), /valid user ID/);
  await assert.rejects(resolveSupportProfile(link, async () => { throw new Error('offline'); }), /while online/);
  await assert.rejects(resolveSupportProfile('https://example.com/users/name/', async () => {
    throw new Error('should not request');
  }), /Microsoft Learn/);
  await assert.rejects(resolveSupportProfile(`${link}?userid=invalid`, async () => {
    throw new Error('should not request');
  }), /invalid user ID/);
});

test('activity links require the right profile and recent authored Q&A posts', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const item = (id, type, actionVerb, extra = {}) => ({ activityType: 'qnA', userId: profileId,
    timestamp: '2026-10-13T10:00:00Z', activityData: { type, actionVerb,
      uri: `/en-us/answers/questions/${id}/test` }, ...extra });
  const feed = { userId: profileId, items: [item('1', 'answer', 'answered'), item('1', 'comment', 'commented'),
    item('2', 'comment', 'commented'), item('3', 'comment', 'edited'),
    item('4', 'answer', 'answered', { timestamp: '2026-08-01T10:00:00Z' }),
    item('5', 'answer', 'answered', { activityData: { type: 'answer', actionVerb: 'answered',
      uri: 'https://example.com/en-us/answers/questions/5/test' } })] };
  assert.deepEqual(activityThreadLinks(feed, profileId, now).map((item) => item.id), ['1', '2']);
  assert.throws(() => activityThreadLinks({ ...feed, userId: 'other' }, profileId, now), /does not match/);
});
