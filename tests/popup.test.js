const test = require('node:test');
const assert = require('node:assert/strict');
const { source, loadPopup } = require('./helpers');
const vm = require('node:vm');
const { createCaseStore } = require('../src/features/cases/case-store');

class Element {
  constructor() { this.children = []; this.handlers = {}; this.textContent = ''; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  focus() { this.focused = true; }
}

test('profile setup, linked evidence, saved cases and per-profile isolation in the popup', async () => {
  const elements = new Map();
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element()
  };
  const saved = {};
  const chrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
        .filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]])),
      set: async (values) => Object.assign(saved, values)
    } },
    tabs: { query: async () => [] }
  };
  const changeCase = createCaseStore(chrome.storage.local);
  chrome.runtime = { sendMessage: async (change) => changeCase(change) };
  const context = vm.createContext({ document, chrome, URL, Date, encodeURIComponent });
  loadPopup(context);
  await new Promise((resolve) => setImmediate(resolve));
  const get = document.getElementById;
  assert.equal(get('profile-section').open, true);
  const brian = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  get('profile-input').value = `https://learn.microsoft.com/en-us/users/na/?userid=${brian}`;
  await get('profile-form').handlers.submit({ preventDefault() {} });
  assert.equal(saved.supportAuthorId, brian);
  assert.equal(get('desktop-reminders').checked, false);
  get('desktop-reminders').checked = true;
  await get('desktop-reminders').handlers.change();
  assert.equal(saved[`reminders-${brian}`], true);

  const example = { id: '1234', url: 'https://learn.microsoft.com/en-us/answers/questions/1234/example', title: 'Test thread',
    entries: [
      { id: 'question-1234', type: 'question', authorId: 'customer', timestamp: '2026-09-25T12:00:00Z', author: 'Customer' },
      { id: 'answer-101', type: 'answer', authorId: brian, timestamp: '2026-09-25T12:30:00Z', author: 'Brian' }
    ] };
  context.example = example;
  vm.runInContext('readThread = async () => example', context);
  await vm.runInContext('loadThread(example.url)', context);
  assert.equal(get('title').textContent, '1234 - Test thread');
  assert.equal(get('stage').textContent, 'Stage: First answer; no customer reply');
  const result = get('result');
  assert.ok(result.children.some((child) => child.textContent.includes('Calculated due date:')));
  assert.ok(result.children.some((child) => child.textContent.includes('Predicted close day:')));
  const explanation = result.children.find((child) => child.className === 'disclosure');
  assert.equal(explanation.children[0].textContent, 'Why this date?');
  assert.notEqual(explanation.open, true);
  const evidence = explanation.children.find((child) => child.className === 'evidence');
  assert.equal(evidence.children[0].children[0].href, `${example.url}#answer-101`);

  await get('save-case').handlers.click();
  assert.equal(saved[`cases-${brian}`].length, 1);
  assert.equal(saved[`cases-${brian}`][0].entries, undefined);
  assert.equal(get('case-count').textContent, 1);
  const findGroup = (title) => get('case-list').children.find((group) => group.children[0].textContent.startsWith(title));
  assert.equal(findGroup('Strike cases').children.length, 2);
  assert.equal(findGroup('Close cases').children.length, 2);
  assert.equal(findGroup('Strike cases').children[1].children[0].textContent, '1234 - Test thread');

  context.example = { ...example, entries: [...example.entries,
    { id: 'comment-200', type: 'comment', authorId: brian, parentAnswerId: 'answer-101',
      timestamp: '2026-09-30T12:00:00Z', author: 'Brian' }] };
  await vm.runInContext('loadThread(example.url)', context);
  assert.equal(saved[`cases-${brian}`][0].action, 'Send last quality response');
  assert.equal(findGroup('Strike cases').children.length, 2);
  assert.equal(findGroup('Close cases').children[1].children[0].textContent, '1234 - Test thread');

  context.example = { ...example, entries: [...example.entries,
    { id: 'comment-201', type: 'comment', authorId: 'customer', parentAnswerId: 'answer-101',
      timestamp: '2026-09-29T12:00:00Z', author: 'Customer' }] };
  await get('refresh-cases').handlers.click();
  assert.equal(saved[`cases-${brian}`][0].action, 'Follow up with customer');
  assert.match(get('result').children[0].textContent, /Follow up with customer/);
  assert.equal(findGroup('Strike cases').children.length, 2);
  assert.equal(findGroup('Customer follow-up').children[1].children[0].textContent, '1234 - Test thread');
  vm.runInContext('readThread = async () => { throw new Error("Network unavailable"); }', context);
  await get('refresh-cases').handlers.click();
  assert.equal(saved[`cases-${brian}`][0].action, 'Follow up with customer');
  assert.equal(saved[`cases-${brian}`][0].error, 'Network unavailable');
  assert.ok(findGroup('Customer follow-up').children[1].children[1].textContent.startsWith('Last known'));

  context.example = { ...example, entries: [...example.entries,
    { id: 'comment-2834374', type: 'comment', authorId: brian, parentAnswerId: 'answer-101',
      timestamp: '2026-10-01T03:08:33Z', author: 'Brian' }] };
  vm.runInContext('readThread = async () => example', context);
  await get('refresh-thread').handlers.click();
  assert.match(get('result').children[0].textContent, /Send last quality response/);
  assert.equal(get('stage').textContent, 'Stage: First answer; no customer reply');
  assert.equal(saved[`cases-${brian}`][0].action, 'Send last quality response');

  const colleague = '12345678-1234-1234-1234-123456789abc';
  get('profile-input').value = colleague;
  await get('profile-form').handlers.submit({ preventDefault() {} });
  assert.equal(get('case-count').textContent, 0);
  assert.equal(saved[`cases-${brian}`].length, 1);
  assert.equal(get('save-case').disabled, false);
  assert.equal(get('desktop-reminders').checked, false);
  await get('save-case').handlers.click();
  const reviewCard = findGroup('Needs review').children[1];
  const remove = reviewCard.children[3];
  const confirm = reviewCard.children[4];
  const warning = reviewCard.children[5];
  await confirm.handlers.click();
  assert.equal(saved[`cases-${colleague}`].length, 1);
  await remove.handlers.click();
  assert.equal(remove.textContent, 'Cancel');
  assert.equal(confirm.hidden, false);
  assert.equal(warning.hidden, false);
  assert.equal(saved[`cases-${colleague}`].length, 1);
  await remove.handlers.click();
  assert.equal(remove.textContent, 'Remove');
  assert.equal(confirm.hidden, true);
  assert.equal(saved[`cases-${colleague}`].length, 1);
  saved[`thread-${colleague}-1234`] = { supportAuthorId: colleague, actions: {} };
  await remove.handlers.click();
  await confirm.handlers.click();
  assert.equal(saved[`cases-${colleague}`].length, 0);
  assert.equal(get('case-count').textContent, 0);
  assert.ok(saved[`thread-${colleague}-1234`]);
  assert.equal(saved[`cases-${brian}`].length, 1);
});

