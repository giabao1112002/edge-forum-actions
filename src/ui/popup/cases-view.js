// Case-list and Today rendering receive data and mutations explicitly.
function createCasesView({ document, state, domain, persistCases, renderThread, renderCalendar }) {
  const { sortCases, caseCategory, caseStatus, todayActivity, caseTitle, postedToday, caseStep } = domain;
  const openCaseCategories = new Set(['strike', 'close', 'followup']);
  function renderCases() {
    const { cases, supportAuthorId, refreshingCases, profileLoading } = state;
    const list = document.getElementById('case-list');
    list.replaceChildren();
    document.getElementById('case-count').textContent = cases.length;
    document.getElementById('refresh-cases').disabled = refreshingCases || !supportAuthorId || !cases.length;
    const failedCount = cases.filter((item) => item.error).length;
    const retry = document.getElementById('retry-cases');
    retry.hidden = !failedCount;
    retry.disabled = refreshingCases || profileLoading || !supportAuthorId;
    retry.textContent = `Retry failed cases (${failedCount})`;
    document.getElementById('export-report').disabled = state.exportingReport || refreshingCases || profileLoading || !supportAuthorId || !cases.length;
    renderToday();
    renderCalendar();
    if (!cases.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = supportAuthorId ? 'No saved cases yet. Open a Q&A thread and choose Save to My Cases.'
        : 'Save your support profile first to use My Cases.';
      list.append(empty);
      return;
    }
    const categories = [
      ['strike', 'Strike cases'], ['close', 'Close cases (last response due)'],
      ['followup', 'Customer follow-up'], ['completed', 'Flow complete / accepted (verify CI)'], ['review', 'Needs review']
    ];
    for (const [category, title] of categories) {
      const grouped = sortCases(cases.filter((item) => caseCategory(item) === category));
      if (!grouped.length && category !== 'strike' && category !== 'close') continue;
      const group = document.createElement('details');
      group.className = `case-group ${category}`;
      group.open = openCaseCategories.has(category);
      group.addEventListener('toggle', () => {
        if (group.open) openCaseCategories.add(category);
        else openCaseCategories.delete(category);
      });
      const heading = document.createElement('summary');
      heading.textContent = `${title} (${grouped.length})`;
      group.append(heading);
      if (!grouped.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'No cases in this category.';
        group.append(empty);
      }
      for (const item of grouped) {
        const card = document.createElement('div');
        const status = caseStatus(item);
        card.className = `case-item ${item.action === 'Follow up with customer' ? todayActivity(item) : status}`;
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = caseTitle(item);
        const summary = document.createElement('p');
        const label = status === 'today' && item.action === 'Follow up with customer' ? 'Final deadline today - respond now'
          : status === 'upcoming' && item.action === 'Follow up with customer' ? 'Customer replied - respond now'
          : status === 'upcoming' && item.action.includes('strike') ? 'Waiting for customer'
          : { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', completed: 'Completed (verify CI)', neutral: 'Review needed' }[status];
        const siteLabel = item.site === 'devcommunity' ? 'Developer Community' : 'Microsoft Learn';
        summary.textContent = `${item.error ? 'Last known · ' : ''}${label}: ${item.action}${item.due ? ` · ${item.due}` : ''}${item.site ? ` • Source: ${siteLabel}` : ''}`;
        const checked = document.createElement('p');
        checked.className = 'hint';
        checked.textContent = `Last checked: ${item.checkedAt ? new Date(item.checkedAt).toLocaleString() : 'never'}${item.error ? ` · Refresh failed: ${item.error}` : ''}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'case-remove';
        remove.textContent = 'Remove';
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'case-confirm';
        confirm.textContent = 'Confirm removal';
        confirm.hidden = true;
        const warning = document.createElement('p');
        warning.className = 'hint';
        warning.textContent = 'Remove this case from My Cases? Reminders will stop; action corrections stay saved.';
        warning.hidden = true;
        let awaitingConfirmation = false;
        remove.addEventListener('click', () => {
          awaitingConfirmation = !awaitingConfirmation;
          remove.textContent = awaitingConfirmation ? 'Cancel' : 'Remove';
          remove.className = awaitingConfirmation ? 'case-cancel' : 'case-remove';
          confirm.hidden = !awaitingConfirmation;
          warning.hidden = !awaitingConfirmation;
        });
        confirm.addEventListener('click', async () => {
          if (!awaitingConfirmation) return;
          confirm.disabled = true;
          await persistCases({ type: 'remove', id: item.id, site: item.site || 'learn' });
          if (state.thread?.id === item.id) renderThread();
        });
        card.append(link, summary, checked, remove, confirm, warning);
        group.append(card);
      }
      list.append(group);
    }
  }
  function renderToday() {
    const list = document.getElementById('today-list');
    list.replaceChildren();
    const work = sortCases(state.cases.filter((item) => todayActivity(item)));
    if (!work.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No action scheduled today from saved cases.';
      list.append(empty);
      return;
    }
    for (const item of work) {
      const card = document.createElement('div');
      const activity = todayActivity(item);
      card.className = `case-item ${activity === 'posted' ? 'completed' : activity}`;
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = caseTitle(item);
      card.append(link);
      const source = item.site ? document.createElement('p') : null;
      if (source) {
        source.className = 'hint';
        source.textContent = `Source: ${item.site === 'devcommunity' ? 'Developer Community' : 'Microsoft Learn'}`;
      }
      if (postedToday(item) && item.action !== 'Follow up with customer') {
        const completed = document.createElement('p');
        completed.className = item.lastSupportPost.step ? 'step-complete' : 'hint';
        const step = item.lastSupportPost.step;
        completed.textContent = `${item.error ? 'Last known: ' : ''}${step
          ? `${step} - Complete (forum post observed${step.startsWith('Close step') || step === 'Answer accepted' ? '; CI closure unverified' : ''})`
          : `${item.lastSupportPost.type === 'answer' ? 'Answer' : 'Comment'} posted - step not confirmed`}`;
        card.append(completed);
      }
      if (activity === 'posted') {
        if (source) card.append(source);
        list.append(card);
        continue;
      }
      const detail = document.createElement('p');
      detail.className = 'step-pending';
      const step = caseStep(item.action);
      detail.textContent = `${item.error ? 'Last known: ' : ''}${step} - Not complete. ${activity === 'reply'
        ? `Respond now; final deadline: ${item.due}`
        : activity === 'urgent' ? `RED WARNING: final deadline today (${item.due})`
        : activity === 'overdue' ? `Overdue - act immediately (${item.due})`
        : `Due today (${item.due})`}`;
      card.append(detail);
      if (source) card.append(source);
      list.append(card);
    }
  }
  return { renderCases, renderToday };
}
