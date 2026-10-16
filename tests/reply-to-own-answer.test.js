const test = require('node:test');
const assert = require('node:assert/strict');
const { planAction, scopeThread } = require('../src/core/engine');
const { caseSummary, calendarWeek } = require('../src/features/cases/dashboard');
const { createDiscordNotifier } = require('../src/features/discord/discord');
const { createTeamsNotifier } = require('../src/features/teams/teams');

const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
const url = 'https://learn.microsoft.com/en-us/answers/questions/6039276/azure-devops-clone-fails-in-visual-studio-unable-t';
const base = { id: '6039276', url, title: 'Azure DevOps clone fails in Visual Studio', entries: [
  { id: 'question-6039276', type: 'question', authorId: '0477a92f-3239-44f4-a66c-f437a920be48',
    author: 'Kumar, Sonbir', timestamp: '2026-10-15T19:25:29Z' },
  { id: 'answer-13003540', type: 'answer', authorId: profileId,
    timestamp: '2026-10-16T03:37:20Z' }
] };
const reply = { id: 'comment-2851445', type: 'comment', parentAnswerId: 'answer-13003540',
  authorId: 'dc1bc889-6d67-49e0-96bb-1cc4dafe3846', author: 'Mr Sonbir',
  timestamp: '2026-10-16T04:18:22Z' };
const updated = { ...base, entries: [...base.entries, reply] };

function notifier(create, webhook) {
  const saved = { supportSite: 'learn', supportProfiles: { learn: { id: profileId } },
    [`cases-${profileId}`]: [{ id: base.id, action: 'Follow up with customer', due: '2026-10-19' }] };
  const requests = [];
  const storage = { get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
    .map((key) => [key, structuredClone(saved[key])])),
  set: async (values) => Object.assign(saved, structuredClone(values)) };
  const service = create(storage, async (_, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 202 };
  }, scopeThread);
  return { service, requests, settings: { enabled: true, webhook } };
}

test('different account replying directly to the support answer requires follow-up in Calendar', () => {
  const scoped = scopeThread(updated, profileId);
  assert.equal(scoped.entries.find((entry) => entry.id === reply.id).customerReply, true);
  const result = planAction(updated, { supportAuthorId: profileId, actions: {} }, new Date('2026-10-16T12:00:00'));
  assert.equal(result.action, 'Follow up with customer');
  assert.equal(result.due, '2026-10-19');
  const summary = caseSummary(updated, result, '2026-10-16T05:00:00Z', profileId);
  const days = calendarWeek([summary], new Date('2026-10-16T12:00:00'), new Date('2026-10-16T12:00:00'));
  assert.ok(days.find((day) => day.key === '2026-10-16').events.some((event) =>
    event.kind === 'reply' && event.item.id === base.id));
  const nextWeek = calendarWeek([summary], new Date('2026-10-19T12:00:00'), new Date('2026-10-16T12:00:00'));
  assert.ok(nextWeek.find((day) => day.key === '2026-10-19').events.some((event) => event.kind === 'due'));
});

test('different account reply under another support answer stays outside this conversation', () => {
  const elsewhere = { ...updated, entries: [...base.entries,
    { id: 'answer-other', type: 'answer', authorId: 'other', timestamp: '2026-10-16T03:40:00Z' },
    { ...reply, parentAnswerId: 'answer-other' }] };
  assert.equal(scopeThread(elsewhere, profileId).entries.some((entry) => entry.id === reply.id), false);
  assert.equal(planAction(elsewhere, { supportAuthorId: profileId, actions: {} },
    new Date('2026-10-16T12:00:00')).action, 'Post first strike comment');
  const unrelated = { ...base, entries: [...base.entries, { ...reply, author: 'Unrelated Visitor' }] };
  assert.equal(scopeThread(unrelated, profileId).entries.some((entry) => entry.id === reply.id), false);
});

test('Teams and Discord notify once for a new reply from a different account on the support answer', async () => {
  const teams = notifier(createTeamsNotifier,
    'https://prod-01.westeurope.logic.azure.com/workflows/1234abcd/triggers/manual/paths/invoke?sig=test');
  const discord = notifier(createDiscordNotifier, 'https://discord.com/api/webhooks/123/test_token');
  for (const channel of [teams, discord]) {
    await channel.service.configure(profileId, channel.settings);
    await channel.service.observe(profileId, base, null, 'learn');
    await channel.service.observe(profileId, updated, null, 'learn');
    await channel.service.observe(profileId, updated, null, 'learn');
    assert.equal(channel.requests.length, 1);
  }
  assert.match(teams.requests[0].attachments[0].content.actions[0].url, /#comment-2851445$/);
  assert.match(discord.requests[0].embeds[0].url, /#comment-2851445$/);
});