test('opening the popup checks saved cases automatically and keeps manual refresh available', async () => {
  const elements = new Map();
  let onStorageChange;
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element()
  };
  const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const url = 'https://learn.microsoft.com/en-us/answers/questions/1234/example';
  const saved = {
    supportAuthorId: profileId,
    [`cases-${profileId}`]: [{ id: '1234', url, title: 'Test thread', action: 'Post first strike comment',
      due: '2026-10-01', tone: 'upcoming', checkedAt: '2026-09-29T12:00:00Z' }]
  };
  const chrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
        .filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]])),
      set: async (values) => Object.assign(saved, values)
    }, onChanged: { addListener: (listener) => { onStorageChange = listener; } } },
    tabs: { query: async () => [] }
  };
  const changeCase = createCaseStore(chrome.storage.local);
  chrome.runtime = { sendMessage: async (change) => changeCase(change) };
  const context = vm.createContext({ document, chrome, URL, Date, encodeURIComponent });
  loadPopup(context);
  context.example = { id: '1234', url, title: 'Test thread', entries: [
    { id: 'question-1234', type: 'question', authorId: 'customer', timestamp: '2026-09-25T12:00:00Z' },
    { id: 'answer-101', type: 'answer', authorId: profileId, timestamp: '2026-09-25T12:30:00Z' },
    { id: 'comment-201', type: 'comment', authorId: 'customer', parentAnswerId: 'answer-101',
      timestamp: '2026-09-29T12:00:00Z' }
  ] };
  vm.runInContext('readThread = async () => example', context);
  await new Promise((resolve) => setImmediate(resolve));
  const get = document.getElementById;
  assert.equal(saved[`cases-${profileId}`][0].action, 'Follow up with customer');
  assert.equal(get('refresh-cases').disabled, false);
  assert.match(get('message').textContent, /Checked 1 case\(s\): 1 updated, 0 failed/);
  assert.ok(get('case-list').children.some((group) => group.children[0].textContent.startsWith('Customer follow-up')));
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...saved[`cases-${profileId}`][0],
    action: 'Send last quality response' }] } }, 'local');
  assert.ok(get('case-list').children.some((group) => group.children[0].textContent.startsWith('Close cases (last response due)') && group.children.length === 2));
  const today = new Date();
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const caseData = saved[`cases-${profileId}`][0];
  const calendarRows = () => get('calendar-days').children;
  const todayKey = localDate(today);
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, due: todayKey,
    action: 'Post first strike comment', lastSupportPost: null }] } }, 'local');
  const todayRow = calendarRows().find((row) => row.children[0].children[1].dateTime === todayKey);
  assert.ok(todayRow);
  assert.match(todayRow.children[1].children[0].children[1].textContent, /Strike 1 due/);
  assert.equal(todayRow.children[1].children[0].children[0].href, url);
  assert.equal(get('calendar-agenda-list').children[0].children[0].textContent, '1234 - Test thread');
  assert.match(get('calendar-agenda-list').children[0].children[1].textContent, /Calculated due: Strike 1 - Not complete/);
  const otherDay = calendarRows().find((row) => row !== todayRow);
  await otherDay.children[0].handlers.click();
  assert.match(otherDay.children[0].ariaLabel, /Show/);
  assert.equal(get('calendar-agenda-list').children[0].textContent, 'No case actions on this day.');
  await get('calendar-current').handlers.click();
  assert.equal(get('calendar-agenda-list').children[0].children[0].textContent, '1234 - Test thread');
  const range = get('calendar-range').textContent;
  await get('calendar-next').handlers.click();
  assert.notEqual(get('calendar-range').textContent, range);
  await get('calendar-previous').handlers.click();
  assert.equal(get('calendar-range').textContent, range);
  await get('calendar-next').handlers.click();
  await get('calendar-current').handlers.click();
  assert.equal(get('calendar-range').textContent, range);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, due: localDate(tomorrow),
    action: 'Follow up with customer', lastSupportPost: { timestamp: today.toISOString(), type: 'answer' } }] } }, 'local');
  assert.match(get('today-list').children[0].children[1].textContent, /Customer follow-up - Not complete.*Respond now/);
  assert.match(calendarRows().find((row) => row.children[0].children[1].dateTime === todayKey).children[1].children[0].children[1].textContent, /Respond now/);
  assert.match(get('calendar-agenda-list').children[0].children[1].textContent, /Customer replied - respond now/);
  assert.equal(get('today-list').children[0].className, 'case-item reply');
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, due: localDate(today),
    action: 'Follow up with customer' }] } }, 'local');
  assert.match(get('today-list').children[0].children[1].textContent, /Customer follow-up - Not complete.*RED WARNING/);
  assert.equal(get('today-list').children[0].className, 'case-item urgent');
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, due: localDate(today),
    action: 'Post first strike comment' }] } }, 'local');
  assert.match(get('today-list').children[0].children[1].textContent, /Strike 1 - Not complete.*Due today/);
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, due: localDate(today),
    action: 'Send last quality response', lastSupportPost: { timestamp: today.toISOString(), type: 'comment', step: 'Strike 1' } }] } }, 'local');
  assert.match(get('today-list').children[0].children[1].textContent, /Strike 1 - Complete/);
  assert.match(get('today-list').children[0].children[2].textContent, /Close step \(final response\) - Not complete/);
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, action: 'Strike flow complete - verify CI closure', due: null, tone: 'completed',
    lastSupportPost: { timestamp: today.toISOString(), type: 'comment', step: 'Close step (final response)' } }] } }, 'local');
  assert.match(get('today-list').children[0].children[1].textContent, /Close step \(final response\) - Complete.*CI closure unverified/);
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, action: 'Strike flow complete - verify CI closure', due: null, tone: 'completed',
    lastSupportPost: { timestamp: today.toISOString(), type: 'comment' } }] } }, 'local');
  assert.match(get('today-list').children[0].children[1].textContent, /Comment posted - step not confirmed/);
  onStorageChange({ [`cases-${profileId}`]: { newValue: [{ ...caseData, due: null, tone: 'completed' }] } }, 'local');
  assert.equal(get('today-list').children[0].textContent, 'No action scheduled today from saved cases.');
});

