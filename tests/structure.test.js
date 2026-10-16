const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { resolve, dirname, relative } = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { root, source, sourcePath, htmlScripts } = require('./helpers');

test('MV3 entrypoints, HTML assets, worker imports and runtime URLs resolve from their real contexts', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'src/platform/background/background.js');
  assert.equal(manifest.action.default_popup, 'src/ui/popup/popup.html');
  assert.ok(manifest.host_permissions.includes('https://sendvsfeedback2.azurewebsites.net/api/*'));
  for (const path of [manifest.background.service_worker, manifest.action.default_popup])
    assert.ok(existsSync(resolve(root, path)), path);
  for (const name of ['popup.html', 'src/platform/offscreen/offscreen.html']) {
    const base = dirname(sourcePath(name));
    for (const [, path] of source(name).matchAll(/(?:src|href)="([^"]+)"/g))
      assert.ok(existsSync(resolve(base, path)), `${name}: ${path}`);
  }
  const worker = source('background.js');
  const imports = worker.match(/importScripts\(([\s\S]*?)\);/)[1];
  for (const [, path] of imports.matchAll(/'([^']+)'/g))
    assert.ok(existsSync(resolve(dirname(sourcePath('background.js')), path)), path);
  for (const [, path] of worker.matchAll(/(?:getURL\(|url: )'([^']+\.html)'/g))
    assert.ok(existsSync(resolve(root, path)), path);
  for (const name of ['engine.js', 'popup.js', 'popup.html', 'offscreen.html', 'background.js'])
    assert.equal(existsSync(resolve(root, name)), false, `No duplicate legacy ${name}`);
});

test('popup loads actual HTML script order and initializes without test compatibility globals', async () => {
  const ids = new Set([...source('popup.html').matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const elements = new Map([...ids].map((id) => [id, {
    children: [], handlers: {}, value: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.handlers[type] = callback; }
  }]));
  const document = {
    getElementById(id) { assert.ok(ids.has(id), `Missing DOM ID: ${id}`); return elements.get(id); },
    createElement() { return { children: [], append(...children) { this.children.push(...children); } }; }
  };
  const chrome = { storage: { local: { get: async () => ({}) } }, tabs: { query: async () => [] } };
  const context = vm.createContext({ document, chrome, URL, Date, encodeURIComponent });
  for (const path of htmlScripts('popup.html')) vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('panel-settings').hidden, false);
  assert.equal(elements.get('message').textContent, undefined);
  assert.equal(elements.get('case-count').textContent, 0);
  assert.equal(context.readThread, undefined, 'Reader is not an implicit global');
  assert.equal(context.renderCases, undefined, 'Renderers are not implicit globals');
});

test('offscreen HTML loads its extractor before registering the parser listener', () => {
  let listener;
  const context = vm.createContext({ chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } } });
  for (const path of htmlScripts('src/platform/offscreen/offscreen.html'))
    vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path });
  assert.equal(typeof context.extractForumThread, 'function');
  assert.equal(typeof context.extractDeveloperCommunityThread, 'function');
  assert.equal(typeof listener, 'function');
  assert.equal(listener({ target: 'unrelated' }, {}, () => assert.fail('Unexpected response')), undefined);
});

test('every extension and test JavaScript file passes node --check', () => {
  const files = [];
  function collect(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (path.endsWith('.js')) files.push(path);
    }
  }
  collect(resolve(root, 'src'));
  collect(resolve(root, 'tests'));
  for (const file of files) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${relative(root, file)}: ${checked.stderr}`);
  }
});
