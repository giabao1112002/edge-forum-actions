// Rendering only; state and correction persistence belong to the app controller.
function createThreadView({ document, state, domain, saveAndRender }) {
  const { planAction, scopeThread, inferProcessStage, inferPostAction, caseTitle } = domain;
  const postLink = (id) => `${state.thread.url}#${encodeURIComponent(id.startsWith('question-') ? `${id}-expander` : id)}`;
  function select(choices, selected, onChange) {
    const input = document.createElement('select');
    for (const [value, text] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      input.append(option);
    }
    input.value = selected;
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }
  function renderResult() {
    const result = planAction(state.thread, state.settings);
    const box = document.getElementById('result');
    box.className = result.tone;
    box.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = result.action;
    const deadline = document.createElement('p');
    deadline.className = 'result-deadline';
    deadline.textContent = result.due ? `Calculated due date: ${result.due} (${result.tone})`
      : result.tone === 'completed' ? 'No strike deadline' : 'Date not calculated';
    box.append(heading, deadline);
    for (const [index, strikeDate] of (result.postedStrikes || []).entries()) {
      const posted = document.createElement('p');
      posted.textContent = `Observed strike ${index + 1} posted: ${strikeDate}`;
      box.append(posted);
    }
    if (result.predictedClose) {
      const closeDate = document.createElement('p');
      closeDate.textContent = `Predicted close day: ${result.predictedClose}`;
      const condition = document.createElement('p');
      condition.className = 'hint';
      condition.textContent = 'Forecast only: customer stays silent and steps happen on schedule. CI closure is not verified.';
      box.append(closeDate, condition);
    }
    const reason = document.createElement('p');
    reason.className = 'result-reason';
    reason.textContent = result.reason;
    box.append(reason);
    if (result.evidence?.length) {
      const explanation = document.createElement('details');
      explanation.className = 'disclosure';
      const title = document.createElement('summary');
      title.textContent = 'Why this date?';
      const list = document.createElement('ol');
      list.className = 'evidence';
      for (const item of result.evidence) {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.href = postLink(item.entryId);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `${item.label}: ${new Date(item.timestamp).toLocaleDateString()}`;
        row.append(link);
        list.append(row);
      }
      if (result.rule) {
        const row = document.createElement('li');
        row.textContent = `Rule: ${result.rule}; calculated due ${result.due}`;
        list.append(row);
      }
      if (result.action.startsWith('Post ') && result.action.includes('strike')) {
        const row = document.createElement('li');
        row.textContent = 'No customer reply in your conversation since this response.';
        list.append(row);
      }
      explanation.append(title, list);
      box.append(explanation);
    }
  }
  function renderThread() {
    const { profileLoading, thread, settings, supportAuthorId, cases } = state;
    if (profileLoading || !thread || !settings) return;
    const renderedThread = thread;
    const renderedSettings = settings;
    document.getElementById('thread').hidden = false;
    document.getElementById('title').textContent = caseTitle(thread);
    document.getElementById('thread-url').value = thread.url;
    const saveButton = document.getElementById('save-case');
    const site = normalizeSupportSite(thread.site || state.supportSite || 'learn');
    const alreadySaved = cases.some((item) => item.id === thread.id && item.site === site);
    saveButton.textContent = alreadySaved ? 'Saved in My Cases' : 'Save to My Cases';
    saveButton.disabled = !supportAuthorId || alreadySaved;
    const scoped = scopeThread(thread, supportAuthorId);
    const question = scoped.entries.find((entry) => entry.type === 'question');
    const stage = inferProcessStage(scoped.entries, question?.authorId, supportAuthorId);
    const acceptedAnswer = scoped.entries.find((entry) => entry.id === thread.acceptedAnswerId);
    const result = planAction(thread, settings);
    document.getElementById('stage').textContent = !supportAuthorId ? 'Set your support profile to calculate an action'
      : thread.acceptedAnswerId ? acceptedAnswer?.authorId === supportAuthorId
        ? 'Stage: Your answer accepted by question author' : 'Stage: Another answer accepted by question author'
      : result.tone === 'completed' ? 'Stage: Final follow-up posted; verify CI closure'
      : {
        'pre-response': 'Stage: Waiting for your first answer',
        first: 'Stage: First answer; no customer reply',
        ongoing: 'Stage: Ongoing investigation; customer replied and you responded',
        'awaiting-customer': 'Stage: Customer replied; your follow-up is next'
      }[stage];
    document.getElementById('excluded').textContent = scoped.excludedCount
      ? `${scoped.excludedCount} post(s) outside your conversation excluded, including replies under other answers.`
      : 'No posts outside your conversation found.';
    const container = document.getElementById('entries');
    container.replaceChildren();
    for (const entry of scoped.entries) {
      const card = document.createElement('div');
      card.className = 'entry';
      const header = document.createElement('a');
      header.href = postLink(entry.id);
      header.target = '_blank';
      header.rel = 'noopener noreferrer';
      header.textContent = `${entry.author} · ${entry.type}`;
      const time = document.createElement('time');
      time.dateTime = entry.timestamp;
      time.textContent = ` ${new Date(entry.timestamp).toLocaleString()}`;
      const excerpt = document.createElement('p');
      excerpt.textContent = entry.excerpt;
      card.append(header, time, excerpt);
      if (entry.type !== 'question' && entry.authorId === supportAuthorId) {
        const actionLabel = document.createElement('label');
        actionLabel.textContent = 'Your action';
        const actionInput = select([['response', 'Response / follow-up'], ['strike', 'Strike comment'],
          ['last', 'Last quality response'], ['ignore', 'Not part of this process']],
        settings.actions[entry.id] || inferPostAction(entry, scoped.entries, question?.authorId, supportAuthorId,
          settings.actions, thread.site),
        (value) => {
          if (state.profileLoading || renderedThread !== state.thread || renderedSettings !== state.settings) return;
          renderedSettings.actions[entry.id] = value;
          saveAndRender(renderedThread, renderedSettings).catch((error) => {
            document.getElementById('message').textContent = error.message;
          });
        });
        card.append(actionLabel, actionInput);
      }
      container.append(card);
    }
    renderResult();
  }
  return { renderThread };
}