test('Refresh cases rereads every saved link and keeps failed checks visibly marked', async () => {
  const elements = new Map();
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element()
  };
  const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const links = ['1234', '5678'].map((id) => `https://learn.microsoft.com/en-us/answers/questions/${id}/example`);
  const saved = { supportAuthorId: profileId, [`cases-${profileId}`]: links.map((url, index) => ({
    id: index ? '5678' : '1234', url, title: `Case ${index + 1}`, action: 'Post first strike comment',
    due: '2026-10-01', tone: 'today', checkedAt: '2026-09-29T12:00:00Z'
  })) };
  const chrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
        .filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]])),
      set: async (values) => Object.assign(saved, values)
    } },
    tabs: { query: async () => [] }
  };
  const changeCase = createCaseStore(chrome.storage.local);
  chrome.runtime = { sendMessage: async (change) => changeCase(change) };
  const context = vm.createContext({ document, chrome, URL, Date, encodeURIComponent });
  loadPopup(context);
  await new Promise((resolve) => setImmediate(resolve));
  const readLinks = [];
  context.readLinks = readLinks;
  vm.runInContext(`readThread = async (url) => {
    readLinks.push(url);
    if (url.includes('/5678/')) throw new Error('Network unavailable');
    return { id: '1234', url, title: 'Case 1', entries: [
      { id: 'question-1234', type: 'question', authorId: 'customer', timestamp: '2026-09-25T12:00:00Z' },
      { id: 'answer-101', type: 'answer', authorId: '${profileId}', timestamp: '2026-09-25T13:00:00Z' },
      { id: 'comment-201', type: 'comment', authorId: 'customer', parentAnswerId: 'answer-101',
        timestamp: '2026-09-30T12:00:00Z' }
    ] };
  }`, context);
  await document.getElementById('refresh-cases').handlers.click();
  assert.deepEqual(readLinks, links);
  assert.equal(saved[`cases-${profileId}`][0].action, 'Follow up with customer');
  assert.ok(saved[`cases-${profileId}`][0].checkedAt !== '2026-09-29T12:00:00Z');
  assert.equal(saved[`cases-${profileId}`][1].action, 'Post first strike comment');
  assert.equal(saved[`cases-${profileId}`][1].error, 'Network unavailable');
  assert.match(document.getElementById('case-list').children.find((group) =>
    group.children[0].textContent.startsWith('Strike cases')).children[1].children[2].textContent, /Refresh failed: Network unavailable/);
  assert.match(document.getElementById('message').textContent, /2 case\(s\): 1 updated, 1 failed/);
  assert.equal(document.getElementById('retry-cases').hidden, false);
  readLinks.length = 0;
  vm.runInContext(`readThread = async (url) => {
    readLinks.push(url);
    return { id: '5678', url, title: 'Case 2', entries: [
      { id: 'question-5678', type: 'question', authorId: 'customer', timestamp: '2026-09-25T12:00:00Z' },
      { id: 'answer-5678', type: 'answer', authorId: '${profileId}', timestamp: '2026-09-25T13:00:00Z' }
    ] };
  }`, context);
  await document.getElementById('retry-cases').handlers.click();
  assert.deepEqual(readLinks, [links[1]]);
  assert.equal(saved[`cases-${profileId}`][1].error, undefined);
  assert.equal(document.getElementById('retry-cases').hidden, true);
  assert.match(document.getElementById('message').textContent, /1 case\(s\): 1 updated, 0 failed/);
  assert.equal(document.getElementById('refresh-progress').hidden, true);
});

