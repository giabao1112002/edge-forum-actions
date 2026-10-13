const test = require('node:test');
const assert = require('node:assert/strict');
const { planAction, addBusinessDays, scopeThread, inferProcessStage, inferPostAction } = require('../src/core/engine');

const question = { id: 'question-1', type: 'question', authorId: 'customer', timestamp: '2026-09-25T12:00:00Z' };
const entry = (id, type, authorId, timestamp) => ({ id, type, authorId, timestamp });
const response = entry('answer-1', 'answer', 'staff', '2026-09-25T12:00:00Z');
const thread = (entries) => ({ entries: [question, ...entries] });
const settings = (actions = {}) => ({ supportAuthorId: 'staff', actions });
const today = new Date('2026-09-30T12:00:00Z');

test('business days skip weekends', () => {
  assert.equal(addBusinessDays(response.timestamp, 3).toISOString().slice(0, 10), '2026-09-30');
});
test('first response leads to a strike after three business days', () => {
  const result = planAction(thread([response]), settings(), today);
  assert.equal(result.action, 'Post first strike comment');
  assert.equal(result.due, '2026-09-30');
  assert.deepEqual(result.postedStrikes, []);
  assert.equal(result.predictedClose, '2026-10-02');
  assert.deepEqual(result.evidence.map((item) => item.entryId), ['answer-1']);
  assert.match(result.rule, /3 business days/);
  assert.equal(result.tone, 'today');
});
test('closure forecast skips the weekend after a Thursday first strike', () => {
  const mondayAnswer = entry('answer-1', 'answer', 'staff', '2026-09-28T12:00:00Z');
  const result = planAction(thread([mondayAnswer]), settings(), today);
  assert.equal(result.due, '2026-10-01');
  assert.equal(result.predictedClose, '2026-10-05');
});
test('first-response branch requires last response two days after strike', () => {
  const strike = entry('comment-1', 'comment', 'staff', '2026-09-30T12:00:00Z');
  const result = planAction(thread([response, strike]), settings(), today);
  assert.equal(result.action, 'Send last quality response');
  assert.equal(result.due, '2026-10-02');
  assert.deepEqual(result.postedStrikes, ['2026-09-30']);
  assert.deepEqual(result.evidence.map((item) => item.entryId), ['comment-1']);
  assert.equal(result.predictedClose, null);
});
test('case 6016904 recognizes Brian’s October 1 comment as strike one', () => {
  const brian = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const questionAuthor = '004c3063-c797-42a6-9181-721291fcd574';
  const activity = { entries: [
    { id: 'question-6016904', type: 'question', authorId: questionAuthor, timestamp: '2026-09-27T19:52:01Z' },
    { id: 'answer-12977272', type: 'answer', authorId: brian, timestamp: '2026-09-28T02:57:20Z' },
    { id: 'comment-2834374', type: 'comment', authorId: brian, parentAnswerId: 'answer-12977272',
      timestamp: '2026-10-01T03:08:33Z' }
  ] };
  const result = planAction(activity, { supportAuthorId: brian, actions: {} }, new Date('2026-10-01T12:00:00Z'));
  assert.equal(result.action, 'Send last quality response');
  assert.equal(result.due, '2026-10-05');
  assert.deepEqual(result.postedStrikes, ['2026-10-01']);
  assert.equal(result.predictedClose, null);
});
test('ongoing investigation requires two strikes, then last response', () => {
  const strikeOne = entry('comment-1', 'comment', 'staff', '2026-09-29T12:00:00Z');
  const strikeTwo = entry('comment-2', 'comment', 'staff', '2026-10-01T12:00:00Z');
  const customerReply = entry('comment-customer', 'comment', 'customer', '2026-09-26T12:00:00Z');
  const ongoingResponse = entry('answer-2', 'answer', 'staff', '2026-09-26T14:00:00Z');
  const one = planAction(thread([response, customerReply, ongoingResponse, strikeOne]), settings(), today);
  assert.equal(one.action, 'Post second strike comment');
  assert.equal(one.due, '2026-10-01');
  assert.deepEqual(one.postedStrikes, ['2026-09-29']);
  assert.equal(one.predictedClose, '2026-10-01');
  const two = planAction(thread([response, customerReply, ongoingResponse, strikeOne, strikeTwo]), settings(), today);
  assert.equal(two.action, 'Send last quality response');
  assert.equal(two.due, '2026-10-01');
  assert.deepEqual(two.postedStrikes, ['2026-09-29', '2026-10-01']);
  assert.equal(two.predictedClose, null);
});
test('ongoing branch predicts second strike and closure before any strikes', () => {
  const reply = entry('comment-customer', 'comment', 'customer', '2026-09-28T12:00:00Z');
  const followUp = entry('answer-followup', 'answer', 'staff', '2026-09-29T12:00:00Z');
  const result = planAction(thread([response, reply, followUp]), settings(), today);
  assert.equal(result.due, '2026-10-01');
  assert.equal(result.predictedClose, '2026-10-05');
});
test('customer reply resets strikes and requires one-business-day follow-up', () => {
  const strike = entry('comment-1', 'comment', 'staff', '2026-09-28T12:00:00Z');
  const reply = entry('comment-2', 'comment', 'customer', '2026-09-29T12:00:00Z');
  const result = planAction(thread([response, strike, reply]), settings(), today);
  assert.equal(result.action, 'Follow up with customer');
  assert.equal(result.due, '2026-09-30');
  assert.deepEqual(result.evidence.map((item) => item.entryId), ['comment-2']);
  assert.equal(result.postedStrikes, undefined);
  assert.equal(result.predictedClose, null);
});
test('customer reply while waiting for the first strike cancels its deadline and close forecast', () => {
  const reply = entry('comment-reply', 'comment', 'customer', '2026-09-29T15:00:00Z');
  reply.parentAnswerId = response.id;
  const before = planAction(thread([response]), settings(), today);
  assert.equal(before.action, 'Post first strike comment');
  assert.equal(before.predictedClose, '2026-10-02');
  const pending = planAction(thread([response, reply]), settings(), today);
  assert.equal(pending.action, 'Follow up with customer');
  assert.equal(pending.due, '2026-09-30');
  assert.equal(pending.predictedClose, null);
  assert.equal(pending.postedStrikes, undefined);
  const followUp = entry('comment-followup', 'comment', 'staff', '2026-09-30T16:00:00Z');
  followUp.parentAnswerId = response.id;
  const restarted = planAction(thread([response, reply, followUp]), settings(), today);
  assert.equal(restarted.action, 'Post first strike comment');
  assert.equal(restarted.due, '2026-10-02');
  assert.deepEqual(restarted.postedStrikes, []);
  assert.equal(restarted.predictedClose, '2026-10-06');
});
test('customer reply on the close day cancels posted strikes and restarts after your answer', () => {
  const firstStrike = entry('comment-strike', 'comment', 'staff', '2026-09-30T12:00:00Z');
  const customerReply = entry('comment-reply', 'comment', 'customer', '2026-10-02T09:00:00Z');
  customerReply.parentAnswerId = response.id;
  const before = planAction(thread([response, firstStrike]), settings(), today);
  assert.equal(before.action, 'Send last quality response');
  assert.equal(before.due, '2026-10-02');
  const pending = planAction(thread([response, firstStrike, customerReply]), settings(), today);
  assert.equal(pending.action, 'Follow up with customer');
  assert.equal(pending.due, '2026-10-05');
  assert.equal(pending.predictedClose, null);
  assert.equal(pending.postedStrikes, undefined);
  const followUp = entry('comment-followup', 'comment', 'staff', '2026-10-05T12:00:00Z');
  const restarted = planAction(thread([response, firstStrike, customerReply, followUp]), settings(), today);
  assert.equal(restarted.action, 'Post first strike comment');
  assert.equal(restarted.due, '2026-10-07');
  assert.deepEqual(restarted.postedStrikes, []);
  assert.equal(restarted.predictedClose, '2026-10-09');
});
test('customer reply before the second strike resets the ongoing investigation count', () => {
  const firstReply = entry('comment-initial-reply', 'comment', 'customer', '2026-09-26T12:00:00Z');
  const followUp = entry('comment-followup', 'comment', 'staff', '2026-09-28T12:00:00Z');
  const firstStrike = entry('comment-first-strike', 'comment', 'staff', '2026-09-30T12:00:00Z');
  const newReply = entry('comment-new-reply', 'comment', 'customer', '2026-10-02T09:00:00Z');
  newReply.parentAnswerId = response.id;
  const before = planAction(thread([response, firstReply, followUp, firstStrike]), settings(), today);
  assert.equal(before.action, 'Post second strike comment');
  assert.equal(before.predictedClose, '2026-10-02');
  const pending = planAction(thread([response, firstReply, followUp, firstStrike, newReply]), settings(), today);
  assert.equal(pending.action, 'Follow up with customer');
  assert.equal(pending.postedStrikes, undefined);
  assert.equal(pending.predictedClose, null);
  const newFollowUp = entry('comment-new-followup', 'comment', 'staff', '2026-10-05T12:00:00Z');
  const restarted = planAction(thread([response, firstReply, followUp, firstStrike, newReply, newFollowUp]), settings(), today);
  assert.equal(restarted.action, 'Post first strike comment');
  assert.equal(restarted.due, '2026-10-07');
  assert.deepEqual(restarted.postedStrikes, []);
  assert.equal(restarted.predictedClose, '2026-10-09');
});
test('ongoing investigation uses the latest response for the first strike', () => {
  const followUp = entry('comment-5', 'comment', 'staff', '2026-09-29T12:00:00Z');
  const reply = entry('comment-customer', 'comment', 'customer', '2026-09-26T12:00:00Z');
  const result = planAction(thread([response, reply, followUp]), settings({ [followUp.id]: 'response' }), today);
  assert.equal(result.due, '2026-10-01');
});
test('last response prompts CI verification; unidentified comments and pagination block dates', () => {
  const last = entry('comment-3', 'comment', 'staff', '2026-09-29T12:00:00Z');
  assert.equal(planAction(thread([response, last]), settings({ [last.id]: 'last' }), today).action, 'Strike flow complete — verify CI closure');
  assert.equal(planAction(thread([response, entry('comment-4', 'comment', '', last.timestamp)]), settings(), today).due, null);
  assert.equal(planAction({ ...thread([response]), hasMorePages: true }, settings(), today).due, null);
});
test('Visual Studio product key thread has first strike September 25 and final follow-up September 29', () => {
  const brian = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const customer = 'e540f1e8-252f-4115-98f6-cafa4299fa91';
  const caseQuestion = entry('question-6010629', 'question', customer, '2026-09-22T06:32:22Z');
  const caseAnswer = entry('answer-12969290', 'answer', brian, '2026-09-22T07:30:32Z');
  const firstStrike = entry('comment-2827647', 'comment', brian, '2026-09-25T02:34:56Z');
  const finalFollowUp = entry('comment-2831664', 'comment', brian, '2026-09-29T02:37:39Z');
  const unrelatedAnswer = entry('answer-12969221', 'answer', '', '2026-09-22T06:32:38Z');
  const activity = { entries: [caseQuestion, unrelatedAnswer, caseAnswer, firstStrike, finalFollowUp], hasUnidentifiedAuthors: true };
  const selected = { supportAuthorId: brian, actions: {} };
  assert.equal(inferPostAction(firstStrike, activity.entries, customer, brian), 'strike');
  assert.equal(inferPostAction(finalFollowUp, activity.entries, customer, brian), 'last');
  const result = planAction(activity, selected, today);
  assert.equal(result.action, 'Strike flow complete — verify CI closure');
  assert.equal(result.due, null);
  assert.deepEqual(result.postedStrikes, ['2026-09-25']);
  assert.equal(result.predictedClose, undefined);
  assert.match(result.reason, /Final follow-up posted/);
  const corrected = planAction(activity, { ...selected, actions: { [firstStrike.id]: 'response', [finalFollowUp.id]: 'strike' } }, today);
  assert.equal(corrected.action, 'Send last quality response');
  assert.deepEqual(corrected.postedStrikes, ['2026-09-29']);
});
test('ongoing investigation ends after two strikes and a final comment', () => {
  const reply = entry('comment-customer', 'comment', 'customer', '2026-09-26T12:00:00Z');
  const followUp = entry('answer-followup', 'answer', 'staff', '2026-09-28T12:00:00Z');
  const firstStrike = entry('comment-first', 'comment', 'staff', '2026-09-30T12:00:00Z');
  const secondStrike = entry('comment-second', 'comment', 'staff', '2026-10-02T12:00:00Z');
  const final = entry('comment-final', 'comment', 'staff', '2026-10-02T13:00:00Z');
  const entries = thread([response, reply, followUp, firstStrike, secondStrike, final]).entries;
  assert.equal(inferPostAction(final, entries, 'customer', 'staff'), 'last');
  assert.equal(planAction({ entries }, settings(), today).tone, 'completed');
});
test('the supplied case ignores Priya and includes only Brian and the question author', () => {
  const brianId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const authorId = 'f7585eb8-c7d2-40bb-9047-8517bf9623a0';
  const caseQuestion = entry('question-6013752', 'question', authorId, '2026-09-24T17:31:05Z');
  const brianAnswer = entry('answer-12973823', 'answer', brianId, '2026-09-25T02:22:45Z');
  const priyaComment = entry('comment-2829142', 'comment', '2f54f567-61f3-43ac-8a98-0b98a000a534', '2026-09-26T12:12:28Z');
  const brianComment = entry('comment-2833029', 'comment', brianId, '2026-09-30T02:21:03Z');
  const caseThread = { entries: [caseQuestion, brianAnswer, priyaComment, brianComment] };
  const filtered = scopeThread(caseThread, brianId);
  assert.deepEqual(filtered.entries.map((item) => item.id), ['question-6013752', 'answer-12973823', 'comment-2833029']);
  assert.equal(filtered.excludedCount, 1);
  const selected = { supportAuthorId: brianId, actions: { [brianComment.id]: 'strike' },
    roles: { [priyaComment.authorId]: 'customer' } };
  assert.equal(planAction(caseThread, selected, today).action, 'Send last quality response');
  assert.equal(planAction(caseThread, selected, today).due, '2026-10-02');
  assert.equal(planAction(caseThread, { ...selected, actions: {} }, today).due, '2026-10-02');
  assert.equal(inferProcessStage(filtered.entries, authorId, brianId), 'first');
});
test('a customer reply followed by a support response switches to ongoing automatically', () => {
  const reply = entry('comment-customer', 'comment', 'customer', '2026-09-28T12:00:00Z');
  const followUp = entry('comment-staff', 'comment', 'staff', '2026-09-29T12:00:00Z');
  assert.equal(inferProcessStage(thread([response, reply]).entries, 'customer', 'staff'), 'awaiting-customer');
  const result = planAction(thread([response, reply, followUp]), settings(), today);
  assert.equal(inferProcessStage(thread([response, reply, followUp]).entries, 'customer', 'staff'), 'ongoing');
  assert.equal(inferPostAction(followUp, thread([response, reply, followUp]).entries, 'customer', 'staff'), 'response');
  assert.equal(result.action, 'Post first strike comment');
  assert.equal(result.due, '2026-10-01');
});
test('a later unanswered support comment is the first ongoing strike', () => {
  const reply = entry('comment-customer', 'comment', 'customer', '2026-09-28T12:00:00Z');
  const followUp = entry('comment-staff', 'comment', 'staff', '2026-09-29T12:00:00Z');
  const strike = entry('comment-strike', 'comment', 'staff', '2026-10-01T12:00:00Z');
  const activity = thread([response, reply, followUp, strike]);
  assert.equal(inferPostAction(strike, activity.entries, 'customer', 'staff'), 'strike');
  const result = planAction(activity, settings(), today);
  assert.equal(result.action, 'Post second strike comment');
  assert.equal(result.due, '2026-10-05');
});
test('question-author comments before the first answer do not select ongoing', () => {
  const earlyComment = entry('comment-early', 'comment', 'customer', '2026-09-24T12:00:00Z');
  assert.equal(inferProcessStage(thread([earlyComment, response]).entries, 'customer', 'staff'), 'first');
  assert.equal(planAction(thread([earlyComment, response]), settings(), today).due, '2026-09-30');
});
test('accepted Brian answer overrides missing author IDs and does not report CI closure', () => {
  const accepted = { entries: [question, response, entry('comment-ignored', 'comment', '', '2026-09-29T12:00:00Z')],
    acceptedAnswerId: response.id, hasUnidentifiedAuthors: true };
  const result = planAction(accepted, settings(), today);
  assert.equal(result.action, 'Your answer was accepted');
  assert.equal(result.tone, 'completed');
  assert.equal(result.due, null);
  assert.equal(result.predictedClose, undefined);
  assert.match(result.reason, /CI status/);
});
test('answer accepted from someone else does not claim Brian completed the case', () => {
  const another = entry('answer-other', 'answer', 'other', '2026-09-29T12:00:00Z');
  const result = planAction({ ...thread([response, another]), acceptedAnswerId: another.id }, settings(), today);
  assert.equal(result.action, 'Review needed');
  assert.equal(result.due, null);
});
test('customer reply beneath someone else’s answer does not reset Brian’s timeline', () => {
  const brian = '696f09c3-51ea-4371-99ea-14d4c83bead8';
  const customer = '9b99766f-46a0-4c63-8807-84feb1ba73b1';
  const entries = [
    entry('question-6018708', 'question', customer, '2026-09-29T03:59:32Z'),
    entry('answer-12979027', 'answer', 'other', '2026-09-29T05:20:14Z'),
    entry('answer-12979197', 'answer', brian, '2026-09-29T05:38:44Z'),
    { ...entry('comment-2831922', 'comment', customer, '2026-09-29T06:42:54Z'), parentAnswerId: 'answer-12979027' },
    { ...entry('comment-2832011', 'comment', 'other', '2026-09-29T08:03:37Z'), parentAnswerId: 'answer-12979027' }
  ];
  const caseThread = { entries };
  const scoped = scopeThread(caseThread, brian);
  assert.deepEqual(scoped.entries.map((item) => item.id), ['question-6018708', 'answer-12979197']);
  assert.equal(inferProcessStage(scoped.entries, customer, brian), 'first');
  const result = planAction(caseThread, { supportAuthorId: brian, actions: {} }, today);
  assert.equal(result.action, 'Post first strike comment');
  assert.equal(result.due, '2026-10-02');
});
test('a customer comment on Brian’s answer still counts as a reply', () => {
  const reply = { ...entry('comment-1', 'comment', 'customer', '2026-09-29T12:00:00Z'), parentAnswerId: response.id };
  const result = planAction(thread([response, reply]), settings(), today);
  assert.equal(result.action, 'Follow up with customer');
  assert.equal(result.due, '2026-09-30');
});
test('unknown comments on someone else’s answer do not block Brian’s timeline', () => {
  const otherAnswer = entry('answer-other', 'answer', 'other', '2026-09-29T12:00:00Z');
  const unknown = { ...entry('comment-unknown', 'comment', '', '2026-09-29T14:00:00Z'), parentAnswerId: otherAnswer.id };
  assert.equal(planAction(thread([response, otherAnswer, unknown]), settings(), today).action, 'Post first strike comment');
});
