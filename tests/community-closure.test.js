const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeamsNotifier } = require('../src/features/teams/teams');
const { scopeThread } = require('../src/core/engine');

const profileId = '1753330';
const webhook = 'https://prod-01.westeurope.logic.azure.com/workflows/1234abcd/triggers/manual/paths/invoke?sig=test';
const key = `teams-community-status-devcommunity-${profileId}`;
const thread = { id: '11166777', site: 'devcommunity',
  url: 'https://developercommunity.visualstudio.com/t/Anot-able-to-use-cPilot-from-vs-coee-/11166777',
  communityStatus: 'Active', entries: [
    { id: '11166777', type: 'question', authorId: '1475408', timestamp: '2026-10-15T09:20:48Z' },
    { id: '11166842', type: 'comment', authorId: profileId, timestamp: '2026-10-15T10:52:41Z' },
    { id: '11167194', type: 'answer', authorId: profileId, timestamp: '2026-10-16T02:35:19Z' }
  ] };

function setup(initial = {}) {
  const saved = { supportSite: 'devcommunity', supportProfiles: { devcommunity: { id: profileId } },
    [`cases-devcommunity-${profileId}`]: [{ id: thread.id }], ...initial };
  const requests = [];
  let response = { ok: true, status: 202 };
  const storage = { get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
    .map((name) => [name, structuredClone(saved[name])])),
  set: async (values) => Object.assign(saved, structuredClone(values)) };
  const notifier = createTeamsNotifier(storage, async (_, options) => {
    requests.push(JSON.parse(options.body));
    return response;
  }, scopeThread);
  return { saved, requests, notifier, setResponse: (next) => { response = next; } };
}

test('Developer Community Closed - Fixed transition sends a status card once after baseline', async () => {
  const app = setup();
  await app.notifier.configure(profileId, { enabled: true, webhook });
  await app.notifier.observe(profileId, thread, 'devcommunity');
  assert.equal(app.requests.length, 0);
  app.saved.supportSite = 'learn';
  const closed = { ...thread, communityStatus: 'Closed - Fixed' };
  await app.notifier.observe(profileId, closed, 'devcommunity');
  assert.equal(app.requests.length, 1);
  const card = app.requests[0].attachments[0].content;
  assert.match(card.body[0].text, /Closed - Fixed.*11166777/);
  assert.doesNotMatch(JSON.stringify(card), /customer accepted|question author accepted/i);
  assert.equal(card.actions[0].url, thread.url);
  assert.equal(app.saved[key][thread.id], 'Closed - Fixed');
  await app.notifier.observe(profileId, closed, 'devcommunity');
  assert.equal(app.requests.length, 1);
});

test('an already closed thread is baselined and a failed status alert retries', async () => {
  const app = setup();
  await app.notifier.configure(profileId, { enabled: true, webhook });
  const closed = { ...thread, communityStatus: 'Closed - Fixed' };
  await app.notifier.observe(profileId, closed, 'devcommunity');
  assert.equal(app.requests.length, 0);
  await app.notifier.observe(profileId, thread, 'devcommunity');
  app.setResponse({ ok: false, status: 500 });
  await app.notifier.observe(profileId, closed, 'devcommunity');
  assert.equal(app.saved[key][thread.id], 'Active');
  app.setResponse({ ok: true, status: 202 });
  await app.notifier.observe(profileId, closed, 'devcommunity');
  assert.equal(app.saved[key][thread.id], 'Closed - Fixed');
  assert.equal(app.requests.length, 2);
});
