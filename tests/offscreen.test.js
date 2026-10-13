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