async function racePopup() {
  const elements = new Map();
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element()
  };
  const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const saved = { supportAuthorId: profileId };
  let changed;
  const local = {
    get: async (keys) => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys])
      .filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]]))),
    set: async (values) => Object.assign(saved, structuredClone(values))
  };
  const changeCase = createCaseStore(local);
  const chrome = {
    storage: { local, onChanged: { addListener: (listener) => { changed = listener; } } },
    runtime: { sendMessage: async (change) => changeCase(structuredClone(change)) },
    tabs: { query: async () => [] }
  };
  const context = vm.createContext({ document, chrome, URL, Date, encodeURIComponent });
  loadPopup(context);
  await new Promise((resolve) => setImmediate(resolve));
  const thread = (id) => ({ id, url: `https://learn.microsoft.com/en-us/answers/questions/${id}/example`, title: `Thread ${id}`,
    entries: [
      { id: `question-${id}`, type: 'question', authorId: 'customer', timestamp: '2026-09-25T12:00:00Z' },
      { id: `answer-${id}`, type: 'answer', authorId: profileId, timestamp: '2026-09-25T13:00:00Z' }
    ] });
  return { context, chrome, saved, document, profileId, thread, changeCase,
    changed: (cases) => changed({ [`cases-${profileId}`]: { newValue: cases } }, 'local') };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a slower old request or old failure cannot replace the latest thread selection', async () => {
  const app = await racePopup();
  const old = deferred();
  app.context.readThread = (url) => url.includes('/1234/') ? old.promise : Promise.resolve(app.thread('5678'));
  const first = app.context.loadThread(app.thread('1234').url);
  await app.context.loadThread(app.thread('5678').url);
  old.resolve(app.thread('1234'));
  await first;
  assert.equal(app.document.getElementById('title').textContent, '5678 - Thread 5678');
  const failed = deferred();
  app.context.readThread = (url) => url.includes('/1234/') ? failed.promise : Promise.resolve(app.thread('5678'));
  const second = app.context.loadThread(app.thread('1234').url);
  await app.context.loadThread(app.thread('5678').url);
  failed.reject(new Error('Old request failed'));
  await second;
  assert.equal(app.document.getElementById('thread').hidden, false);
  assert.equal(app.document.getElementById('message').textContent, '');
});

