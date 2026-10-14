const test = require('node:test');
const assert = require('node:assert/strict');
const { source } = require('./helpers');
const vm = require('node:vm');

test('background parser reads only Q&A case links, returns thread data, and reports failures', async () => {
  let listener;
  let requested;
  const document = { createElement: () => ({ getContext: () => ({
    fillRect() {}, fillText() {}
  }), toDataURL: () => 'data:image/png;base64,icon' }) };
  const chrome = { runtime: { onMessage: { addListener: (callback) => { listener = callback; } } } };
  let timeout;
  const signal = { aborted: false };
  const context = vm.createContext({ chrome, document, URL, AbortSignal: { timeout: (milliseconds) => {
    timeout = milliseconds;
    return signal;
  } }, DOMParser: class {
    parseFromString() { return document; }
  }, fetch: async (url, options) => {
    requested = { url, options };
    return { ok: true, url, text: async () => '<html></html>' };
  }, extractForumThread: () => ({ id: '1234', entries: [{ id: 'question-1234' }] }) });
  vm.runInContext(source('offscreen.js'), context);
  const receive = (message) => new Promise((resolve) => listener(message, {}, resolve));
  const result = await receive({ target: 'forum-parser', type: 'read', url: 'https://learn.microsoft.com/en-us/answers/questions/1234/example' });
  assert.equal(result.thread.id, '1234');
  assert.equal(requested.options.credentials, 'include');
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(timeout, 30000);
  assert.equal(requested.options.signal, signal);
  const rejected = await receive({ target: 'forum-parser', type: 'read', url: 'https://example.com/' });
  assert.match(rejected.error, /Invalid Microsoft Q&A/);
  const icon = await receive({ target: 'forum-parser', type: 'icon' });
  assert.match(icon.iconUrl, /^data:image\/png/);
});

test('offscreen reads Developer Community rootPost API data', async () => {
  let listener;
  let requested;
  const payload = { id: 1234, type: 0, title: 'Community issue', author: { id: 8, name: 'Customer' },
    text: 'Question', createdDate: '2026-10-01T12:00:00Z', children: [] };
  const chrome = { runtime: { onMessage: { addListener: (callback) => { listener = callback; } } } };
  const context = vm.createContext({ chrome, document: {}, URL, AbortSignal: { timeout: () => ({}) },
    fetch: async (url, options) => {
      requested = { url, options };
      return { ok: true, json: async () => payload };
    },
    extractDeveloperCommunityThread: (data, url) => ({ id: String(data.id), url, entries: [{ id: '1234' }] }) });
  vm.runInContext(source('offscreen.js'), context);
  const result = await new Promise((resolve) => listener({ target: 'forum-parser', type: 'read',
    url: 'https://developercommunity.visualstudio.com/t/sample/1234?viewtype=all' }, {}, resolve));
  assert.equal(result.thread.id, '1234');
  assert.equal(requested.url, 'https://sendvsfeedback2.azurewebsites.net/api/detailsV3/rootPost?id=1234');
  assert.equal(requested.options.credentials, 'omit');
  const rejected = await new Promise((resolve) => listener({ target: 'forum-parser', type: 'read',
    url: 'https://example.com/t/sample/1234' }, {}, resolve));
  assert.match(rejected.error, /Invalid Microsoft Q&A or Developer Community/);
});
