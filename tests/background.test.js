const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { source, sourcePath } = require('./helpers');
const vm = require('node:vm');

const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
const url = 'https://learn.microsoft.com/en-us/answers/questions/1234/test';
const dueCase = { id: '1234', url, title: 'Test case', action: 'Post first strike comment',
  due: '2026-09-30', tone: 'today', checkedAt: '2026-09-29T12:00:00Z' };
const thread = { id: '1234', url, title: 'Test case', entries: [
  { id: 'question-1234', type: 'question', authorId: 'customer', timestamp: '2026-09-25T11:00:00Z' },
  { id: 'answer-1', type: 'answer', authorId: profileId, timestamp: '2026-09-25T12:00:00Z' }
] };

function background(initial) {
  const saved = { ...initial };
  const listeners = {};
  const notifications = [];
  const badges = [];
  const colors = [];
  const alarms = [];
  let clock = '2026-09-30T12:00:00Z';
  let currentThread = thread;
  let readError;
  let parserCreated = false;
  const chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
          .filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]])),
        set: async (values) => Object.assign(saved, values)
      },
      onChanged: { addListener: (listener) => { listeners.changed = listener; } }
    },
    action: {
      setBadgeText: async ({ text }) => { badges.push(text); },
      setBadgeBackgroundColor: async ({ color }) => { colors.push(color); },
      setTitle: async () => {}
    },
    alarms: {
      get: async () => null,
      create: async (name, options) => { alarms.push({ name, options }); },
      onAlarm: { addListener: (listener) => { listeners.alarm = listener; } }
    },
    runtime: {
      id: 'test',
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => parserCreated ? [{}] : [],
      sendMessage: async ({ type }) => type === 'icon' ? { iconUrl: 'data:image/png;base64,test' }
        : readError ? { error: readError } : { thread: currentThread },
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } }
    },
    offscreen: { createDocument: async () => { parserCreated = true; } },
    notifications: {
      create: async (id, details) => { notifications.push({ id, details }); },
      onClicked: { addListener: (listener) => { listeners.clicked = listener; } }
    },
    tabs: { create: async (details) => { listeners.opened = details; } }
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return Date.parse(clock); }
  }
  const context = vm.createContext({ chrome, Date: FixedDate, URL, console,
    importScripts: (...files) => files.forEach((file) => vm.runInContext(readFileSync(resolve(dirname(sourcePath('background.js')), file), 'utf8'), context)) });
  vm.runInContext(source('background.js'), context);
  return { context, saved, listeners, notifications, badges, colors, alarms,
    setThread: (next) => { currentThread = next; }, setError: (error) => { readError = error; },
    setNow: (value) => { clock = value; } };
}

test('five-minute checks refresh saved cases, update badges, notify once per action per day, and open the list', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase], [`reminders-${profileId}`]: true });
  await app.context.refreshSavedCases();
  assert.equal(app.saved[`cases-${profileId}`][0].action, 'Post first strike comment');
  assert.equal(app.badges.at(-1), '1');
  assert.equal(app.notifications.length, 1);
  assert.match(app.notifications[0].details.message, /1234 - Test case/);
  assert.equal(app.alarms[0].options.periodInMinutes, 5);
  await app.context.refreshSavedCases();
  assert.equal(app.notifications.length, 1);
  app.setThread({ ...thread, entries: [...thread.entries,
    { id: 'comment-2', type: 'comment', authorId: 'customer', parentAnswerId: 'answer-1', timestamp: '2026-09-29T12:00:00Z' }] });
  await app.context.refreshSavedCases();
  assert.equal(app.saved[`cases-${profileId}`][0].action, 'Follow up with customer');
  assert.equal(app.notifications.length, 2);
  app.listeners.clicked(`forum-due-${profileId}`);
  assert.equal(app.listeners.opened.url, 'chrome-extension://test/src/ui/popup/popup.html');
});

test('notifications stay optional and failed checks preserve the last known case without alerting', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase] });
  app.setError('Network unavailable');
  await app.context.refreshSavedCases();
  assert.equal(app.saved[`cases-${profileId}`][0].action, dueCase.action);
  assert.equal(app.saved[`cases-${profileId}`][0].error, 'Network unavailable');
  assert.equal(app.badges.at(-1), '1');
  assert.equal(app.notifications.length, 0);
  app.saved[`reminders-${profileId}`] = true;
  await app.context.refreshSavedCases();
  assert.equal(app.notifications.length, 0);
  app.saved[`cases-${profileId}`] = [];
  await app.context.updateBadge();
  assert.equal(app.badges.at(-1), '');
});
test('a new customer reply alerts before its deadline, then flags the next day red if unanswered', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase], [`reminders-${profileId}`]: true });
  app.setThread({ ...thread, entries: [...thread.entries,
    { id: 'comment-3', type: 'comment', authorId: 'customer', parentAnswerId: 'answer-1',
      timestamp: '2026-09-30T10:00:00Z' }] });
  await app.context.refreshSavedCases();
  assert.equal(app.saved[`cases-${profileId}`][0].action, 'Follow up with customer');
  assert.equal(app.saved[`cases-${profileId}`][0].due, '2026-10-01');
  assert.equal(app.badges.at(-1), '1');
  assert.equal(app.colors.at(-1), '#b37400');
  assert.equal(app.notifications.length, 1);
  app.setNow('2026-10-01T12:00:00Z');
  await app.context.refreshSavedCases();
  assert.equal(app.colors.at(-1), '#d76154');
  assert.equal(app.notifications.length, 2);
});

