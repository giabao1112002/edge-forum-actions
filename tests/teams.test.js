const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTeamsWebhook, createTeamsNotifier } = require('../src/features/teams/teams');
const { scopeThread } = require('../src/core/engine');

const webhook = 'https://prod-01.westeurope.logic.azure.com/workflows/1234abcd/triggers/manual/paths/invoke?api-version=2016-10-01&sig=private_token';
const profileId = 'support';
const summary = { id: '1', action: 'Follow up with customer', due: '2026-10-05' };
const base = { id: '1', url: 'https://learn.microsoft.com/en-us/answers/questions/1/test', entries: [
  { id: 'question-1', type: 'question', authorId: 'cx', timestamp: '2026-10-01T09:00:00Z' },
  { id: 'answer-1', type: 'answer', authorId: profileId, timestamp: '2026-10-01T10:00:00Z' }
] };
const reply = (id, extra = {}) => ({ id, type: 'comment', authorId: 'cx', parentAnswerId: 'answer-1',
  timestamp: '2026-10-02T10:00:00Z', content: 'Private customer information', ...extra });

function app() {
  const saved = { supportAuthorId: profileId, 'cases-support': [summary] };
  const requests = [];
  let respond = async () => ({ ok: true, status: 202 });
  const storage = { get: async (keys) => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys])
    .map((key) => [key, saved[key]]))), set: async (data) => Object.assign(saved, structuredClone(data)) };
  const notifier = createTeamsNotifier(storage, async (url, options) => {
    requests.push({ url, options, payload: JSON.parse(options.body) });
    return respond();
  }, scopeThread);
  return { saved, requests, notifier, setResponse: (next) => { respond = next; } };
}

test('Teams accepts Microsoft Workflow URLs only and never exposes a secret in validation errors', () => {
  assert.equal(validateTeamsWebhook(webhook), webhook);
  assert.equal(validateTeamsWebhook('https://abc.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/1234abcd/triggers/manual/paths/invoke?sig=private_token'),
    'https://abc.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/1234abcd/triggers/manual/paths/invoke?sig=private_token');
  for (const value of ['https://evil.example.com/workflows/1234/triggers/manual/paths/invoke?sig=private_token',
    'http://prod-01.westeurope.logic.azure.com/workflows/1234/triggers/manual/paths/invoke?sig=private_token',
    'https://prod-01.westeurope.logic.azure.com.evil.example.com/workflows/1234/triggers/manual/paths/invoke?sig=private_token',
    'https://prod-01.westeurope.logic.azure.com/workflows/1234/triggers/manual/paths/invoke',
    'https://user:pass@prod-01.westeurope.logic.azure.com/workflows/1234/triggers/manual/paths/invoke?sig=private_token'])
    assert.throws(() => validateTeamsWebhook(value), (error) => !error.message.includes('private_token'));
});

test('Teams test is explicit, reply detection baselines old replies, then sends one private card', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  const old = { ...base, entries: [...base.entries, reply('old')] };
  await a.notifier.observe(profileId, old);
  assert.equal(a.requests.length, 0);
  const updated = { ...old, entries: [...old.entries, reply('new'), reply('outside', { parentAnswerId: 'answer-other' })] };
  await Promise.all([a.notifier.observe(profileId, updated), a.notifier.observe(profileId, updated)]);
  assert.equal(a.requests.length, 1);
  const sent = a.requests[0];
  assert.equal(sent.url, webhook);
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.payload.type, 'message');
  assert.equal(sent.payload.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  const card = sent.payload.attachments[0].content;
  assert.match(card.actions[0].url, /#new$/);
  assert.doesNotMatch(JSON.stringify(sent.payload), /Private customer information|outside/);
  await a.notifier.test(profileId);
  assert.equal(a.requests.length, 2);
  assert.match(JSON.stringify(a.requests[1].payload), /No case data is included/);
  assert.match(a.saved['teams-status-support'].message, /accepted the test request/);
});

test('Teams failure retains unsent replies for retry, while disabled configuration stores no webhook', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, base);
  a.setResponse(async () => { throw new Error(`Failed at ${webhook}`); });
  const updated = { ...base, entries: [...base.entries, reply('new')] };
  await a.notifier.observe(profileId, updated);
  assert.deepEqual(a.saved['teams-seen-support']['1'], []);
  assert.doesNotMatch(a.saved['teams-status-support'].message, /private_token|workflows\//);
  a.setResponse(async () => ({ ok: true, status: 202 }));
  await a.notifier.observe(profileId, updated);
  assert.deepEqual(a.saved['teams-seen-support']['1'], ['new']);
  await a.notifier.configure(profileId, { enabled: false, webhook: '' });
  assert.equal(a.saved['teams-support'].webhook, '');
});

test('Teams alerts once when the question author accepts this profile’s answer', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, base);
  const otherAnswer = { id: 'answer-other', type: 'answer', authorId: 'other', timestamp: '2026-10-02T09:00:00Z' };
  const withOther = { ...base, entries: [...base.entries, otherAnswer], acceptedAnswerId: otherAnswer.id };
  await a.notifier.observe(profileId, withOther);
  assert.equal(a.requests.length, 0);
  const accepted = { ...withOther, acceptedAnswerId: 'answer-1', hasMorePages: true };
  await a.notifier.observe(profileId, accepted);
  assert.equal(a.requests.length, 1);
  const card = a.requests[0].payload.attachments[0].content;
  assert.match(card.body[0].text, /Your answer was accepted.*Case 1/);
  assert.match(card.body[1].text, /Verify CI closure separately/);
  assert.match(card.actions[0].url, /#answer-1$/);
  assert.deepEqual(a.saved['teams-accepted-support']['1'], ['answer-1']);
  await a.notifier.observe(profileId, accepted);
  assert.equal(a.requests.length, 1);
});

test('Teams baselines an already accepted answer and retries an acceptance after send failure', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, { ...base, acceptedAnswerId: 'answer-1' });
  assert.equal(a.requests.length, 0);
  assert.deepEqual(a.saved['teams-accepted-support']['1'], ['answer-1']);
  await a.notifier.observe(profileId, { ...base, acceptedAnswerId: 'answer-1' });
  assert.equal(a.requests.length, 0);

  const b = app();
  await b.notifier.configure(profileId, { enabled: true, webhook });
  await b.notifier.observe(profileId, base);
  b.setResponse(async () => { throw new Error(`Failed at ${webhook}`); });
  await b.notifier.observe(profileId, { ...base, acceptedAnswerId: 'answer-1' });
  assert.deepEqual(b.saved['teams-accepted-support']['1'], []);
  assert.doesNotMatch(b.saved['teams-status-support'].message, /private_token/);
  b.setResponse(async () => ({ ok: true, status: 202 }));
  await b.notifier.observe(profileId, { ...base, acceptedAnswerId: 'answer-1' });
  assert.deepEqual(b.saved['teams-accepted-support']['1'], ['answer-1']);
});

test('Teams sends both a new reply and a new acceptance observed in the same check', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, base);
  await a.notifier.observe(profileId, { ...base, acceptedAnswerId: 'answer-1', entries: [...base.entries, reply('new')] });
  assert.equal(a.requests.length, 2);
  assert.match(a.requests[0].payload.attachments[0].content.body[0].text, /accepted/);
  assert.match(a.requests[1].payload.attachments[0].content.body[0].text, /Customer replied/);
});
