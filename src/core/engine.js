function addBusinessDays(timestamp, count) {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);
  while (count > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) count--;
  }
  return date;
}

function scopeThread(thread, supportAuthorId) {
  const question = thread.entries.find((entry) => entry.type === 'question');
  const authorId = question?.authorId;
  const firstCommunityResponse = thread.site === 'devcommunity' ? thread.entries.find((entry) =>
    entry.authorId === supportAuthorId && (entry.type === 'comment' || entry.type === 'answer'))?.id : null;
  const supportAnswers = new Set(thread.entries.filter((entry) => entry.type === 'answer' && entry.authorId === supportAuthorId)
    .map((entry) => entry.id));
  const isRelevant = (entry) => entry.type === 'question' ||
    (!entry.parentAnswerId || supportAnswers.has(entry.parentAnswerId)) &&
    entry.authorId && (entry.authorId === authorId || entry.authorId === supportAuthorId);
  const entries = thread.entries.filter(isRelevant).map((entry) =>
    entry.id === firstCommunityResponse && entry.type === 'comment' ? { ...entry, type: 'answer' } : entry);
  return { ...thread, entries, excludedCount: thread.entries.length - entries.length,
    hasUnidentifiedAuthors: thread.entries.some((entry) => entry.type !== 'question' && !entry.authorId &&
      (!entry.parentAnswerId || supportAnswers.has(entry.parentAnswerId))) };
}

function inferProcessStage(entries, customerAuthorId, supportAuthorId) {
  const firstAnswer = entries.find((entry) => entry.type === 'answer' && entry.authorId === supportAuthorId);
  if (!firstAnswer) return 'pre-response';
  const afterAnswer = entries.filter((entry) => Date.parse(entry.timestamp) > Date.parse(firstAnswer.timestamp));
  const customerReplies = afterAnswer.filter((entry) => entry.authorId === customerAuthorId);
  if (!customerReplies.length) return 'first';
  const latestCustomerReply = customerReplies[customerReplies.length - 1];
  const replied = afterAnswer.some((entry) => entry.authorId === supportAuthorId &&
    Date.parse(entry.timestamp) > Date.parse(latestCustomerReply.timestamp));
  return replied ? 'ongoing' : 'awaiting-customer';
}

function inferPostAction(entry, entries, customerAuthorId, supportAuthorId, overrides = {}) {
  if (entry.type === 'answer') return 'response';
  const earlier = entries.filter((item) => Date.parse(item.timestamp) < Date.parse(entry.timestamp));
  const latestCustomer = [...earlier].reverse().find((item) => item.authorId === customerAuthorId && item.type !== 'question');
  const latestSupport = [...earlier].reverse().find((item) => item.authorId === supportAuthorId);
  if (latestCustomer && (!latestSupport || Date.parse(latestCustomer.timestamp) > Date.parse(latestSupport.timestamp)))
    return 'response';
  const firstAnswer = entries.find((item) => item.type === 'answer' && item.authorId === supportAuthorId);
  const strikes = earlier.filter((item) => item.type === 'comment' && item.authorId === supportAuthorId &&
    Date.parse(item.timestamp) > Date.parse(latestCustomer?.timestamp || firstAnswer?.timestamp || 0) &&
    (overrides[item.id] || inferPostAction(item, entries, customerAuthorId, supportAuthorId, overrides)) === 'strike');
  if (latestCustomer) return strikes.length >= 2 ? 'last' : 'strike';
  const posted = new Date(entry.timestamp);
  posted.setHours(12, 0, 0, 0);
  if (strikes.length && addBusinessDays(strikes[strikes.length - 1].timestamp, 2) <= posted) return 'last';
  return 'strike';
}

