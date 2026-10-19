const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordNotifier, validateDiscordWebhook } = require('../src/features/discord/discord');
const { scopeThread } = require('../src/core/engine');

const webhook = 'https://discord.com/api/webhooks/123456/test_token';
const profileId = 'support';
const base = { id: '1', url: 'https://learn.microsoft.com/en-us/answers/questions/1/test', entries: [
  { id: 'question-1', type: 'question', authorId: 'cx', timestamp: '2026-10-01T09:00:00Z' },
  { id: 'answer-1', type: 'answer', authorId: profileId, timestamp: '2026-10-01T10:00:00Z' }
] };
const reply = (id, extra = {}) => ({ id, type: 'comment', authorId: 'cx', parentAnswerId: 'answer-1',
  timestamp: '2026-10-02T10:00:00Z', excerpt: '@everyone private reply', ...extra });
const summary = { id: '1', action: 'Follow up with customer', due: '2026-10-05' };
function app(initial = {}) {
  const saved = { supportAuthorId: profileId, 'cases-support': [summary], ...initial };
  const requests = [];
  let respond = async () => ({ ok: true, status: 200 });
  const storage = { get: async (keys) => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys])
    .map((key) => [key, saved[key]]))), set: async (data) => Object.assign(saved, structuredClone(data)) };
  const notifier = createDiscordNotifier(storage, async (url, options) => {
    requests.push({ url, options, payload: JSON.parse(options.body) });
    return respond();
  }, scopeThread);
  return { saved, requests, notifier, setResponse: (response) => { respond = response; } };
}

test('webhook validation permits only HTTPS Discord webhook endpoints and never echoes input', () => {
  assert.equal(validateDiscordWebhook(webhook), webhook);
  for (const value of ['https://example.com/api/webhooks/1/secret', 'http://discord.com/api/webhooks/1/secret',
    'https://discord.com/api/webhooks/1/secret?x=1', 'https://user:pass@discord.com/api/webhooks/1/secret',
    'https://discord.com/api/webhooks/1/secret#fragment', 'invalid-secret']) {
    assert.throws(() => validateDiscordWebhook(value), (error) => !error.message.includes('secret'));
  }
});

test('first check baselines old replies; new CX replies send once without excerpts or mentions', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  const old = { ...base, entries: [...base.entries, reply('comment-old')] };
  await a.notifier.observe(profileId, old, summary);
  assert.equal(a.requests.length, 0);
  const updated = { ...old, entries: [...old.entries, reply('comment-new'), reply('other', { authorId: 'other' }),
    reply('outside', { parentAnswerId: 'answer-other' })] };
  await Promise.all([a.notifier.observe(profileId, updated, summary), a.notifier.observe(profileId, updated, summary)]);
  assert.equal(a.requests.length, 1);
  const sent = a.requests[0];
  assert.match(sent.url, /\?wait=true$/);
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.redirect, 'error');
  assert.deepEqual(sent.payload.allowed_mentions, { parse: [] });
  assert.equal(sent.payload.embeds.length, 1);
  assert.match(sent.payload.embeds[0].url, /#comment-new$/);
  assert.doesNotMatch(JSON.stringify(sent.payload), /private reply/);
});

test('opt-in excerpts, failed-send retry and sanitization of network errors', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook, includeExcerpt: true });
  await a.notifier.observe(profileId, base, summary);
  const updated = { ...base, entries: [...base.entries, reply('new')] };
  a.setResponse(async () => { throw new Error(`Network failed at ${webhook}`); });
  await a.notifier.observe(profileId, updated, summary);
  assert.doesNotMatch(a.saved['discord-status-support'].message, /test_token|webhooks/);
  assert.deepEqual(a.saved['discord-seen-support']['1'], []);
  a.setResponse(async () => ({ ok: true, status: 200 }));
  await a.notifier.observe(profileId, updated, summary);
  assert.equal(a.requests.length, 2);
  assert.match(a.requests[1].payload.embeds[0].description, /private reply/);
  await a.notifier.observe(profileId, updated, summary);
  assert.equal(a.requests.length, 2);
});

test('rate limits prevent repeated sends until the retry window and preserve unsent replies', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, base, summary);
  a.setResponse(async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 600 }) }));
  const updated = { ...base, entries: [...base.entries, reply('new')] };
  await a.notifier.observe(profileId, updated, summary);
  await a.notifier.observe(profileId, updated, summary);
  assert.equal(a.requests.length, 1);
  assert.ok(a.saved['discord-status-support'].retryAt > Date.now());
  assert.deepEqual(a.saved['discord-seen-support']['1'], []);
});

test('removed cases, inactive profiles and incomplete pages send nothing', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, { ...base, hasMorePages: true }, summary);
  assert.deepEqual(a.saved['discord-seen-support'], {});
  await a.notifier.observe(profileId, base, summary);
  const updated = { ...base, entries: [...base.entries, reply('new')] };
  a.saved.supportAuthorId = 'other';
  await a.notifier.observe(profileId, updated, summary);
  a.saved.supportAuthorId = profileId;
  a.saved['cases-support'] = [];
  await a.notifier.observe(profileId, updated, summary);
  assert.equal(a.requests.length, 0);
});

test('test sends only after an explicit request and reconnect establishes a new baseline', async () => {
  const a = app();
  await a.notifier.configure(profileId, { enabled: false, webhook });
  assert.equal(a.requests.length, 0);
  await a.notifier.test(profileId);
  assert.equal(a.requests.length, 1);
  assert.match(a.requests[0].payload.embeds[0].description, /No case data/);
  await a.notifier.configure(profileId, { enabled: true, webhook });
  await a.notifier.observe(profileId, { ...base, entries: [...base.entries, reply('old')] }, summary);
  assert.equal(a.requests.length, 1);
  await a.notifier.configure(profileId, { enabled: false, webhook: '' });
  assert.equal(a.saved['discord-support'].webhook, '');
});

test('Developer Community reply alerts stay site-scoped after Learn becomes active', async () => {
  const a = app({ supportSite: 'devcommunity', supportProfiles: { learn: { id: 'learn-user' }, devcommunity: { id: profileId } },
    'cases-devcommunity-support': [summary] });
  await a.notifier.configure(profileId, { enabled: true, webhook });
  const thread = { ...base, url: 'https://developercommunity.visualstudio.com/t/sample/1' };
  await a.notifier.observe(profileId, thread, summary, 'devcommunity');
  a.saved.supportSite = 'learn';
  const updated = { ...thread, entries: [...thread.entries, reply('community-reply')] };
  await a.notifier.observe(profileId, updated, summary, 'devcommunity');
  assert.equal(a.requests.length, 1);
  assert.match(a.requests[0].payload.embeds[0].url, /^https:\/\/developercommunity\.visualstudio\.com\/t\/sample\/1#community-reply$/);
  assert.deepEqual(a.saved['discord-seen-devcommunity-support']['1'], ['community-reply']);
  assert.equal(a.saved['discord-seen-support'], undefined);
});
