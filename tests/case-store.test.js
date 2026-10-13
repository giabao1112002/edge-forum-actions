const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaseStore } = require('../src/features/cases/case-store');

function store() {
  const saved = {};
  const storage = {
    get: async (key) => structuredClone({ [key]: saved[key] }),
    set: async (values) => Object.assign(saved, structuredClone(values))
  };
  return { saved, change: createCaseStore(storage) };
}

test('serializes independent additions and ignores stale refreshes after removal or replacement', async () => {
  const { saved, change } = store();
  const first = { id: '1', action: 'strike' };
  await Promise.all([
    change({ type: 'add', profileId: 'a', id: '1', summary: first }),
    change({ type: 'add', profileId: 'a', id: '2', summary: { id: '2' } })
  ]);
  assert.deepEqual(saved['cases-a'].map((item) => item.id), ['1', '2']);
  await change({ type: 'remove', profileId: 'a', id: '1' });
  const removed = await change({ type: 'update', profileId: 'a', id: '1', expected: first, summary: { ...first, action: 'close' } });
  assert.equal(removed.applied, false);
  assert.deepEqual(saved['cases-a'].map((item) => item.id), ['2']);
  await change({ type: 'add', profileId: 'a', id: '1', summary: { ...first, action: 'response' } });
  const stale = await change({ type: 'update', profileId: 'a', id: '1', expected: first, summary: first });
  assert.equal(stale.applied, false);
  assert.equal(saved['cases-a'][1].action, 'response');
});

test('corrections invalidate an older refresh and stay scoped to their profile', async () => {
  const { saved, change } = store();
  const first = { id: '1', action: 'strike' };
  await change({ type: 'add', profileId: 'a', id: '1', summary: first });
  const settings = { supportAuthorId: 'a', actions: { comment: 'ignore' } };
  await change({ type: 'correct', profileId: 'a', id: '1', expected: first,
    summary: { ...first, action: 'response' }, settings });
  await change({ type: 'update', profileId: 'a', id: '1', expected: first, summary: first });
  assert.equal(saved['cases-a'][0].action, 'response');
  assert.deepEqual(saved['thread-a-1'], settings);
  assert.equal(saved['thread-b-1'], undefined);
});

test('removed cases stay excluded from activity until manually saved again', async () => {
  const { saved, change } = store();
  const caseSummary = { id: '1', action: 'Review needed' };
  await change({ type: 'add', profileId: 'a', id: '1', summary: caseSummary });
  await change({ type: 'remove', profileId: 'a', id: '1' });
  assert.deepEqual(saved['ignored-cases-a'], ['1']);
  assert.equal((await change({ type: 'add', source: 'activity', profileId: 'a', id: '1', summary: caseSummary })).applied, false);
  assert.equal((await change({ type: 'add', profileId: 'a', id: '1', summary: caseSummary })).applied, true);
  assert.deepEqual(saved['ignored-cases-a'], []);
});