function planAction(thread, settings, now = new Date()) {
  const review = (reason) => ({ action: 'Review needed', reason, due: null, tone: 'neutral' });
  if (!settings.supportAuthorId) return review('Set your support profile to calculate an action.');
  if (thread.site === 'devcommunity' && /^Closed\b/i.test(thread.communityStatus || ''))
    return { action: 'Developer Community thread closed — verify CI closure', due: null, tone: 'completed',
      reason: `Public status: ${thread.communityStatus}. Confirm CI closure separately.` };
  const question = thread.entries.find((entry) => entry.type === 'question');
  if (thread.acceptedAnswerId) {
    const acceptedAnswer = thread.entries.find((entry) => entry.id === thread.acceptedAnswerId);
    if (acceptedAnswer?.authorId === settings.supportAuthorId)
      return { action: 'Your answer was accepted', due: null, tone: 'completed',
        reason: 'No strike due. Confirm whether the case was closed on CI separately; the public page does not verify CI status.',
        evidence: [{ label: 'Accepted answer', entryId: acceptedAnswer.id, timestamp: acceptedAnswer.timestamp }] };
    return review('An answer was accepted, but it is not identified as yours. Check the thread and CI status.');
  }
  if (thread.hasMorePages) return review('Thread has multiple pages. Review all replies before using a deadline.');
  if (!question?.authorId) return review('Question author ID not found.');
  if (!settings.supportAuthorId || settings.supportAuthorId === question.authorId)
    return review('Confirm your support profile before calculating a deadline.');
  const scoped = scopeThread(thread, settings.supportAuthorId);
  const stage = inferProcessStage(scoped.entries, question.authorId, settings.supportAuthorId);
  if (stage === 'pre-response') return review('No answer from your support profile yet.');
  const firstAnswer = scoped.entries.find((entry) => entry.type === 'answer' && entry.authorId === settings.supportAuthorId);
  if (scoped.hasUnidentifiedAuthors && thread.entries.some((entry) => entry.type === 'comment' && !entry.authorId &&
    (!entry.parentAnswerId || scoped.entries.some((answer) => answer.id === entry.parentAnswerId && answer.type === 'answer')) &&
    Date.parse(entry.timestamp) > Date.parse(firstAnswer.timestamp)))
    return review('A comment after your first answer has no author ID; verify whether the customer replied.');
  const events = scoped.entries.filter((entry) => entry.id === firstAnswer.id ||
    entry.type !== 'question' && Date.parse(entry.timestamp) > Date.parse(firstAnswer.timestamp)).map((entry) => ({ ...entry,
    role: entry.authorId === question.authorId ? 'customer' : 'staff',
    action: settings.actions?.[entry.id] || inferPostAction(entry, scoped.entries, question.authorId, settings.supportAuthorId, settings.actions) }));
  const relevant = events.filter((event) => event.role === 'customer' || event.role === 'staff' && event.action !== 'ignore');
  const customer = [...relevant].reverse().find((event) => event.role === 'customer');
  const staff = [...relevant].reverse().find((event) => event.role === 'staff');
  if (!staff) return review('No staff response found. Review thread status.');
  if (customer && Date.parse(customer.timestamp) >= Date.parse(staff.timestamp))
    return dueAction('Follow up with customer', customer.timestamp, 1, 'Customer replied: strike count resets.', now,
      null, [sourceEvent('Customer reply', customer)], '1 business day after the customer reply');
  const cycle = relevant.filter((event) => event.role === 'staff' && (!customer || Date.parse(event.timestamp) > Date.parse(customer.timestamp)));
  const strikes = cycle.filter((event) => event.action === 'strike');
  const withPostedStrikes = (result) => ({ ...result,
    postedStrikes: strikes.map((entry) => formatLocalDate(new Date(entry.timestamp))),
    evidence: [...(result.evidence || []), ...strikes.filter((entry) =>
      !result.evidence?.some((source) => source.entryId === entry.id))
      .map((entry) => sourceEvent('Earlier strike posted', entry))] });
  const last = cycle.find((event) => event.action === 'last');
  if (last) return withPostedStrikes({ action: 'Strike flow complete — verify CI closure', due: null, tone: 'completed',
    reason: `Final follow-up posted ${new Date(last.timestamp).toLocaleDateString()}. No further strike is scheduled. The thread cannot confirm CI closure.`,
    evidence: [sourceEvent('Final follow-up', last)] });
  if (stage === 'first' && strikes.length > 1)
    return withPostedStrikes(review('Multiple strike comments were posted before the two-business-day final follow-up; verify their purpose.'));
  if (strikes.length >= (stage === 'first' ? 1 : 2))
    return withPostedStrikes(dueAction('Send last quality response', strikes[strikes.length - 1].timestamp, stage === 'first' ? 2 : 0,
      'No customer reply after strikes.', now, null, [sourceEvent('Most recent strike', strikes[strikes.length - 1])],
      stage === 'first' ? '2 business days after the first strike' : 'After the second strike'));
  const anchor = strikes.length ? strikes[strikes.length - 1] : [...cycle].reverse().find((event) => event.action === 'response');
  if (!anchor) return review('Confirm the latest support response before calculating a strike.');
  return withPostedStrikes(dueAction(strikes.length ? 'Post second strike comment' : 'Post first strike comment', anchor.timestamp,
    strikes.length ? 2 : stage === 'first' ? 3 : 2,
    'No customer reply detected. Log a qualified note on CI.', now, strikes.length ? 0 : 2,
    [sourceEvent(strikes.length ? 'First strike' : stage === 'first' ? 'Your first answer' : 'Your latest response', anchor)],
    strikes.length ? '2 business days after the first strike' : stage === 'first'
      ? '3 business days after your first answer' : '2 business days after your latest response'));
}

function sourceEvent(label, entry) {
  return { label, entryId: entry.id, timestamp: entry.timestamp };
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dueAction(action, timestamp, days, reason, now, closeDaysAfterDue = null, evidence = [], rule = '') {
  const due = addBusinessDays(timestamp, days);
  const today = new Date(now); today.setHours(12, 0, 0, 0);
  const difference = Math.round((due - today) / 86400000);
  return { action, due: formatLocalDate(due),
    predictedClose: closeDaysAfterDue === null ? null : formatLocalDate(addBusinessDays(due, closeDaysAfterDue)),
    tone: difference < 0 ? 'overdue' : difference === 0 ? 'today' : 'upcoming', reason, evidence, rule };
}
if (typeof module !== 'undefined') module.exports = { planAction, addBusinessDays, scopeThread, inferProcessStage, inferPostAction };
