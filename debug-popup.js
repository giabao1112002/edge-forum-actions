const vm = require('node:vm');
const { loadPopup } = require('./tests/helpers');
const { createCaseStore } = require('./src/features/cases/case-store');
class Element {
  constructor() { this.children = []; this.handlers = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.open = false; this.hidden = false; this.checked = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  focus() { this.focused = true; }
}

const elements = new Map();
const document = { getElementById: (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() };
const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
const saved = { supportAuthorId: profileId, [`cases-${profileId}`]: [{ id: '1234', url: 'https://learn.microsoft.com/en-us/answers/questions/1234/example', title: 'Test thread', action: 'Post first strike comment', due: '2026-10-01', tone: 'today', checkedAt: '2026-09-29T12:00:00Z' }] };
const chrome = { storage: { local: { get: async (keys) => { const list = Array.isArray(keys) ? keys : [keys]; console.log('get called with', list); const out = Object.fromEntries(list.filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]])); console.log('out', out); return out; }, set: async (values) => Object.assign(saved, values) } }, onChanged: { addListener: () => {} }, tabs: { query: async () => [] } };
const changeCase = createCaseStore(chrome.storage.local);
chrome.runtime = { sendMessage: async (change) => changeCase(change) };
const context = vm.createContext({ document, chrome, URL, Date, encodeURIComponent });
loadPopup(context);
const get = document.getElementById;
(async () => {
  await new Promise((r) => setImmediate(r));
  console.log('supportAuthorId', context.state ? context.state.supportAuthorId : 'no state');
  console.log('cases loaded', saved['cases-' + profileId]);
  console.log('case-count text', get('case-count').textContent);
  console.log('refresh-cases handlers', !!get('refresh-cases').handlers.click);
  console.log('save-case disabled', get('save-case').disabled);
  console.log('profile section open', get('profile-section').open);
  console.log('profile input value', get('profile-input').value);
  get('desktop-reminders').checked = true;
  get('profile-input').value = '12345678-1234-1234-1234-123456789abc';
  await get('profile-form').handlers.submit({ preventDefault() {} });
  console.log('after switch reminder checked', get('desktop-reminders').checked);
  console.log('saved after switch', saved);
})();
