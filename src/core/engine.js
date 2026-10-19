function addBusinessDays(timestamp, count) {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);
  while (count > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) count--;
  }
  return date;
}

function sameCustomerName(left, right) {
  const words = (value) => new Set(String(value || '').normalize('NFKD').toLowerCase()
    .match(/[\p{L}\p{N}]{5,}/gu)?.filter((word) => !['customer', 'unknown', 'microsoft', 'support',
      'anonymous', 'question', 'author', 'profile'].includes(word)) || []);
  const original = words(left);
  return [...words(right)].some((word) => original.has(word));
}

function scopeThread(thread, supportAuthorId) {
  const question = thread.entries.find((entry) => entry.type === 'question');
  const authorId = question?.authorId;
  const firstCommunityResponse = thread.site === 'devcommunity' ? thread.entries.find((entry) =>
    entry.authorId === supportAuthorId && (entry.type === 'comment' || entry.type === 'answer'))?.id : null;
  const supportAnswers = new Set(thread.entries.filter((entry) => entry.type === 'answer' && entry.authorId === supportAuthorId)
    .map((entry) => entry.id));
  const replyToOwnAnswer = (entry) => entry.type === 'comment' && supportAnswers.has(entry.parentAnswerId) &&
    entry.authorId && entry.authorId !== supportAuthorId && sameCustomerName(question?.author, entry.author);
  const isRelevant = (entry) => entry.type === 'question' ||
    (!entry.parentAnswerId || supportAnswers.has(entry.parentAnswerId)) &&
    entry.authorId && (entry.authorId === authorId || entry.authorId === supportAuthorId || replyToOwnAnswer(entry));
  const entries = thread.entries.filter(isRelevant).map((entry) =>
    entry.id === firstCommunityResponse && entry.type === 'comment' ? { ...entry, type: 'answer' }
      : {
        ...entry, customerReply: entry.type === 'comment' && entry.authorId !== supportAuthorId &&
          (entry.authorId === authorId || replyToOwnAnswer(entry))
      });
  return {
    ...thread, entries, excludedCount: thread.entries.length - entries.length,
    hasUnidentifiedAuthors: thread.entries.some((entry) => entry.type !== 'question' && !entry.authorId &&
      (!entry.parentAnswerId || supportAnswers.has(entry.parentAnswerId)))
  };
}

function inferProcessStage(entries, customerAuthorId, supportAuthorId) {
  const firstAnswer = entries.find((entry) => entry.type === 'answer' && entry.authorId === supportAuthorId);
  if (!firstAnswer) return 'pre-response';
  const afterAnswer = entries.filter((entry) => Date.parse(entry.timestamp) > Date.parse(firstAnswer.timestamp));
  const customerReplies = afterAnswer.filter((entry) => entry.customerReply || entry.authorId === customerAuthorId);
  if (!customerReplies.length) return 'first';
  const latestCustomerReply = customerReplies[customerReplies.length - 1];
  const replied = afterAnswer.some((entry) => entry.authorId === supportAuthorId &&
    Date.parse(entry.timestamp) > Date.parse(latestCustomerReply.timestamp));
  return replied ? 'ongoing' : 'awaiting-customer';
}