test('an old settings load cannot mix corrections into a newer thread', async () => {
  const app = await racePopup();
  const blocked = deferred();
  const originalGet = app.chrome.storage.local.get;
  app.chrome.storage.local.get = (keys) => Array.isArray(keys) && keys.includes(`thread-${app.profileId}-1234`)
    ? blocked.promise : originalGet(keys);
  app.context.readThread = async (url) => app.thread(url.includes('/1234/') ? '1234' : '5678');
  const first = app.context.loadThread(app.thread('1234').url);
  await new Promise((resolve) => setImmediate(resolve));
  await app.context.loadThread(app.thread('5678').url);
  blocked.resolve({ [`thread-${app.profileId}-1234`]: { actions: { 'answer-5678': 'ignore' } } });
  await first;
  assert.equal(app.document.getElementById('title').textContent, '5678 - Thread 5678');
  assert.match(app.document.getElementById('result').children[0].textContent, /Post first strike comment/);
});

test('profile transitions ignore old correction controls and preserve the new profile settings', async () => {
  const app = await racePopup();
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  const oldSelect = app.document.getElementById('entries').children[1].children.at(-1);
  const nextId = '12345678-1234-1234-1234-123456789abc';
  const key = `thread-${nextId}-1234`;
  app.saved[key] = { supportAuthorId: nextId, actions: { existing: 'ignore' } };
  const blocked = deferred();
  const originalGet = app.chrome.storage.local.get;
  app.chrome.storage.local.get = (keys) => Array.isArray(keys) && keys.includes(key) ? blocked.promise : originalGet(keys);
  app.document.getElementById('profile-input').value = nextId;
  const transition = app.document.getElementById('profile-form').handlers.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  oldSelect.value = 'strike';
  oldSelect.handlers.change();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.saved[key].actions, { existing: 'ignore' });
  blocked.resolve({ [key]: structuredClone(app.saved[key]) });
  await transition;
  oldSelect.handlers.change();
  assert.deepEqual(app.saved[key].actions, { existing: 'ignore' });
});