test('startup migrates an existing hourly alarm to five minutes', async () => {
  const app = background({ supportAuthorId: profileId });
  await new Promise((resolve) => setImmediate(resolve));
  app.context.chrome.alarms.get = async () => ({ periodInMinutes: 60 });
  await app.context.start();
  assert.equal(app.alarms.at(-1).options.periodInMinutes, 5);
  const count = app.alarms.length;
  app.context.chrome.alarms.get = async () => ({ periodInMinutes: 5 });
  await app.context.start();
  assert.equal(app.alarms.length, count);
});

test('overlapping checks share one fetch and removed cases are not restored or notified', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase], [`reminders-${profileId}`]: true });
  let release;
  let reads = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  app.context.parserMessage = async (type) => {
    if (type === 'icon') return { iconUrl: 'data:image/png;base64,test' };
    reads++;
    return blocked;
  };
  const first = app.context.refreshSavedCases();
  const second = app.context.refreshSavedCases();
  await new Promise((resolve) => setImmediate(resolve));
  await vm.runInContext(`changeCase({ type: 'remove', profileId: '${profileId}', id: '${dueCase.id}' })`, app.context);
  release({ thread });
  await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(app.saved[`cases-${profileId}`].length, 0);
  assert.equal(app.notifications.length, 0);
});

test('notification candidates are revalidated after other cases have been checked', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase], [`reminders-${profileId}`]: true });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  app.context.parserMessage = async () => blocked;
  const notification = app.context.notifyDueCases(profileId, [dueCase]);
  await new Promise((resolve) => setImmediate(resolve));
  await vm.runInContext(`changeCase({ type: 'remove', profileId: '${profileId}', id: '${dueCase.id}' })`, app.context);
  release({ iconUrl: 'data:image/png;base64,test' });
  await notification;
  assert.equal(app.notifications.length, 0);
});

test('popup mutation messages use the same serialized store and reject foreign senders', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase] });
  const message = { target: 'forum-case-store', type: 'remove', profileId, id: dueCase.id };
  assert.equal(app.listeners.message(message, { id: 'foreign-extension' }, () => {}), undefined);
  assert.equal(app.saved[`cases-${profileId}`].length, 1);
  const result = await new Promise((resolve) => {
    assert.equal(app.listeners.message(message, { id: 'test' }, resolve), true);
  });
  assert.equal(result.applied, true);
  assert.equal(app.saved[`cases-${profileId}`].length, 0);
});

test('Discord background checks baseline then send newly observed customer replies once', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase] });
  const sends = [];
  app.context.AbortSignal = AbortSignal;
  app.context.fetch = async (url, options) => {
    sends.push(JSON.parse(options.body));
    return { ok: true, status: 200 };
  };
  const receive = (message) => new Promise((resolve) => app.listeners.message(message, { id: 'test' }, resolve));
  const configured = await receive({ target: 'forum-discord', type: 'configure', profileId,
    settings: { enabled: true, webhook: 'https://discord.com/api/webhooks/123/test_token' } });
  assert.equal(configured.ok, true);
  assert.equal(sends.length, 0);
  await app.context.refreshSavedCases();
  assert.equal(sends.length, 0);
  app.setThread({ ...thread, entries: [...thread.entries, { id: 'comment-new', type: 'comment',
    authorId: 'customer', parentAnswerId: 'answer-1', timestamp: '2026-09-30T10:00:00Z', excerpt: 'Private excerpt' }] });
  await app.context.refreshSavedCases();
  assert.equal(sends.length, 1);
  assert.match(sends[0].embeds[0].url, /#comment-new$/);
  assert.doesNotMatch(JSON.stringify(sends[0]), /Private excerpt/);
  await app.context.refreshSavedCases();
  assert.equal(sends.length, 1);
  const tested = await receive({ target: 'forum-discord', type: 'test', profileId });
  assert.equal(tested.ok, true);
  assert.equal(sends.length, 2);
});

test('manual popup observations use the same Discord history and sending errors do not fail case storage', async () => {
  const app = background({ supportAuthorId: profileId, [`cases-${profileId}`]: [dueCase] });
  app.context.AbortSignal = AbortSignal;
  let sends = 0;
  app.context.fetch = async () => { sends++; throw new Error('network failure secret-url'); };
  const receive = (message) => new Promise((resolve) => app.listeners.message(message, { id: 'test' }, resolve));
  await receive({ target: 'forum-discord', type: 'configure', profileId,
    settings: { enabled: true, webhook: 'https://discord.com/api/webhooks/123/test_token' } });
  await app.context.refreshSavedCases();
  const updated = { ...thread, entries: [...thread.entries, { id: 'new', type: 'comment',
    authorId: 'customer', parentAnswerId: 'answer-1', timestamp: '2026-09-30T10:00:00Z' }] };
  const result = await receive({ target: 'forum-case-store', type: 'update', profileId, id: thread.id,
    expected: app.saved[`cases-${profileId}`][0], summary: dueCase, thread: updated });
  assert.equal(result.applied, true);
  assert.equal(sends, 1);
  assert.doesNotMatch(app.saved[`discord-status-${profileId}`].message, /secret-url/);
  assert.equal(app.saved[`cases-${profileId}`].length, 1);
});