function inferLearnCommentIntent(entry) {
  const content = String(entry.content || entry.excerpt || '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLowerCase();
  if (!content.trim()) return null;
  const closing = /\b(?:i )?hope (?:the |my )?(?:information|answer|response|guidance).{0,70}\b(?:helpful|useful)\b/.test(content) &&
    /\b(?:feel free to reach out|happy to help|thank you for your time)\b/.test(content);
  if (closing) return 'last';
  const investigation = /\b(?:please|could you(?: please)?) (?:try|run|check|share|provide|collect|verify|confirm|test)\b|\b(?:i reviewed|i recommend|i would recommend|based on (?:the|your)|evidence suggests|to (?:help )?(?:investigate|troubleshoot))\b/.test(content);
  if (investigation) return 'response';
  const reminder = /\b(?:haven't|have not) heard (?:back )?from you\b|\b(?:haven't|have not) heard back\b|\b(?:just )?wanted to check (?:whether|if) you (?:had|have) a chance\b|\b(?:checking in|following up on my previous response|follow up on my previous response)\b/.test(content);
  return reminder ? 'strike' : null;
}

function inferPostAction(entry, entries, customerAuthorId, supportAuthorId, overrides = {}, site = 'learn') {
  if (entry.type === 'answer') return 'response';
  const earlier = entries.filter((item) => Date.parse(item.timestamp) < Date.parse(entry.timestamp));
  const latestCustomer = [...earlier].reverse().find((item) => item.type !== 'question' &&
    (item.customerReply || item.authorId === customerAuthorId));
  const latestSupport = [...earlier].reverse().find((item) => item.authorId === supportAuthorId);
  if (latestCustomer && (!latestSupport || Date.parse(latestCustomer.timestamp) > Date.parse(latestSupport.timestamp)))
    return 'response';
  const firstAnswer = entries.find((item) => item.type === 'answer' && item.authorId === supportAuthorId);
  const lastExplicitResponse = site === 'devcommunity' ? null : [...earlier].reverse().find((item) =>
    item.type === 'comment' && item.authorId === supportAuthorId &&
    Date.parse(item.timestamp) > Date.parse(latestCustomer?.timestamp || firstAnswer?.timestamp || 0) &&
    (overrides[item.id] === 'response' || inferLearnCommentIntent(item) === 'response'));
  const strikes = earlier.filter((item) => item.type === 'comment' && item.authorId === supportAuthorId &&
    Date.parse(item.timestamp) > Date.parse(lastExplicitResponse?.timestamp || latestCustomer?.timestamp || firstAnswer?.timestamp || 0) &&
    (overrides[item.id] || inferPostAction(item, entries, customerAuthorId, supportAuthorId, overrides, site)) === 'strike');
  const contentIntent = site === 'devcommunity' ? null : inferLearnCommentIntent(entry);
  if (contentIntent === 'last') return strikes.length ? 'last' : 'response';
  if (contentIntent) return contentIntent;
  const posted = new Date(entry.timestamp);
  posted.setHours(12, 0, 0, 0);
  if (strikes.length) return addBusinessDays(strikes[strikes.length - 1].timestamp, 2) <= posted ? 'last' : 'response';
  const anchor = latestSupport && Date.parse(latestSupport.timestamp) > Date.parse(latestCustomer?.timestamp || firstAnswer?.timestamp || 0)
    ? latestSupport : firstAnswer;
  if (!anchor) return 'response';
  const hasCustomerReply = !!latestCustomer && Date.parse(latestCustomer.timestamp) > Date.parse(firstAnswer?.timestamp || 0);
  const quietDays = hasCustomerReply ? 2 : 3;
  return addBusinessDays(anchor.timestamp, quietDays) <= posted ? 'strike' : 'response';
}

function planAction(thread, settings, now = new Date()) {
  const review = (reason) => ({ action: 'Review needed', reason, due: null, tone: 'neutral' });
  if (!settings.supportAuthorId) return review('Set your support profile to calculate an action.');
  if (thread.site === 'devcommunity' && /^Closed\b/i.test(thread.communityStatus || ''))
    return {
      action: 'Developer Community thread closed — verify CI closure', due: null, tone: 'completed',
      reason: `Public status: ${thread.communityStatus}. Confirm CI closure separately.`
    };
  const question = thread.entries.find((entry) => entry.type === 'question');
  if (thread.acceptedAnswerId) {
    const acceptedAnswer = thread.entries.find((entry) => entry.id === thread.acceptedAnswerId);
    if (acceptedAnswer?.authorId === settings.supportAuthorId)
      return {
        action: 'Your answer was accepted', due: null, tone: 'completed',
        reason: 'No strike due. Confirm whether the case was closed on CI separately; the public page does not verify CI status.',
        evidence: [{ label: 'Accepted answer', entryId: acceptedAnswer.id, timestamp: acceptedAnswer.timestamp }]
      };
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
    entry.type !== 'question' && Date.parse(entry.timestamp) > Date.parse(firstAnswer.timestamp)).map((entry) => ({
      ...entry,
      role: entry.customerReply || entry.authorId === question.authorId ? 'customer' : 'staff',
      action: settings.actions?.[entry.id] || inferPostAction(entry, scoped.entries, question.authorId, settings.supportAuthorId,
        settings.actions, thread.site)
    }));
  const relevant = events.filter((event) => event.role === 'customer' || event.role === 'staff' && event.action !== 'ignore');
  const customer = [...relevant].reverse().find((event) => event.role === 'customer');
  const staff = [...relevant].reverse().find((event) => event.role === 'staff');
  if (!staff) return review('No staff response found. Review thread status.');
  if (customer && Date.parse(customer.timestamp) >= Date.parse(staff.timestamp))
    return dueAction('Follow up with customer', customer.timestamp, 1, 'Customer replied: strike count resets.', now,
      null, [sourceEvent('Customer reply', customer)], '1 business day after the customer reply');
  const currentCycle = relevant.filter((event) => event.role === 'staff' &&
    (!customer || Date.parse(event.timestamp) > Date.parse(customer.timestamp)));
  const lastExplicitResponse = thread.site === 'devcommunity' ? null : [...currentCycle].reverse().find((event) =>
    event.type === 'comment' && event.action === 'response' &&
    (settings.actions?.[event.id] === 'response' || inferLearnCommentIntent(event) === 'response'));
  const cycle = lastExplicitResponse ? currentCycle.filter((event) =>
    Date.parse(event.timestamp) >= Date.parse(lastExplicitResponse.timestamp)) : currentCycle;
  const strikes = cycle.filter((event) => event.action === 'strike');
  const withPostedStrikes = (result) => ({
    ...result,
    postedStrikes: strikes.map((entry) => formatLocalDate(new Date(entry.timestamp))),
    evidence: [...(result.evidence || []), ...strikes.filter((entry) =>
      !result.evidence?.some((source) => source.entryId === entry.id))
      .map((entry) => sourceEvent('Earlier strike posted', entry))]
  });
  const last = cycle.find((event) => event.action === 'last');
  if (last) return withPostedStrikes({
    action: 'Strike flow complete — verify CI closure', due: null, tone: 'completed',
    reason: `Final follow-up posted ${new Date(last.timestamp).toLocaleDateString()}. No further strike is scheduled. The thread cannot confirm CI closure.`,
    evidence: [sourceEvent('Final follow-up', last)]
  });
  if (stage === 'first' && strikes.length > 1)
    return withPostedStrikes(review('Multiple strike comments were posted before the two-business-day final follow-up; verify their purpose.'));
  if (strikes.length >= 1)
    return withPostedStrikes(dueAction('Send last quality response', strikes[strikes.length - 1].timestamp, 2,
      'No customer reply after strikes.', now, null, [sourceEvent('Most recent strike', strikes[strikes.length - 1])],
      '2 business days after the strike'));
  const anchor = strikes.length ? strikes[strikes.length - 1] : [...cycle].reverse().find((event) => event.action === 'response');
  if (!anchor) return review('Confirm the latest support response before calculating a strike.');
  return withPostedStrikes(dueAction('Post first strike comment', anchor.timestamp,
    stage === 'first' ? 3 : 2,
    'No customer reply detected. Log a qualified note on CI.', now, 2,
    [sourceEvent(anchor.id === firstAnswer.id ? 'Your first answer' : stage === 'first'
      ? 'Your additional response' : 'Your latest response', anchor)],
    stage === 'first' ? '3 business days after your first answer' : '2 business days after your latest response'));
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
  return {
    action, due: formatLocalDate(due),
    predictedClose: closeDaysAfterDue === null ? null : formatLocalDate(addBusinessDays(due, closeDaysAfterDue)),
    tone: difference < 0 ? 'overdue' : difference === 0 ? 'today' : 'upcoming', reason, evidence, rule
  };
}
if (typeof module !== 'undefined') module.exports = { planAction, addBusinessDays, scopeThread, inferProcessStage, inferPostAction };