test('removing a case during a popup refresh does not resurrect it', async () => {
  const app = await racePopup();
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  await app.document.getElementById('save-case').handlers.click();
  const blocked = deferred();
  app.context.readThread = () => blocked.promise;
  const refresh = app.context.refreshSavedCases();
  await app.changeCase({ type: 'remove', profileId: app.profileId, id: '1234' });
  app.changed([]);
  blocked.resolve(app.thread('1234'));
  await refresh;
  assert.deepEqual(app.saved[`cases-${app.profileId}`], []);
  assert.equal(app.document.getElementById('case-count').textContent, 0);
});

test('background summary changes reread the visible thread without a storage refresh loop', async () => {
  const app = await racePopup();
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  await app.document.getElementById('save-case').handlers.click();
  let reads = 0;
  app.context.readThread = async () => {
    reads++;
    const updated = app.thread('1234');
    updated.entries.push({ id: 'comment-3', type: 'comment', authorId: 'customer',
      parentAnswerId: 'answer-1234', timestamp: '2026-09-30T12:00:00Z' });
    return updated;
  };
  app.saved[`cases-${app.profileId}`][0].action = 'Follow up with customer';
  app.changed(structuredClone(app.saved[`cases-${app.profileId}`]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.match(app.document.getElementById('result').children[0].textContent, /Follow up with customer/);
});

test('popup thread fetches bypass the cache and have a thirty-second timeout', async () => {
  const app = await racePopup();
  let timeout;
  let requested;
  const signal = { aborted: false };
  app.context.AbortSignal = { timeout: (milliseconds) => { timeout = milliseconds; return signal; } };
  app.context.DOMParser = class { parseFromString() { return {}; } };
  app.context.extractForumThread = () => app.thread('1234');
  app.context.fetch = async (url, options) => {
    requested = options;
    return { ok: true, url, text: async () => '<html></html>' };
  };
  const loaded = await app.context.readThread(app.thread('1234').url);
  assert.equal(loaded.id, '1234');
  assert.equal(requested.cache, 'no-store');
  assert.equal(requested.credentials, 'include');
  assert.equal(requested.signal, signal);
  assert.equal(timeout, 30000);
});

test('popup separates daily work, saved cases and collapsed settings without duplicate IDs', () => {
  const html = source('popup.html');
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['today-section', 'saved-section', 'calendar-section', 'profile-section', 'activity-section'])
    assert.ok(ids.includes(id));
  assert.ok(html.indexOf('id="today-section"') < html.indexOf('id="saved-section"'));
  assert.match(html, /role="tablist"/);
  const controls = Array.from(html.matchAll(/role="tab" aria-controls="([^"]+)"/g), (match) => match[1]);
  assert.equal(controls.length, 5);
  for (const id of controls) assert.ok(ids.includes(id));
  assert.equal(Array.from(html.matchAll(/role="tabpanel"/g)).length, 5);
  assert.match(html, /id="message" role="status" aria-live="polite"/);
});

test('case categories keep distinct labels and styles and preserve expand/collapse behavior', async () => {
  const app = await racePopup();
  app.changed([
    { id: '1', title: 'Strike', url: app.thread('1').url, action: 'Post first strike comment', tone: 'upcoming', due: '2099-01-01' },
    { id: '2', title: 'Follow-up', url: app.thread('2').url, action: 'Follow up with customer', tone: 'upcoming', due: '2099-01-01' },
    { id: '3', title: 'Review', url: app.thread('3').url, action: 'Review needed', tone: 'neutral', due: null }
  ]);
  const groups = app.document.getElementById('case-list').children;
  assert.equal(groups.find((group) => group.className === 'case-group strike').children[0].textContent, 'Strike cases (1)');
  assert.equal(groups.find((group) => group.className === 'case-group followup').children[0].textContent, 'Customer follow-up (1)');
  const review = groups.find((group) => group.className === 'case-group review');
  assert.equal(review.open, false);
  review.open = true;
  review.handlers.toggle();
  app.context.renderCases();
  assert.equal(app.document.getElementById('case-list').children.find((group) => group.className === 'case-group review').open, true);
});

test('tabbar shows only the selected panel and background rendering preserves selection', async () => {
  const app = await racePopup();
  const get = app.document.getElementById;
  const panels = ['panel-thread', 'today-section', 'saved-section', 'calendar-section', 'panel-settings'];
  assert.equal(get('panel-thread').hidden, false);
  get('tab-cases').handlers.click();
  assert.deepEqual(panels.filter((id) => !get(id).hidden), ['saved-section']);
  assert.equal(get('tab-cases').ariaSelected, 'true');
  assert.equal(get('tab-thread').ariaSelected, 'false');
  app.context.renderCases();
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  assert.deepEqual(panels.filter((id) => !get(id).hidden), ['saved-section']);
  get('tab-calendar').handlers.click();
  assert.deepEqual(panels.filter((id) => !get(id).hidden), ['calendar-section']);
});

test('tabbar keyboard navigation wraps and supports Home and End', async () => {
  const app = await racePopup();
  const get = app.document.getElementById;
  let prevented = 0;
  get('tab-thread').handlers.keydown({ key: 'ArrowLeft', preventDefault() { prevented++; } });
  assert.equal(get('tab-settings').ariaSelected, 'true');
  assert.equal(get('tab-settings').focused, true);
  assert.equal(get('tab-settings').tabIndex, 0);
  get('tab-settings').handlers.keydown({ key: 'ArrowRight', preventDefault() { prevented++; } });
  assert.equal(get('tab-thread').ariaSelected, 'true');
  get('tab-thread').handlers.keydown({ key: 'End', preventDefault() { prevented++; } });
  assert.equal(get('panel-settings').hidden, false);
  get('tab-settings').handlers.keydown({ key: 'Home', preventDefault() { prevented++; } });
  assert.equal(get('panel-thread').hidden, false);
  assert.equal(prevented, 4);
});

test('refresh reports progress, disables overlapping actions and counts removed cases as skipped', async () => {
  const app = await racePopup();
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  await app.document.getElementById('save-case').handlers.click();
  const blocked = deferred();
  let reads = 0;
  app.context.readThread = () => { reads++; return blocked.promise; };
  const refresh = app.context.refreshSavedCases();
  const get = app.document.getElementById;
  assert.match(get('message').textContent, /Checking 1\/1 · 1234/);
  assert.equal(get('refresh-progress').max, 1);
  assert.equal(get('refresh-progress').value, 0);
  assert.equal(get('refresh-progress').hidden, false);
  assert.equal(get('refresh-cases').disabled, true);
  await app.context.refreshSavedCases();
  assert.equal(reads, 1);
  await app.changeCase({ type: 'remove', profileId: app.profileId, id: '1234' });
  app.changed([]);
  blocked.resolve(app.thread('1234'));
  await refresh;
  assert.match(get('message').textContent, /0 updated, 0 failed, 1 skipped/);
  assert.equal(get('refresh-progress').hidden, true);
  assert.equal(get('retry-cases').hidden, true);
});

test('leave report downloads only the current profile cases and validates dates', async () => {
  const app = await racePopup();
  const get = app.document.getElementById;
  assert.equal(get('export-report').disabled, true);
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  await get('save-case').handlers.click();
  app.saved['cases-other'] = [{ id: '9999', title: 'Other profile case' }];
  assert.equal(get('export-report').disabled, false);
  get('report-start').value = '2026-10-15';
  get('report-start').handlers.change();
  assert.equal(get('report-end').value, '2026-10-15');
  assert.equal(get('report-end').min, '2026-10-15');
  let downloaded;
  let removed = false;
  const originalCreate = app.document.createElement;
  app.document.body = new Element();
  app.document.createElement = (tag) => {
    const element = originalCreate(tag);
    element.click = () => { downloaded = { href: element.href, filename: element.download }; };
    element.remove = () => { removed = true; };
    return element;
  };
  const before = structuredClone(app.saved);
  get('report-form').handlers.submit({ preventDefault() {} });
  assert.equal(downloaded.filename, 'leave-report-2026-10-15-to-2026-10-15.html');
  const html = decodeURIComponent(downloaded.href.split(',')[1]);
  assert.match(html, /1234 - Thread 1234/);
  assert.doesNotMatch(html, /Other profile case/);
  assert.match(html, new RegExp(app.profileId));
  assert.equal(removed, true);
  assert.deepEqual(app.saved, before);
  get('report-end').value = '2026-10-14';
  downloaded = undefined;
  get('report-form').handlers.submit({ preventDefault() {} });
  assert.equal(downloaded, undefined);
  assert.match(get('report-status').textContent, /valid leave date range/);
});

test('report export is blocked while refreshing cases', async () => {
  const app = await racePopup();
  const get = app.document.getElementById;
  app.context.readThread = async () => app.thread('1234');
  await app.context.loadThread(app.thread('1234').url);
  await get('save-case').handlers.click();
  const blocked = deferred();
  app.context.readThread = () => blocked.promise;
  const refresh = app.context.refreshSavedCases();
  assert.equal(get('export-report').disabled, true);
  get('report-form').handlers.submit({ preventDefault() {} });
  assert.match(get('report-status').textContent, /wait for refresh/);
  blocked.resolve(app.thread('1234'));
  await refresh;
  assert.equal(get('export-report').disabled, false);
});

test('Discord settings are profile-scoped and test notifications require an explicit click', async () => {
  const app = await racePopup();
  const get = app.document.getElementById;
  const messages = [];
  const originalSend = app.chrome.runtime.sendMessage;
  app.chrome.runtime.sendMessage = async (message) => {
    if (message.target !== 'forum-discord') return originalSend(message);
    messages.push(message);
    if (message.type === 'configure') app.saved[`discord-${message.profileId}`] = message.settings;
    return { ok: true };
  };
  get('discord-webhook').value = 'https://discord.com/api/webhooks/123/test_token';
  get('discord-enabled').checked = true;
  get('discord-excerpt').checked = false;
  await get('discord-form').handlers.submit({ preventDefault() {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'configure');
  assert.equal(messages[0].profileId, app.profileId);
  assert.equal(messages[0].settings.includeExcerpt, false);
  assert.equal(get('discord-test').disabled, false);
  await get('discord-test').handlers.click();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].type, 'test');
  app.saved['discord-other'] = { enabled: false, webhook: '' };
  get('profile-input').value = '12345678-1234-1234-1234-123456789abc';
  await get('profile-form').handlers.submit({ preventDefault() {} });
  assert.equal(get('discord-webhook').value, '');
  assert.equal(get('discord-enabled').checked, false);
  assert.equal(get('discord-test').disabled, true);
  assert.equal(messages.length, 2);
});

test('popup saves a profile link without userid after lookup and preserves the old profile on failure', async () => {
  const app = await racePopup();
  const get = app.document.getElementById;
  const resolvedId = '12345678-1234-1234-1234-123456789abc';
  app.context.AbortSignal = AbortSignal;
  app.context.fetch = async (url) => {
    assert.equal(url, 'https://learn.microsoft.com/api/profiles/teammate-1234');
    return { ok: true, json: async () => ({ userId: resolvedId }) };
  };
  get('profile-input').value = 'https://learn.microsoft.com/en-us/users/teammate-1234/';
  await get('profile-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.saved.supportAuthorId, resolvedId);
  assert.equal(app.saved[`profile-name-${resolvedId}`], 'teammate-1234');
  assert.equal(get('profile-label').textContent, resolvedId);
  app.context.fetch = async () => { throw new Error('offline'); };
  get('profile-input').value = 'https://learn.microsoft.com/en-us/users/another-teammate/';
  await get('profile-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.saved.supportAuthorId, resolvedId);
  assert.match(get('message').textContent, /Try again while online/);
});

test('popup keeps an intrinsic width rather than shrinking to its initial viewport', () => {
  const css = source('popup.css');
  assert.match(css, /html\s*\{[^}]*min-width:\s*560px/);
  assert.match(css, /body\s*\{[^}]*width:\s*560px;[^}]*height:\s*580px/);
  assert.doesNotMatch(css, /max-width:\s*100vw/);
});
