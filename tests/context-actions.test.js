const test = require('node:test');
const assert = require('node:assert/strict');
const { inferPostAction, planAction } = require('../src/core/engine');
const { caseSummary } = require('../src/features/cases/dashboard');

const question = { id: 'question', type: 'question', authorId: 'customer', timestamp: '2026-09-25T09:00:00Z' };
const answer = { id: 'answer', type: 'answer', authorId: 'staff', timestamp: '2026-09-25T10:00:00Z' };
const comment = (id, timestamp, content) => ({ id, type: 'comment', authorId: 'staff', timestamp, content });
const settings = { supportAuthorId: 'staff', actions: {} };

test('Microsoft Q&A recognizes an explicitly worded strike posted before its calculated date', () => {
  const strike = comment('early-strike', '2026-09-28T10:00:00Z',
    "I haven't heard from you in a while. If you need any further assistance, please let me know in the comments.");
  const thread = { site: 'learn', entries: [question, answer, strike] };
  assert.equal(inferPostAction(strike, thread.entries, 'customer', 'staff', {}, 'learn'), 'strike');
  const result = planAction(thread, settings, new Date('2026-09-28T12:00:00'));
  assert.equal(result.action, 'Send last quality response');
  assert.equal(result.due, '2026-09-30');
  assert.deepEqual(result.postedStrikes, ['2026-09-28']);
});

test('Microsoft Q&A recognizes a technical response posted after the expected strike date', () => {
  const response = comment('late-response', '2026-10-01T10:00:00Z',
    'I reviewed the Activity Log and would recommend checking the Git Global Settings. Please try Embedded Git.');
  const thread = { site: 'learn', entries: [question, answer, response] };
  assert.equal(inferPostAction(response, thread.entries, 'customer', 'staff', {}, 'learn'), 'response');
  const result = planAction(thread, settings, new Date('2026-10-01T12:00:00'));
  assert.equal(result.action, 'Post first strike comment');
  assert.equal(result.due, '2026-10-06');
  assert.equal(result.evidence[0].label, 'Your additional response');
  assert.equal(caseSummary(thread, result, '2026-10-01T12:00:00Z', 'staff').lastSupportPost.step, 'Additional response');
});

test('a substantive Q&A response after a strike starts a fresh waiting cycle', () => {
  const strike = comment('strike', '2026-09-30T10:00:00Z',
    "I haven't heard from you in a while. Please let me know if you need further assistance.");
  const update = comment('technical-update', '2026-10-01T10:00:00Z',
    'I reviewed the updated log and recommend checking Git Global Settings. Please try System Git.');
  const entries = [question, answer, strike, update];
  assert.equal(inferPostAction(update, entries, 'customer', 'staff', {}, 'learn'), 'response');
  const result = planAction({ site: 'learn', entries }, settings, new Date('2026-10-01T12:00:00'));
  assert.equal(result.action, 'Post first strike comment');
  assert.equal(result.due, '2026-10-06');
  assert.deepEqual(result.postedStrikes, []);
  const later = comment('later-strike', '2026-10-07T10:00:00Z',
    'I just wanted to check whether you had a chance to review my previous response.');
  assert.equal(inferPostAction(later, [...entries, later], 'customer', 'staff', {}, 'learn'), 'strike');
});

test('Microsoft Q&A recognizes a final follow-up from wording, while ambiguous text falls back to date', () => {
  const strike = comment('strike', '2026-09-30T10:00:00Z',
    'I just wanted to check whether you had a chance to review my previous response.');
  const final = comment('final', '2026-10-01T10:00:00Z',
    "I hope the information I provided was helpful. If you have questions, feel free to reach out anytime. Thank you for your time.");
  const entries = [question, answer, strike, final];
  assert.equal(inferPostAction(final, entries, 'customer', 'staff', {}, 'learn'), 'last');
  assert.equal(planAction({ site: 'learn', entries }, settings).tone, 'completed');
  const ambiguous = comment('ambiguous', '2026-10-01T10:00:00Z', 'Thanks for your time.');
  assert.equal(inferPostAction(ambiguous, [question, answer, ambiguous], 'customer', 'staff', {}, 'learn'), 'strike');
});

test('Developer Community continues to classify the same wording by post dates', () => {
  const early = comment('early', '2026-09-28T10:00:00Z', "I haven't heard from you in a while.");
  const later = comment('later', '2026-10-01T10:00:00Z', 'I reviewed the Activity Log. Please try a new setting.');
  assert.equal(inferPostAction(early, [question, answer, early], 'customer', 'staff', {}, 'devcommunity'), 'response');
  assert.equal(inferPostAction(later, [question, answer, early, later], 'customer', 'staff', {}, 'devcommunity'), 'strike');
});
